import os from "node:os";
import { keccak256, encodePacked, hexToBytes, toHex } from "viem";

/**
 * CLI Monte Carlo sanity checker for the 6-lane race sim.
 *
 * Usage examples:
 *   node packages/nextjs/scripts/monte-carlo-6lane.mjs --scores 10,10,10,10,10,10 --samples 50000
 *   node packages/nextjs/scripts/monte-carlo-6lane.mjs --scores 1,5,7,8,9,10 --samples 50000 --edge 0.05
 *
 * Notes:
 * - This script is intentionally self-contained (doesn't import TS) so it can run with plain Node.
 * - Simulation logic MUST match Solidity/TS rules:
 *   - DeterministicDice (nibble consumption + rejection sampling)
 *   - scoreBps mapping
 *   - probabilistic rounding
 *   - tie-break using dice.roll(leaders.length)
 */

// -----------------------
// DeterministicDice (matches TS/Solidity)
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

// -----------------------
// Race sim (matches TS/Solidity behavior)
// -----------------------

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
  // TUNING: reduce how much score=1 handicaps speed.
  // Baseline (original): minBps=9525 (0.9525x at score=1)
  // Target tuning: aim for ~30x odds (edge=5%) for [10,10,10,10,10,1]
  const minBps = 9585; // 0.9585x at score=1
  const range = 10_000 - minBps; // 415
  return minBps + Math.floor(((r - 1) * range) / 9);
}

/**
 * @param {object} p
 * @param {`0x${string}`} p.seed
 * @param {number[]} p.score length 6
 */
function simulateWinner6({ seed, score }) {
  const LANE_COUNT = 6;
  const SPEED_RANGE = 10n;
  const TRACK_LENGTH = 1000;
  const MAX_TICKS = 500;

  if (!Array.isArray(score) || score.length !== LANE_COUNT) throw new Error("score must be length 6");

  const dice = new DeterministicDice(seed);
  const distances = Array.from({ length: LANE_COUNT }, () => 0);
  const bps = Array.from({ length: LANE_COUNT }, (_, i) => scoreBps(score[i] ?? 10));

  let finished = false;
  for (let t = 0; t < MAX_TICKS; t++) {
    for (let a = 0; a < LANE_COUNT; a++) {
      const r = dice.roll(SPEED_RANGE); // 0..9
      const baseSpeed = Number(r + 1n); // 1..10

      // Probabilistic rounding (matches Solidity)
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
  const pick = Number(dice.roll(BigInt(leaders.length)));
  return leaders[pick];
}

// -----------------------
// PRNG: SplitMix64 (fast deterministic seed generator)
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
// CLI
// -----------------------

function parseArgs(argv) {
  const out = {
    scores: null,
    samples: 10_000,
    edge: null, // optional
    salt: "0",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scores") out.scores = String(argv[++i] ?? "");
    else if (a === "--samples") out.samples = Number(argv[++i]);
    else if (a === "--edge") out.edge = Number(argv[++i]);
    else if (a === "--salt") out.salt = String(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  console.log("monte-carlo-6lane.mjs");
  console.log("  --scores  s1,s2,s3,s4,s5,s6   (required; each 1..10)");
  console.log("  --samples N                  (default 10000)");
  console.log("  --edge   E                   (optional; prints implied decimal odds with edge, e.g. 0.05)");
  console.log("  --salt   X                   (optional domain separation; bigint parseable; default 0)");
}

function parseScores(s) {
  const parts = String(s)
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
  if (parts.length !== 6) throw new Error("Expected 6 comma-separated scores");
  return parts.map(x => clampScore(Number(x)));
}

function fmtPct(p) {
  return `${(p * 100).toFixed(3)}%`;
}

function fmtOdds(p, edge) {
  // decimal odds include stake: (1-edge)/p
  const pi = Math.max(1e-12, p);
  const o = (1 - edge) / pi;
  return `${o.toFixed(3)}x`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.scores) {
    usage();
    throw new Error("--scores is required");
  }
  if (!Number.isFinite(args.samples) || args.samples <= 0) throw new Error("--samples must be > 0");

  const scores = parseScores(args.scores);
  const salt = BigInt(args.salt);

  const base = keccak256(
    encodePacked(
      ["uint256", "uint8", "uint8", "uint8", "uint8", "uint8", "uint8"],
      [salt, scores[0], scores[1], scores[2], scores[3], scores[4], scores[5]],
    ),
  );

  const prng = { x: BigInt(base) & MASK64 };
  const wins = Array.from({ length: 6 }, () => 0);

  const started = Date.now();
  for (let i = 0; i < args.samples; i++) {
    const seed = makeSeed32FromState(prng);
    const w = simulateWinner6({ seed, score: scores });
    wins[w] += 1;
  }
  const elapsedMs = Date.now() - started;

  const probs = wins.map(w => w / args.samples);
  const sum = probs.reduce((a, b) => a + b, 0);

  console.log("---- Monte Carlo (6 lanes) ----");
  console.log("scores:", scores.join(","));
  console.log("samples:", args.samples);
  console.log("elapsed:", `${elapsedMs}ms`);
  console.log("host:", `${os.platform()} ${os.arch()} cpu=${os.cpus().length}`);
  console.log("sum(prob):", sum.toFixed(6));
  console.log("");

  const edge = args.edge;
  for (let i = 0; i < 6; i++) {
    const p = probs[i];
    const line = [`lane ${i}:`, `wins ${wins[i]}`, `p ${fmtPct(p)}`];
    if (edge !== null && Number.isFinite(edge) && edge >= 0 && edge < 1) {
      line.push(`odds@edge=${edge}: ${fmtOdds(p, edge)}`);
    }
    console.log(line.join(" | "));
  }
}

await main();

