import { DeterministicDice } from "./deterministicDice";
import { Hex } from "viem";

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

export function simulateRaceFromSeed({
  seed,
  laneCount = 4,
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
  const dice = new DeterministicDice(seed);
  const distances = Array.from({ length: laneCount }, () => 0);
  const frames: number[][] = [distances.slice()];
  const bps = Array.from({ length: laneCount }, (_, i) => scoreBps(score?.[i] ?? 10));

  let finished = false;
  let ticks = 0;

  for (let t = 0; t < maxTicks; t++) {
    for (let a = 0; a < laneCount; a++) {
      const r = dice.roll(BigInt(speedRange)); // 0..speedRange-1
      const baseSpeed = Number(r + 1n); // 1..speedRange
      // Probabilistic rounding (matches Solidity): avoids a chunky handicap from floor().
      const raw = baseSpeed * bps[a]!;
      let q = Math.floor(raw / 10_000);
      const rem = raw % 10_000;
      if (rem > 0) {
        const pick = Number(dice.roll(10_000n)); // 0..9999
        if (pick < rem) q += 1;
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
