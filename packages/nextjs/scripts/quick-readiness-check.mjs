import { keccak256, toHex } from "viem";

/**
 * Quick Monte Carlo sanity check for readiness tuples.
 *
 * Usage:
 *   node packages/nextjs/scripts/quick-readiness-check.mjs --samples 20000
 */

// -----------------------
// Deterministic dice (matches Solidity + generator)
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

// -----------------------
// Readiness + race sim (must match Solidity)
// -----------------------

function clampReadiness(r) {
  const x = Math.floor(Number(r));
  if (!Number.isFinite(x)) return 10;
  if (x < 1) return 1;
  if (x > 10) return 10;
  return x;
}

function readinessBps(readiness, minBps) {
  const r = clampReadiness(readiness);
  const range = 10_000 - minBps;
  return minBps + Math.floor(((r - 1) * range) / 9);
}

/**
 * @param {object} p
 * @param {`0x${string}`} p.seed
 * @param {number[]} p.readiness length 4
 */
function simulateRaceFromSeed({ seed, readiness }) {
  const dice = new DeterministicDice(seed);
  const distances = [0, 0, 0, 0];
  const minBps = readiness.minBps ?? 9000;
  const bps = [0, 0, 0, 0].map((_, i) => readinessBps(readiness[i] ?? 10, minBps));

  const SPEED_RANGE = 10n;
  const TRACK_LENGTH = 1000;
  const MAX_TICKS = 500;
  const BPS_DENOM = 10_000;

  let finished = false;
  for (let t = 0; t < MAX_TICKS; t++) {
    for (let a = 0; a < 4; a++) {
      const r = dice.roll(SPEED_RANGE); // 0..9
      const baseSpeed = Number(r + 1n); // 1..10

      // Probabilistic rounding (matches Solidity)
      const raw = baseSpeed * bps[a];
      let q = Math.floor(raw / BPS_DENOM);
      const rem = raw % BPS_DENOM;
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
  for (let i = 0; i < 4; i++) if (distances[i] === best) leaders.push(i);
  if (leaders.length === 1) return leaders[0];
  const pick = Number(dice.roll(BigInt(leaders.length)));
  return leaders[pick];
}

// -----------------------
// Seed generation (same as generator)
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

function tupleKey([a, b, c, d]) {
  return (a & 0xf) | ((b & 0xf) << 4) | ((c & 0xf) << 8) | ((d & 0xf) << 12);
}

function parseArgs(argv) {
  const out = { samples: 20_000, minBps: 9525 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--samples") out.samples = Number(argv[++i]);
    else if (a === "--min-bps") out.minBps = Number(argv[++i]);
  }
  return out;
}

function winRates(tuple, samples) {
  const wins = [0, 0, 0, 0];
  const key = tupleKey(tuple);
  const state = { x: (BigInt(key) * 0x9e3779b97f4a7c15n) & MASK64 };
  for (let i = 0; i < samples; i++) {
    const seed = makeSeed32FromState(state);
    const w = simulateRaceFromSeed({ seed, readiness: tuple });
    wins[w] += 1;
  }
  return wins.map(w => w / samples);
}

function impliedOddsXFromPBps(pBps, houseEdgeBps = 500) {
  // matches AnimalRace: oBps = ODDS_SCALE*(ODDS_SCALE-HOUSE_EDGE_BPS)/pBps, where ODDS_SCALE=10000.
  const oBps = (10_000 * (10_000 - houseEdgeBps)) / Math.max(1, pBps);
  return oBps / 10_000;
}

const { samples, minBps } = parseArgs(process.argv.slice(2));
const tuples = [
  [1, 10, 10, 10],
  [9, 10, 10, 10],
  [9, 9, 9, 10],
  [1, 1, 10, 10],
];

for (const t of tuples) {
  // pass config via attached property (keeps function signatures minimal for quick iter)
  t.minBps = minBps;
  const rates = winRates(t, samples);
  const bps = rates.map(x => Math.round(x * 10_000));
  const odds = bps.map(p => impliedOddsXFromPBps(p).toFixed(2));
  console.log(
    `minBps=${minBps} tuple=${JSON.stringify(t)} rates=${rates.map(x => x.toFixed(4)).join(" ")} pBps=${bps.join(" ")} oddsX=${odds.join(" ")}`,
  );
}
