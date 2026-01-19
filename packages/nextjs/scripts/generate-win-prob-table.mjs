import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { keccak256, toHex } from "viem";

/**
 * Precompute win probabilities by effective score (1-10) for 4-lane races.
 *
 * We compute only sorted score tuples (a<=b<=c<=d), count = 715.
 * The resulting table stores per-position win probabilities (basis points, 0..10000) for the sorted order.
 *
 * Output:
 * - JSON checkpoint (optional)
 * - Solidity library file containing a packed hex table (uint16 bps x 4 lanes per entry)
 *
 * Usage:
 *   node packages/nextjs/scripts/generate-win-prob-table.mjs --samples 50000
 *
 * Flags:
 *   --samples N          (default 50000) Monte Carlo samples per sorted tuple
 *   --workers W          (default cpuCount-1, capped at 12) number of worker threads
 *   --out-sol PATH       (default packages/foundry/contracts/libraries/WinProbTable.sol)
 *   --checkpoint PATH    (default packages/nextjs/generated/win-prob-checkpoint.json)
 *   --resume             resume from checkpoint if present
 *   --progress-every M   print progress every M tuples (default 5)
 */

// -----------------------
// Race sim (JS port of TS)
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
  if (!Number.isFinite(x)) return 10;
  if (x < 1) return 1;
  if (x > 10) return 10;
  return x;
}

// Match Solidity/TS: minBps + (score-1) * (10000-minBps) / 9
function scoreBps(score) {
  const r = clampScore(score);
  const minBps = 9525;
  const range = 10_000 - minBps; // 475
  return minBps + Math.floor(((r - 1) * range) / 9);
}

/**
 * @param {object} p
 * @param {`0x${string}`} p.seed
 * @param {number[]} p.score length 4
 */
function simulateRaceFromSeed({ seed, score }) {
  const dice = new DeterministicDice(seed);
  const distances = [0, 0, 0, 0];
  const bps = [0, 0, 0, 0].map((_, i) => scoreBps(score[i] ?? 10));

  // constants (must match Solidity)
  const SPEED_RANGE = 10n;
  const TRACK_LENGTH = 1000;
  const MAX_TICKS = 500;

  let finished = false;
  for (let t = 0; t < MAX_TICKS; t++) {
    for (let a = 0; a < 4; a++) {
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
    if (
      distances[0] >= TRACK_LENGTH ||
      distances[1] >= TRACK_LENGTH ||
      distances[2] >= TRACK_LENGTH ||
      distances[3] >= TRACK_LENGTH
    ) {
      finished = true;
      break;
    }
  }
  if (!finished) throw new Error("Race did not finish");

  const best = Math.max(...distances);
  const leaders = [];
  for (let i = 0; i < 4; i++) if (distances[i] === best) leaders.push(i);
  if (leaders.length === 1) return leaders[0];
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
    outSol: "packages/foundry/contracts/libraries/WinProbTable.sol",
    checkpoint: "packages/nextjs/generated/win-prob-checkpoint.json",
    resume: false,
    progressEvery: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--samples") out.samples = Number(argv[++i]);
    else if (a === "--workers") out.workers = Number(argv[++i]);
    else if (a === "--out-sol") out.outSol = String(argv[++i]);
    else if (a === "--checkpoint") out.checkpoint = String(argv[++i]);
    else if (a === "--resume") out.resume = true;
    else if (a === "--progress-every") out.progressEvery = Number(argv[++i]);
  }
  return out;
}

function* sortedScoreTuples() {
  for (let a = 1; a <= 10; a++) {
    for (let b = a; b <= 10; b++) {
      for (let c = b; c <= 10; c++) {
        for (let d = c; d <= 10; d++) {
          yield [a, b, c, d];
        }
      }
    }
  }
}

function tupleKey([a, b, c, d]) {
  // pack into 16 bits (4 nybbles)
  return (a & 0xf) | ((b & 0xf) << 4) | ((c & 0xf) << 8) | ((d & 0xf) << 12);
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
  const wins = [0, 0, 0, 0];
  const key = tupleKey(tuple);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.samples) || args.samples <= 0) throw new Error("--samples must be > 0");
  if (!Number.isFinite(args.workers) || args.workers <= 0) throw new Error("--workers must be > 0");

  const totalTuples = 715;
  const startAt = Date.now();

  const checkpointAbs = path.resolve(args.checkpoint);
  const outSolAbs = path.resolve(args.outSol);
  fs.mkdirSync(path.dirname(checkpointAbs), { recursive: true });
  fs.mkdirSync(path.dirname(outSolAbs), { recursive: true });

  /** @type {{ idx: number, samples: number, rows: Array<{tuple:number[], probs:number[]}> }} */
  let checkpoint = { idx: 0, samples: args.samples, rows: [] };
  if (args.resume && fs.existsSync(checkpointAbs)) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointAbs, "utf8"));
    if (checkpoint.samples !== args.samples) {
      throw new Error(`Checkpoint samples=${checkpoint.samples} does not match --samples=${args.samples}`);
    }
    console.log(`Resuming from checkpoint: ${checkpoint.rows.length} rows`);
  }

  const tableBytes = [];
  for (const row of checkpoint.rows) {
    const probs = row.probs;
    for (let i = 0; i < 4; i++) tableBytes.push(...encodeU16BE(probs[i]));
  }

  const tuples = Array.from(sortedScoreTuples());
  const startIndex = checkpoint.rows.length;
  if (startIndex >= totalTuples) {
    console.log("Checkpoint already complete; emitting Solidity table...");
  } else {
    const workerCount = Math.min(args.workers, totalTuples - startIndex);
    console.log(`Workers: ${workerCount} | samples/tuple: ${args.samples} | total tuples: ${totalTuples}`);

    /** @type {Worker[]} */
    const workers = [];
    /** @type {Array<{worker: Worker, busy: boolean}>} */
    const pool = [];

    let nextDispatch = startIndex;
    let nextCommit = startIndex;
    const pending = new Map(); // index -> { tuple, probs, tStartMs, tEndMs }
    let lastLogAt = Date.now();

    const dispatchOne = slot => {
      if (nextDispatch >= totalTuples) return false;
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

        const probs = row.probs;
        for (let i = 0; i < 4; i++) tableBytes.push(...encodeU16BE(probs[i]));
        checkpoint.rows.push({ tuple: row.tuple, probs });
        checkpoint.idx = nextCommit + 1;
        fs.writeFileSync(checkpointAbs, JSON.stringify(checkpoint));

        nextCommit++;

        if (nextCommit % args.progressEvery === 0 || nextCommit === totalTuples) {
          const now = Date.now();
          const elapsedSec = (now - startAt) / 1000;
          const done = nextCommit;
          const pct = ((100 * done) / totalTuples).toFixed(1);
          const tuplesPerSec = done / Math.max(1e-9, elapsedSec);
          const remainingSec = (totalTuples - done) / Math.max(1e-9, tuplesPerSec);
          const simsPerSec = ((done * args.samples) / Math.max(1e-9, elapsedSec)).toFixed(0);

          const logEveryMs = 1000;
          if (now - lastLogAt >= logEveryMs || done === totalTuples) {
            lastLogAt = now;
            console.log(
              `[${pct}%] ${done}/${totalTuples} tuples | elapsed ${fmtDuration(elapsedSec)} | ETA ${fmtDuration(
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

        if (nextCommit >= totalTuples && !finished) {
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

  const hex = Buffer.from(Uint8Array.from(tableBytes)).toString("hex");
  const sol = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Readiness win probability lookup table (4 lanes).
/// @dev Index order is all sorted tuples (a<=b<=c<=d) with a,b,c,d in [1..10], in nested-loop order.
/// Each entry is 8 bytes: 4x uint16 (basis points) in big-endian.
/// @dev This is a deployable contract (not a library) so \`GiraffeRace\` doesn't exceed the 24KB size limit.
contract WinProbTable {
    uint256 internal constant ENTRY_BYTES = 8;
    uint256 internal constant TABLE_LEN = 715;

    bytes internal constant TABLE = hex"${hex}";

    function _indexSorted(uint8 a, uint8 b, uint8 c, uint8 d) internal pure returns (uint256 idx) {
        // Rank in nested-loop order without brute-forcing all 715 entries.
        // Count of nondecreasing length-r sequences from [s..10] is C((10-s+1)+r-1, r).
        if (a < 1 || d > 10) revert("WinProbTable: bad tuple");
        if (a > b || b > c || c > d) revert("WinProbTable: bad tuple");

        for (uint8 i = 1; i < a; i++) {
            idx += _c3(uint8(13 - i)); // C((10-i)+3,3) = C(13-i,3)
        }
        for (uint8 j = a; j < b; j++) {
            idx += _c2(uint8(12 - j)); // C(12-j,2)
        }
        for (uint8 k = b; k < c; k++) {
            idx += uint256(11 - k); // C(11-k,1)
        }
        idx += uint256(d - c); // C(_,0)
    }

    function _c2(uint8 n) private pure returns (uint256) {
        if (n < 2) return 0;
        return (uint256(n) * uint256(n - 1)) / 2;
    }

    function _c3(uint8 n) private pure returns (uint256) {
        if (n < 3) return 0;
        return (uint256(n) * uint256(n - 1) * uint256(n - 2)) / 6;
    }

    function getSorted(uint8 a, uint8 b, uint8 c, uint8 d) external pure returns (uint16[4] memory probsBps) {
        uint256 idx = _indexSorted(a, b, c, d);
        uint256 off = idx * ENTRY_BYTES;
        probsBps[0] = _u16be(off);
        probsBps[1] = _u16be(off + 2);
        probsBps[2] = _u16be(off + 4);
        probsBps[3] = _u16be(off + 6);
    }

    function _u16be(uint256 off) private pure returns (uint16 v) {
        // TABLE is a constant bytes, so bounds are guaranteed by construction.
        uint8 hi = uint8(TABLE[off]);
        uint8 lo = uint8(TABLE[off + 1]);
        v = (uint16(hi) << 8) | uint16(lo);
    }
}
`;

  fs.mkdirSync(path.dirname(outSolAbs), { recursive: true });
  fs.writeFileSync(outSolAbs, sol);
  console.log(`Wrote Solidity table: ${outSolAbs}`);
  console.log(`Checkpoint: ${checkpointAbs}`);
}

if (isMainThread) {
  await main();
} else {
  workerLoop();
}
