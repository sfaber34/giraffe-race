import { simulateRaceFromSeed } from "./simulateRace";
import { Hex, encodePacked, keccak256, toHex } from "viem";

export type MonteCarloOdds = {
  samples: number;
  edge: number; // 0.05 means 5%
  winCounts: [number, number, number, number];
  winProb: [number, number, number, number];
  // Decimal odds (return multiple, includes stake), after house edge and caps.
  decimalOdds: [number, number, number, number];
  // Profit multiple (excludes stake): decimalOdds - 1
  profitOdds: [number, number, number, number];
};

export type EstimateOddsParams = {
  raceId: bigint;
  tokenIds: readonly [bigint, bigint, bigint, bigint];
  readiness: readonly [number, number, number, number];
  samples?: number;
  edge?: number;
  // Prevent extreme odds when p is tiny.
  minProb?: number;
  // Keep odds sane (decimal odds include stake).
  minDecimalOdds?: number;
  maxDecimalOdds?: number;
  // Chunking keeps the UI responsive.
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: (p: { done: number; total: number }) => void;
};

// splitmix64: fast deterministic PRNG for generating seeds
// Reference constants are standard for SplitMix64.
const MASK64 = (1n << 64n) - 1n;
const SPLITMIX64_GAMMA = 0x9e3779b97f4a7c15n;
function splitmix64Next(state: { x: bigint }): bigint {
  state.x = (state.x + SPLITMIX64_GAMMA) & MASK64;
  let z = state.x;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

function clampReadiness(r: number): number {
  if (!Number.isFinite(r)) return 10;
  const x = Math.floor(r);
  if (x < 1) return 1;
  if (x > 10) return 10;
  return x;
}

function asTuple4<T>(arr: readonly T[]): [T, T, T, T] {
  if (arr.length !== 4) throw new Error("Expected length 4");
  return [arr[0]!, arr[1]!, arr[2]!, arr[3]!];
}

export async function estimateOddsMonteCarlo(params: EstimateOddsParams): Promise<MonteCarloOdds> {
  const {
    raceId,
    tokenIds,
    readiness,
    samples = 10_000,
    edge = 0.05,
    minProb = 1 / samples,
    minDecimalOdds = 1.01,
    maxDecimalOdds = 50,
    chunkSize = 250,
    signal,
    onProgress,
  } = params;

  if (samples <= 0) throw new Error("samples must be > 0");
  if (edge < 0 || edge >= 1) throw new Error("edge must be in [0, 1)");

  // Deterministic base seed per finalized lineup+readiness so every client quotes the same odds.
  const base: Hex = keccak256(
    encodePacked(
      ["uint256", "uint256", "uint256", "uint256", "uint256", "uint8", "uint8", "uint8", "uint8"],
      [
        raceId,
        tokenIds[0],
        tokenIds[1],
        tokenIds[2],
        tokenIds[3],
        clampReadiness(readiness[0]),
        clampReadiness(readiness[1]),
        clampReadiness(readiness[2]),
        clampReadiness(readiness[3]),
      ],
    ),
  );

  // Use SplitMix64 to generate 32-byte seeds cheaply (4x uint64).
  const prng = { x: (BigInt(base) ^ (raceId & MASK64)) & MASK64 };

  const wins = [0, 0, 0, 0] as [number, number, number, number];
  const r4 = asTuple4(readiness.map(clampReadiness));

  for (let i = 0; i < samples; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const a = splitmix64Next(prng);
    const b = splitmix64Next(prng);
    const c = splitmix64Next(prng);
    const d = splitmix64Next(prng);
    const seed256 = (a << 192n) | (b << 128n) | (c << 64n) | d;
    const seed = toHex(seed256, { size: 32 }) as Hex;

    const sim = simulateRaceFromSeed({ seed, readiness: r4 });
    wins[sim.winner] += 1;

    if (i % chunkSize === chunkSize - 1) {
      onProgress?.({ done: i + 1, total: samples });
      // Yield to keep the UI responsive.
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  onProgress?.({ done: samples, total: samples });

  const pRaw = wins.map(w => w / samples) as [number, number, number, number];
  const p = pRaw.map(x => Math.max(minProb, x)) as [number, number, number, number];
  const dec = p.map(pi => (1 - edge) / pi) as [number, number, number, number];
  const decCapped = dec.map(x => Math.max(minDecimalOdds, Math.min(maxDecimalOdds, x))) as [
    number,
    number,
    number,
    number,
  ];
  const profit = decCapped.map(x => x - 1) as [number, number, number, number];

  return {
    samples,
    edge,
    winCounts: wins,
    winProb: pRaw,
    decimalOdds: decCapped,
    profitOdds: profit,
  };
}
