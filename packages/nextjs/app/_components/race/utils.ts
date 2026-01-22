import { USDC_DECIMALS } from "./constants";
import { formatUnits } from "viem";

/**
 * Clamp a value between 0 and 1
 */
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Format a USDC amount for display
 */
export const formatUsdc = (amount: bigint): string => {
  return formatUnits(amount, USDC_DECIMALS);
};

/**
 * Clamp a stat value between 1 and 10
 */
export const clampStat = (n: number): number => Math.max(1, Math.min(10, Math.floor(n)));

/**
 * Parse stats from raw contract data
 */
export const parseStats = (raw: unknown): { zip: number; moxie: number; hustle: number } => {
  const t = (Array.isArray(raw) ? raw : []) as any[];
  return {
    zip: clampStat(Number(t[0] ?? 10)),
    moxie: clampStat(Number(t[1] ?? 10)),
    hustle: clampStat(Number(t[2] ?? 10)),
  };
};
