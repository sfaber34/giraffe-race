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
 * Handles both array format [zip, moxie, hustle] and object format {zip, moxie, hustle}
 * Viem returns tuples as arrays with named properties, so check array first
 */
export const parseStats = (raw: unknown): { zip: number; moxie: number; hustle: number } => {
  if (!raw) {
    return { zip: 10, moxie: 10, hustle: 10 };
  }

  // Handle array/tuple format FIRST (viem returns tuples as arrays with named properties)
  if (Array.isArray(raw) && raw.length >= 3) {
    return {
      zip: clampStat(Number(raw[0] ?? 10)),
      moxie: clampStat(Number(raw[1] ?? 10)),
      hustle: clampStat(Number(raw[2] ?? 10)),
    };
  }

  // Handle pure object format (not array)
  const obj = raw as any;
  if (typeof obj === "object" && ("zip" in obj || "moxie" in obj || "hustle" in obj)) {
    return {
      zip: clampStat(Number(obj.zip ?? 10)),
      moxie: clampStat(Number(obj.moxie ?? 10)),
      hustle: clampStat(Number(obj.hustle ?? 10)),
    };
  }

  return { zip: 10, moxie: 10, hustle: 10 };
};
