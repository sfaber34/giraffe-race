import { DeterministicDice } from "./deterministicDice";
import { Hex } from "viem";

export type RaceSimulation = {
  winner: number;
  distances: number[];
  frames: number[][];
  ticks: number;
};

const clampScore = (r: number) => {
  if (!Number.isFinite(r)) return 10;
  const x = Math.floor(r);
  if (x < 1) return 1;
  if (x > 10) return 10;
  return x;
};

// Match Solidity: minBps + (score-1) * (10000-minBps) / 9
const scoreBps = (score: number) => {
  const r = clampScore(score);
  const minBps = 9525;
  const range = 10_000 - minBps; // 475
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
  const leaders = distances
    .map((d, i) => ({ d, i }))
    .filter(x => x.d === best)
    .map(x => x.i);

  let winner: number;
  if (leaders.length === 1) {
    winner = leaders[0];
  } else {
    const pick = Number(dice.roll(BigInt(leaders.length)));
    winner = leaders[pick]!;
  }

  return { winner, distances, frames, ticks };
}
