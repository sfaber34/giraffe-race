import { Hex } from "viem";

export type RaceStatus = "no_race" | "cooldown" | "betting_open" | "betting_closed" | "settled";

export type PlaybackSpeed = 1 | 2 | 3;

export interface ParsedRace {
  bettingCloseBlock: bigint;
  settled: boolean;
  winner: number;
  seed: Hex;
  totalPot: bigint;
  totalOnLane: bigint[];
}

export interface ParsedSchedule {
  bettingCloseBlock: bigint;
  settledAtBlock: bigint;
}

export interface ParsedGiraffes {
  assignedCount: number;
  tokenIds: bigint[];
  originalOwners: readonly `0x${string}`[];
}

export interface ParsedOdds {
  oddsSet: boolean;
  oddsBps: bigint[];
}

export interface LaneStats {
  zip: number;
  moxie: number;
  hustle: number;
}

export interface CooldownStatus {
  canCreate: boolean;
  blocksRemaining: bigint;
  cooldownEndsAtBlock: bigint;
}

export interface MyBet {
  amount: bigint;
  lane: number;
  claimed: boolean;
  hasBet: boolean;
}

export interface NextWinningClaim {
  hasClaim: boolean;
  raceId: bigint;
  status: number;
  betLane: number;
  betTokenId: bigint;
  betAmount: bigint;
  winner: number;
  payout: bigint;
  bettingCloseBlock: bigint;
}

export interface ClaimSnapshot {
  nextWinningClaim: NextWinningClaim | null;
  winningClaimRemaining: bigint | null;
}

// Queue entry for the persistent race queue
export interface QueueEntry {
  index: bigint;
  tokenId: bigint;
  owner: `0x${string}`;
  isValid: boolean;
}
