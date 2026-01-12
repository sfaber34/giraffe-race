import { DeterministicDice } from "./deterministicDice";
import { Hex } from "viem";

export type RaceSimulation = {
  winner: number;
  distances: number[];
  frames: number[][];
};

export function simulateRaceFromSeed({
  seed,
  animalCount = 4,
  tickCount = 40,
  speedRange = 6,
}: {
  seed: Hex;
  animalCount?: number;
  tickCount?: number;
  speedRange?: number;
}): RaceSimulation {
  const dice = new DeterministicDice(seed);
  const distances = Array.from({ length: animalCount }, () => 0);
  const frames: number[][] = [distances.slice()];

  for (let t = 0; t < tickCount; t++) {
    for (let a = 0; a < animalCount; a++) {
      const r = dice.roll(BigInt(speedRange)); // 0..speedRange-1
      distances[a] += Number(r + 1n); // 1..speedRange
    }
    frames.push(distances.slice());
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

  return { winner, distances, frames };
}
