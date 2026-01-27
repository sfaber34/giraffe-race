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

// Single bet (for backwards compatibility)
export interface MyBet {
  amount: bigint;
  lane: number;
  claimed: boolean;
  hasBet: boolean;
}

// Bet types enum (matches contract)
export const BET_TYPE = {
  WIN: 0,
  PLACE: 1,
  SHOW: 2,
} as const;

export type BetType = (typeof BET_TYPE)[keyof typeof BET_TYPE];

// Individual bet info
export interface BetInfo {
  amount: bigint;
  lane: number;
  claimed: boolean;
  hasBet: boolean;
}

// All bets for a user in a race (Win/Place/Show)
export interface MyBets {
  win: BetInfo;
  place: BetInfo;
  show: BetInfo;
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

// Position info for finish order (1st, 2nd, or 3rd place)
export interface PositionInfo {
  lanes: number[]; // Lane indices in this position
  count: number; // Number of lanes (1 = normal, 2+ = dead heat)
}

// Complete finish order from contract (for Win/Place/Show betting)
export interface ParsedFinishOrder {
  first: PositionInfo;
  second: PositionInfo;
  third: PositionInfo;
  finalDistances: number[];
}
