import { Hex, encodePacked, keccak256 } from "viem";

export type RaceSimulation = {
  winner: number; // Primary winner (first in tie order, for backwards compatibility)
  winners: number[]; // All winners (length 1 = normal, length 2+ = dead heat)
  deadHeatCount: number; // 1 = normal win, 2+ = dead heat
  distances: number[];
  frames: number[][];
  ticks: number;
};

const clampScore = (r: number) => {
  // Clamp to [1, 10]
  if (!Number.isFinite(r)) return 1;
  const x = Math.floor(r);
  if (x === 0) return 10;
  if (x > 10) return 10;
  if (x < 1) return 1;
  return x;
};

// Match Solidity: minBps + (score-1) * (10000-minBps) / 9
const scoreBps = (score: number) => {
  const r = clampScore(score);
  // Tuning: reduce how much score=1 handicaps speed so extreme mismatches aren't ~50x longshots.
  const minBps = 9585;
  const range = 10_000 - minBps; // 415
  return minBps + Math.floor(((r - 1) * range) / 9);
};

/**
 * OPTIMIZED: Uses direct modulo (matches new Solidity GiraffeRaceSimulator).
 * One keccak256 per tick, direct byte extraction + modulo.
 *
 * Entropy layout per tick (32 bytes):
 *   Bytes 0-5:   Speed rolls for lanes 0-5 (1 byte each, % 10)
 *   Bytes 6-17:  Rounding rolls for lanes 0-5 (2 bytes each, % 10000)
 */
export function simulateRaceFromSeed({
  seed,
  laneCount = 6,
  maxTicks = 500,
  speedRange = 10,
  trackLength = 1000,
  score,
}: {
  seed: Hex;
  laneCount?: number;
  maxTicks?: number;
  speedRange?: number;
  trackLength?: number;
  score?: number[]; // length should match laneCount; defaults to all 10 (full score)
}): RaceSimulation {
  const distances = Array.from({ length: laneCount }, () => 0);
  const frames: number[][] = [distances.slice()];
  const bps = Array.from({ length: laneCount }, (_, i) => scoreBps(score?.[i] ?? 10));

  let finished = false;
  let ticks = 0;

  for (let t = 0; t < maxTicks; t++) {
    // One hash per tick - all entropy we need
    const tickEntropy = keccak256(encodePacked(["bytes32", "uint256"], [seed, BigInt(t)]));
    const entropyBytes = hexToBytes(tickEntropy);

    for (let a = 0; a < laneCount; a++) {
      // Speed roll: 1 byte, % speedRange, gives 0-(speedRange-1), then +1
      const baseSpeed = (entropyBytes[a]! % speedRange) + 1;

      // Apply handicap
      const raw = baseSpeed * bps[a]!;
      let q = Math.floor(raw / 10_000);
      const rem = raw % 10_000;

      // Probabilistic rounding using 2 bytes for rounding decision
      if (rem > 0) {
        // Extract 2 bytes for this lane's rounding roll (bytes 6-17)
        const roundingRoll = (entropyBytes[6 + a * 2]! << 8) | entropyBytes[7 + a * 2]!;
        // % 10000 gives 0-9999
        if (roundingRoll % 10_000 < rem) {
          q += 1;
        }
      }

      distances[a] += Math.max(1, q);
    }
    frames.push(distances.slice());
    ticks = t + 1;

    if (distances.some(d => d >= trackLength)) {
      finished = true;
      break;
    }
  }

  if (!finished) {
    throw new Error("Race did not finish (increase maxTicks?)");
  }

  const best = Math.max(...distances);
  const winners = distances
    .map((d, i) => ({ d, i }))
    .filter(x => x.d === best)
    .map(x => x.i);

  // Dead heat: return ALL winners, no random selection (matches Solidity)
  const winner = winners[0]!; // Primary winner for backwards compatibility
  const deadHeatCount = winners.length;

  return { winner, winners, deadHeatCount, distances, frames, ticks };
}

// Helper to convert hex string to byte array
function hexToBytes(hex: Hex): number[] {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < h.length; i += 2) {
    bytes.push(parseInt(h.slice(i, i + 2), 16));
  }
  return bytes;
}
