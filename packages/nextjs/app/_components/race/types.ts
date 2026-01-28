import { Hex } from "viem";

export type RaceStatus =
  | "no_race"
  | "awaiting_probabilities"
  | "betting_open"
  | "betting_closed"
  | "settled"
  | "cooldown";

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
  oddsDeadlineBlock: bigint; // Block by which bot must call setProbabilities()
  bettingCloseBlock: bigint; // Block when betting window closes (0 if probabilities not set yet)
  settledAtBlock: bigint; // Block when race was settled (0 if not settled)
}

export interface ParsedRaffes {
  assignedCount: number;
  tokenIds: bigint[];
  originalOwners: readonly `0x${string}`[];
}

export interface ParsedOdds {
  oddsSet: boolean;
  winOddsBps: bigint[]; // Win odds per lane (from setProbabilities)
  placeOddsBps: bigint[]; // Place odds per lane (from setProbabilities)
  showOddsBps: bigint[]; // Show odds per lane (from setProbabilities)
  /** @deprecated Use winOddsBps instead */
  oddsBps: bigint[]; // Backwards compat alias for winOddsBps
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
  betType: number; // 0=Win, 1=Place, 2=Show
  betLane: number;
  betTokenId: bigint;
  betAmount: bigint;
  winner: number;
  payout: bigint;
  bettingCloseBlock: bigint;
  settledAtBlock: bigint; // For claim expiration countdown
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
