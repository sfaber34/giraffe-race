import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { keccak256, toHex } from "viem";

/**
 * Precompute win probabilities by effective score (1-10) for 6-lane races.
 *
 * We compute only sorted score tuples (a<=b<=c<=d<=e<=f), count = 5005.
 * The resulting table stores per-position win probabilities (basis points, 0..10000) for the sorted order.
 *
 * Output:
 * - JSON checkpoint (optional)
 * - Multiple Solidity contracts containing packed hex tables (split to fit under 24KB limit)
 * - A router contract that delegates to the correct shard
 *
 * Usage:
 *   node packages/nextjs/scripts/generate-win-prob-table.mjs --samples 50000
 *
 * Flags:
 *   --samples N          (default 50000) Monte Carlo samples per sorted tuple
 *   --workers W          (default cpuCount-1, capped at 12) number of worker threads
 *   --out-dir PATH       (default packages/foundry/contracts/libraries) output directory for Solidity files
 *   --checkpoint PATH    (default packages/nextjs/generated/win-prob-checkpoint-6lane.json)
 *   --resume             resume from checkpoint if present
 *   --progress-every M   print progress every M tuples (default 10)
 */

const LANE_COUNT = 6;
const ENTRY_BYTES = LANE_COUNT * 2; // 6 lanes × 2 bytes (uint16) = 12 bytes per entry

// -----------------------
// Race sim (JS port of TS, 6 lanes)
// -----------------------

class DeterministicDice {
  /** @type {Uint8Array} */
  entropy;
  /** nibble position 0..63 */
  position = 0;

  /** @param {`0x${string}`} seed */
  constructor(seed) {
    this.entropy = hexToBytes(seed);
  }

  /** @param {bigint} n */
  roll(n) {
    if (n <= 0n) throw new Error("DeterministicDice: n must be > 0");
    const bitsNeeded = ceilLog2(n);
    let hexCharsNeeded = Number((bitsNeeded + 3n) / 4n);
    if (hexCharsNeeded === 0) hexCharsNeeded = 1;

    const maxValue = 16n ** BigInt(hexCharsNeeded);
    const threshold = maxValue - (maxValue % n);

    let value;
    do {
      value = this.consumeNibbles(hexCharsNeeded);
    } while (value >= threshold);

    return value % n;
  }

  /** @param {number} count */
  consumeNibbles(count) {
    let value = 0n;
    for (let i = 0; i < count; i++) {
      if (this.position >= 64) {
        this.entropy = hexToBytes(keccak256(this.entropy));
        this.position = 0;
      }
      const nibble = getNibble(this.entropy, this.position);
      value = (value << 4n) + BigInt(nibble);
      this.position++;
    }
    return value;
  }
}

function hexToBytes(hex) {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function getNibble(bytes, pos) {
  const byteIndex = Math.floor(pos / 2);
  const byteValue = bytes[byteIndex] ?? 0;
  return pos % 2 === 0 ? byteValue >> 4 : byteValue & 0x0f;
}

function ceilLog2(n) {
  if (n <= 1n) return 0n;
  let result = 0n;
  let temp = n - 1n;
  while (temp > 0n) {
    result++;
    temp >>= 1n;
  }
  return result;
}

function clampScore(r) {
  const x = Math.floor(Number(r));
  // Clamp to [1, 10]
  if (!Number.isFinite(x) || x < 1) return 1;
  if (x > 10) return 10;
  return x;
}

// Match Solidity/TS: minBps + (score-1) * (10000-minBps) / 9
function scoreBps(score) {
  const r = clampScore(score);
  // Tuning: keep consistent with Solidity/TS sim.
  const minBps = 9585;
  const range = 10_000 - minBps; // 415
  return minBps + Math.floor(((r - 1) * range) / 9);
}

/**
 * @param {object} p
 * @param {`0x${string}`} p.seed
 * @param {number[]} p.score length 6
 */
function simulateRaceFromSeed({ seed, score }) {
  const dice = new DeterministicDice(seed);
  const distances = Array.from({ length: LANE_COUNT }, () => 0);
  const bps = Array.from({ length: LANE_COUNT }, (_, i) => scoreBps(score[i] ?? 10));

  // constants (must match Solidity)
  const SPEED_RANGE = 10n;
  const TRACK_LENGTH = 1000;
  const MAX_TICKS = 500;

  let finished = false;
  for (let t = 0; t < MAX_TICKS; t++) {
    for (let a = 0; a < LANE_COUNT; a++) {
      const r = dice.roll(SPEED_RANGE); // 0..9
      const baseSpeed = Number(r + 1n); // 1..10
      // Probabilistic rounding (matches Solidity): avoids a chunky handicap from floor().
      const raw = baseSpeed * bps[a];
      let q = Math.floor(raw / 10_000);
      const rem = raw % 10_000;
      if (rem > 0) {
        const pick = Number(dice.roll(10_000n)); // 0..9999
        if (pick < rem) q += 1;
      }
      distances[a] += Math.max(1, q);
    }
    if (distances.some(d => d >= TRACK_LENGTH)) {
      finished = true;
      break;
    }
  }
  if (!finished) throw new Error("Race did not finish");

  const best = Math.max(...distances);
  const leaders = [];
  for (let i = 0; i < LANE_COUNT; i++) if (distances[i] === best) leaders.push(i);
  if (leaders.length === 1) return leaders[0];
  // Dead heat: pick randomly (matches Solidity)
  const pick = Number(dice.roll(BigInt(leaders.length)));
  return leaders[pick];
}

// -----------------------
// PRNG: SplitMix64
// -----------------------

const MASK64 = (1n << 64n) - 1n;
const SPLITMIX64_GAMMA = 0x9e3779b97f4a7c15n;
function splitmix64Next(state) {
  state.x = (state.x + SPLITMIX64_GAMMA) & MASK64;
  let z = state.x;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

function makeSeed32FromState(state) {
  const a = splitmix64Next(state);
  const b = splitmix64Next(state);
  const c = splitmix64Next(state);
  const d = splitmix64Next(state);
  const seed256 = (a << 192n) | (b << 128n) | (c << 64n) | d;
  return /** @type {`0x${string}`} */ (toHex(seed256, { size: 32 }));
}

// -----------------------
// CLI + generation
// -----------------------

function parseArgs(argv) {
  const out = {
    samples: 50_000,
    workers: Math.max(1, Math.min(12, (os.cpus().length || 1) - 1)),
    outDir: "packages/foundry/contracts/libraries",
    checkpoint: "packages/nextjs/generated/win-prob-checkpoint-6lane.json",
    resume: false,
    progressEvery: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Handle both --arg=value and --arg value formats
    if (a.startsWith("--samples=")) out.samples = Number(a.split("=")[1]);
    else if (a === "--samples") out.samples = Number(argv[++i]);
    else if (a.startsWith("--workers=")) out.workers = Number(a.split("=")[1]);
    else if (a === "--workers") out.workers = Number(argv[++i]);
    else if (a.startsWith("--out-dir=")) out.outDir = String(a.split("=")[1]);
    else if (a === "--out-dir") out.outDir = String(argv[++i]);
    else if (a.startsWith("--checkpoint=")) out.checkpoint = String(a.split("=")[1]);
    else if (a === "--checkpoint") out.checkpoint = String(argv[++i]);
    else if (a === "--resume") out.resume = true;
    else if (a.startsWith("--progress-every=")) out.progressEvery = Number(a.split("=")[1]);
    else if (a === "--progress-every") out.progressEvery = Number(argv[++i]);
  }
  return out;
}

/**
 * Generate all sorted 6-tuples (a <= b <= c <= d <= e <= f) with values 1..10.
 * Total count: C(10+6-1, 6) = C(15, 6) = 5005
 */
function* sortedScoreTuples6() {
  for (let a = 1; a <= 10; a++) {
    for (let b = a; b <= 10; b++) {
      for (let c = b; c <= 10; c++) {
        for (let d = c; d <= 10; d++) {
          for (let e = d; e <= 10; e++) {
            for (let f = e; f <= 10; f++) {
              yield [a, b, c, d, e, f];
            }
          }
        }
      }
    }
  }
}

function tupleKey6([a, b, c, d, e, f]) {
  // pack into 24 bits (6 × 4-bit nybbles)
  return (
    (a & 0xf) |
    ((b & 0xf) << 4) |
    ((c & 0xf) << 8) |
    ((d & 0xf) << 12) |
    ((e & 0xf) << 16) |
    ((f & 0xf) << 20)
  );
}

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function encodeU16BE(x) {
  const v = Math.max(0, Math.min(65535, x | 0));
  return [(v >> 8) & 0xff, v & 0xff];
}

function probsToU16Bps(wins, total) {
  // round-to-nearest basis points
  return wins.map(w => Math.max(1, Math.min(10000, Math.floor((w * 10000 + total / 2) / total))));
}

function computeTupleProbs(tuple, samples) {
  const wins = Array.from({ length: LANE_COUNT }, () => 0);
  const key = tupleKey6(tuple);
  const state = { x: (BigInt(key) * 0x9e3779b97f4a7c15n) & MASK64 };
  for (let i = 0; i < samples; i++) {
    const seed = makeSeed32FromState(state);
    const winner = simulateRaceFromSeed({ seed, score: tuple });
    wins[winner] += 1;
  }
  return probsToU16Bps(wins, samples);
}

function workerLoop() {
  const samples = workerData?.samples;
  if (!Number.isFinite(samples) || samples <= 0) throw new Error("Worker: invalid samples");
  if (!parentPort) throw new Error("Worker: missing parentPort");

  parentPort.on("message", msg => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "stop") process.exit(0);
    if (msg.type !== "job") return;
    const { id, index, tuple } = msg;
    try {
      const probs = computeTupleProbs(tuple, samples);
      parentPort.postMessage({ type: "result", id, index, tuple, probs });
    } catch (e) {
      parentPort.postMessage({ type: "error", id, index, error: String(e?.message || e) });
    }
  });

  // Signal ready
  parentPort.postMessage({ type: "ready" });
}

/**
 * Split the table into shards that fit under 24KB each.
 * Each entry is 12 bytes. With ~850 entries per shard, we get ~10KB of data per shard,
 * leaving plenty of room for contract code overhead (~12-14KB).
 */
const ENTRIES_PER_SHARD = 850;
const TOTAL_TUPLES = 5005;
const SHARD_COUNT = Math.ceil(TOTAL_TUPLES / ENTRIES_PER_SHARD); // 6 shards

function generateShardContract(shardIndex, rows, startIndex) {
  const tableBytes = [];
  for (const row of rows) {
    const probs = row.probs;
    for (let i = 0; i < LANE_COUNT; i++) {
      tableBytes.push(...encodeU16BE(probs[i]));
    }
  }

  const hex = Buffer.from(Uint8Array.from(tableBytes)).toString("hex");
  const entryCount = rows.length;

  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Win probability table shard ${shardIndex} of ${SHARD_COUNT} (6 lanes).
/// @dev Contains entries ${startIndex} to ${startIndex + entryCount - 1} (${entryCount} entries).
/// Each entry is ${ENTRY_BYTES} bytes: ${LANE_COUNT}× uint16 (basis points) in big-endian.
contract WinProbTableShard${shardIndex} {
    uint256 internal constant ENTRY_BYTES = ${ENTRY_BYTES};
    uint256 internal constant SHARD_START = ${startIndex};
    uint256 internal constant SHARD_LEN = ${entryCount};

    bytes internal constant TABLE = hex"${hex}";

    function getByGlobalIndex(uint256 globalIdx) external pure returns (uint16[${LANE_COUNT}] memory probsBps) {
        require(globalIdx >= SHARD_START && globalIdx < SHARD_START + SHARD_LEN, "Index out of shard range");
        uint256 localIdx = globalIdx - SHARD_START;
        uint256 off = localIdx * ENTRY_BYTES;
        for (uint256 i = 0; i < ${LANE_COUNT}; i++) {
            probsBps[i] = _u16be(off + i * 2);
        }
    }

    function shardRange() external pure returns (uint256 start, uint256 len) {
        return (SHARD_START, SHARD_LEN);
    }

    function _u16be(uint256 off) private pure returns (uint16 v) {
        uint8 hi = uint8(TABLE[off]);
        uint8 lo = uint8(TABLE[off + 1]);
        v = (uint16(hi) << 8) | uint16(lo);
    }
}
`;
}

function generateRouterContract() {
  // Generate imports for all shards
  const imports = Array.from({ length: SHARD_COUNT }, (_, i) => 
    `import "./WinProbTableShard${i}.sol";`
  ).join('\n');

  // Generate shard variables
  const shardVars = Array.from({ length: SHARD_COUNT }, (_, i) =>
    `    WinProbTableShard${i} public immutable shard${i};`
  ).join('\n');

  // Generate constructor params
  const constructorParams = Array.from({ length: SHARD_COUNT }, (_, i) =>
    `address _shard${i}`
  ).join(', ');

  // Generate constructor body
  const constructorBody = Array.from({ length: SHARD_COUNT }, (_, i) =>
    `        shard${i} = WinProbTableShard${i}(_shard${i});`
  ).join('\n');

  // Generate _getByIndex routing logic
  let routingLogic = '';
  for (let i = 0; i < SHARD_COUNT; i++) {
    const threshold = ENTRIES_PER_SHARD * (i + 1);
    if (i === 0) {
      routingLogic += `        if (idx < ${threshold}) {\n            return shard0.getByGlobalIndex(idx);\n        }`;
    } else if (i < SHARD_COUNT - 1) {
      routingLogic += ` else if (idx < ${threshold}) {\n            return shard${i}.getByGlobalIndex(idx);\n        }`;
    } else {
      routingLogic += ` else {\n            return shard${i}.getByGlobalIndex(idx);\n        }`;
    }
  }

  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

${imports}

/// @notice Router for 6-lane win probability lookup table.
/// @dev Routes queries to the correct shard based on the global index.
/// Index order is all sorted tuples (a<=b<=c<=d<=e<=f) with a,b,c,d,e,f in [1..10], in nested-loop order.
contract WinProbTable6 {
    uint8 internal constant LANE_COUNT = 6;
    uint256 internal constant ENTRY_BYTES = ${ENTRY_BYTES};
    uint256 internal constant TABLE_LEN = ${TOTAL_TUPLES};
    uint256 internal constant ENTRIES_PER_SHARD = ${ENTRIES_PER_SHARD};

${shardVars}

    constructor(${constructorParams}) {
${constructorBody}
    }

    /// @notice Compute the global index for a sorted 6-tuple.
    /// @dev Uses combinatorial formulas to avoid iterating through all tuples.
    /// Tuple must be sorted: a <= b <= c <= d <= e <= f, each in [1..10].
    function _indexSorted(uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f) internal pure returns (uint256 idx) {
        require(a >= 1 && f <= 10, "WinProbTable6: bad tuple");
        require(a <= b && b <= c && c <= d && d <= e && e <= f, "WinProbTable6: not sorted");

        // Count tuples lexicographically smaller using combinatorial formulas.
        // For each position, count how many valid tuples have a smaller value at that position.
        
        // Position 0 (a): count tuples where first element < a
        // For each value i, tuples starting with i have remaining 5 elements in [i, 10]
        // Count = C(10-i+1+5-1, 5) = C(15-i, 5)
        for (uint8 i = 1; i < a; i++) {
            idx += _c5(uint8(15 - i)); // C(15-i, 5)
        }
        
        // Position 1 (b): given a fixed, count tuples where second element < b
        // For j in [a, b-1], remaining 4 elements in [j, 10]: C(10-j+1+4-1, 4) = C(14-j, 4)
        for (uint8 j = a; j < b; j++) {
            idx += _c4(uint8(14 - j)); // C(14-j, 4)
        }
        
        // Position 2 (c): count tuples starting with (a,b) where third element < c
        // For k in [b, c-1], remaining 3 elements in [k, 10]: C(13-k, 3)
        for (uint8 k = b; k < c; k++) {
            idx += _c3(uint8(13 - k)); // C(13-k, 3)
        }
        
        // Position 3 (d): count tuples starting with (a,b,c) where fourth element < d
        // For l in [c, d-1], remaining 2 elements in [l, 10]: C(12-l, 2)
        for (uint8 l = c; l < d; l++) {
            idx += _c2(uint8(12 - l)); // C(12-l, 2)
        }
        
        // Position 4 (e): count tuples starting with (a,b,c,d) where fifth element < e
        // For m in [d, e-1], remaining 1 element in [m, 10]: C(11-m, 1) = 11-m
        for (uint8 m = d; m < e; m++) {
            idx += uint256(11 - m); // C(11-m, 1) = 11-m
        }
        
        // Position 5 (f): count tuples starting with (a,b,c,d,e) where sixth element < f
        // Just f - e (number of values in [e, f-1])
        idx += uint256(f - e);
    }

    function _c2(uint8 n) private pure returns (uint256) {
        if (n < 2) return 0;
        return (uint256(n) * uint256(n - 1)) / 2;
    }

    function _c3(uint8 n) private pure returns (uint256) {
        if (n < 3) return 0;
        return (uint256(n) * uint256(n - 1) * uint256(n - 2)) / 6;
    }

    function _c4(uint8 n) private pure returns (uint256) {
        if (n < 4) return 0;
        return (uint256(n) * uint256(n - 1) * uint256(n - 2) * uint256(n - 3)) / 24;
    }

    function _c5(uint8 n) private pure returns (uint256) {
        if (n < 5) return 0;
        return (uint256(n) * uint256(n - 1) * uint256(n - 2) * uint256(n - 3) * uint256(n - 4)) / 120;
    }

    /// @notice Get win probabilities for a sorted 6-tuple.
    /// @param a First score (smallest), b second, ..., f sixth (largest)
    /// @return probsBps Win probability in basis points for each sorted position
    function getSorted(uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f) 
        external 
        view 
        returns (uint16[LANE_COUNT] memory probsBps) 
    {
        uint256 idx = _indexSorted(a, b, c, d, e, f);
        return _getByIndex(idx);
    }

    /// @notice Get win probabilities by global table index.
    function _getByIndex(uint256 idx) internal view returns (uint16[LANE_COUNT] memory probsBps) {
        require(idx < TABLE_LEN, "WinProbTable6: index out of bounds");
        
${routingLogic}
    }

    /// @notice Convenience: get probabilities for any 6 scores (auto-sorts them).
    /// @dev Returns probabilities in the ORIGINAL order (not sorted order).
    /// This handles the permutation so callers don't need to sort themselves.
    function get(uint8[LANE_COUNT] memory scores) external view returns (uint16[LANE_COUNT] memory probsBps) {
        // Sort scores while tracking original indices
        uint8[LANE_COUNT] memory sorted;
        uint8[LANE_COUNT] memory sortedToOriginal;
        
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            sorted[i] = scores[i];
            sortedToOriginal[i] = i;
        }
        
        // Simple insertion sort (small fixed size)
        for (uint8 i = 1; i < LANE_COUNT; i++) {
            uint8 key = sorted[i];
            uint8 keyIdx = sortedToOriginal[i];
            uint8 j = i;
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                sortedToOriginal[j] = sortedToOriginal[j - 1];
                j--;
            }
            sorted[j] = key;
            sortedToOriginal[j] = keyIdx;
        }
        
        // Clamp scores to [1, 10]
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            if (sorted[i] < 1) sorted[i] = 1;
            if (sorted[i] > 10) sorted[i] = 10;
        }
        
        // Get probabilities for sorted tuple
        uint16[LANE_COUNT] memory sortedProbs = this.getSorted(
            sorted[0], sorted[1], sorted[2], sorted[3], sorted[4], sorted[5]
        );
        
        // Map back to original order
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            probsBps[sortedToOriginal[i]] = sortedProbs[i];
        }
    }
}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.samples) || args.samples <= 0) throw new Error("--samples must be > 0");
  if (!Number.isFinite(args.workers) || args.workers <= 0) throw new Error("--workers must be > 0");

  const startAt = Date.now();

  const checkpointAbs = path.resolve(args.checkpoint);
  const outDirAbs = path.resolve(args.outDir);
  fs.mkdirSync(path.dirname(checkpointAbs), { recursive: true });
  fs.mkdirSync(outDirAbs, { recursive: true });

  /** @type {{ idx: number, samples: number, rows: Array<{tuple:number[], probs:number[]}> }} */
  let checkpoint = { idx: 0, samples: args.samples, rows: [] };
  if (args.resume && fs.existsSync(checkpointAbs)) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointAbs, "utf8"));
    if (checkpoint.samples !== args.samples) {
      throw new Error(`Checkpoint samples=${checkpoint.samples} does not match --samples=${args.samples}`);
    }
    console.log(`Resuming from checkpoint: ${checkpoint.rows.length} rows`);
  }

  const tuples = Array.from(sortedScoreTuples6());
  const startIndex = checkpoint.rows.length;
  
  if (startIndex >= TOTAL_TUPLES) {
    console.log("Checkpoint already complete; emitting Solidity contracts...");
  } else {
    const workerCount = Math.min(args.workers, TOTAL_TUPLES - startIndex);
    console.log(`Workers: ${workerCount} | samples/tuple: ${args.samples} | total tuples: ${TOTAL_TUPLES}`);
    console.log(`Entry size: ${ENTRY_BYTES} bytes | Total table size: ~${Math.ceil((TOTAL_TUPLES * ENTRY_BYTES) / 1024)} KB`);
    console.log(`Shards: ${SHARD_COUNT} (${ENTRIES_PER_SHARD} entries each)`);

    /** @type {Worker[]} */
    const workers = [];
    /** @type {Array<{worker: Worker, busy: boolean}>} */
    const pool = [];

    let nextDispatch = startIndex;
    let nextCommit = startIndex;
    const pending = new Map(); // index -> { tuple, probs, tStartMs, tEndMs }
    let lastLogAt = Date.now();

    const dispatchOne = slot => {
      if (nextDispatch >= TOTAL_TUPLES) return false;
      const tuple = tuples[nextDispatch];
      const jobId = `${nextDispatch}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      slot.busy = true;
      slot.worker.postMessage({ type: "job", id: jobId, index: nextDispatch, tuple });
      slot.job = { id: jobId, index: nextDispatch, startedAt: Date.now() };
      nextDispatch++;
      return true;
    };

    const maybeCommit = () => {
      while (pending.has(nextCommit)) {
        const row = pending.get(nextCommit);
        pending.delete(nextCommit);

        checkpoint.rows.push({ tuple: row.tuple, probs: row.probs });
        checkpoint.idx = nextCommit + 1;
        fs.writeFileSync(checkpointAbs, JSON.stringify(checkpoint));

        nextCommit++;

        if (nextCommit % args.progressEvery === 0 || nextCommit === TOTAL_TUPLES) {
          const now = Date.now();
          const elapsedSec = (now - startAt) / 1000;
          const done = nextCommit;
          const pct = ((100 * done) / TOTAL_TUPLES).toFixed(1);
          const tuplesPerSec = done / Math.max(1e-9, elapsedSec);
          const remainingSec = (TOTAL_TUPLES - done) / Math.max(1e-9, tuplesPerSec);
          const simsPerSec = ((done * args.samples) / Math.max(1e-9, elapsedSec)).toFixed(0);

          const logEveryMs = 2000;
          if (now - lastLogAt >= logEveryMs || done === TOTAL_TUPLES) {
            lastLogAt = now;
            console.log(
              `[${pct}%] ${done}/${TOTAL_TUPLES} tuples | elapsed ${fmtDuration(elapsedSec)} | ETA ${fmtDuration(
                remainingSec,
              )} | ~${simsPerSec} sims/s | workers ${workerCount}`,
            );
          }
        }
      }
    };

    await new Promise((resolve, reject) => {
      let readyCount = 0;
      let finished = false;

      const onWorkerMessage = (slot, msg) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "ready") {
          readyCount++;
          if (readyCount === workerCount) {
            // Initial fill
            for (const s of pool) dispatchOne(s);
          }
          return;
        }
        if (msg.type === "error") {
          finished = true;
          reject(new Error(`Worker error on index=${msg.index}: ${msg.error}`));
          return;
        }
        if (msg.type !== "result") return;

        // Mark slot free
        slot.busy = false;

        pending.set(msg.index, { tuple: msg.tuple, probs: msg.probs });
        maybeCommit();

        // Keep dispatching
        if (!finished) dispatchOne(slot);

        if (nextCommit >= TOTAL_TUPLES && !finished) {
          finished = true;
          resolve();
        }
      };

      for (let i = 0; i < workerCount; i++) {
        const w = new Worker(new URL(import.meta.url), { workerData: { samples: args.samples }, type: "module" });
        const slot = { worker: w, busy: false, job: null };
        pool.push(slot);
        workers.push(w);
        w.on("message", msg => onWorkerMessage(slot, msg));
        w.on("error", err => {
          if (finished) return;
          finished = true;
          reject(err);
        });
        w.on("exit", code => {
          if (finished) return;
          if (code !== 0) {
            finished = true;
            reject(new Error(`Worker exited with code ${code}`));
          }
        });
      }
    });

    for (const w of workers) w.postMessage({ type: "stop" });
  }

  // Generate shard contracts
  console.log(`\nGenerating ${SHARD_COUNT} shard contracts...`);
  for (let shardIdx = 0; shardIdx < SHARD_COUNT; shardIdx++) {
    const startIdx = shardIdx * ENTRIES_PER_SHARD;
    const endIdx = Math.min(startIdx + ENTRIES_PER_SHARD, checkpoint.rows.length);
    const shardRows = checkpoint.rows.slice(startIdx, endIdx);
    
    const sol = generateShardContract(shardIdx, shardRows, startIdx);
    const shardPath = path.join(outDirAbs, `WinProbTableShard${shardIdx}.sol`);
    fs.writeFileSync(shardPath, sol);
    console.log(`  Wrote: ${shardPath} (${shardRows.length} entries, ~${Math.ceil((shardRows.length * ENTRY_BYTES) / 1024)} KB)`);
  }

  // Generate router contract
  const routerSol = generateRouterContract();
  const routerPath = path.join(outDirAbs, "WinProbTable6.sol");
  fs.writeFileSync(routerPath, routerSol);
  console.log(`  Wrote: ${routerPath}`);

  console.log(`\nCheckpoint: ${checkpointAbs}`);
  console.log(`Done! Total tuples: ${checkpoint.rows.length}`);
}

if (isMainThread) {
  await main();
} else {
  workerLoop();
}
