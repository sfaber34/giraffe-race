"use client";

import { LANE_COUNT, USDC_DECIMALS } from "../constants";
import { LaneStats, MyBet, ParsedGiraffes, ParsedOdds } from "../types";
import { LaneName } from "./LaneName";
import { formatUnits } from "viem";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";

interface PlaceBetCardProps {
  // State
  viewingRaceId: bigint | null;
  lineupFinalized: boolean;
  laneTokenIds: bigint[];
  laneStats: LaneStats[];
  parsedGiraffes: ParsedGiraffes | null;
  parsedOdds: ParsedOdds | null;

  // Bet state
  betLane: number | null;
  setBetLane: (lane: number | null) => void;
  betAmountUsdc: string;
  setBetAmountUsdc: (amount: string) => void;
  placeBetValue: bigint | null;
  estimatedPayoutWei: bigint | null;

  // User state
  connectedAddress: `0x${string}` | undefined;
  userUsdcBalance: bigint | undefined;
  maxBetAmount: bigint | null;
  myBet: MyBet | null;
  selectedBetLane: number | null | undefined;

  // Flags
  canBet: boolean;
  isBetLocked: boolean;
  isViewingLatest: boolean;
  giraffeRaceContract: any;
  needsApproval: boolean;
  hasEnoughUsdc: boolean;
  exceedsMaxBet: boolean;
  isApproving: boolean;

  // Actions
  onApprove: () => Promise<void>;
  onPlaceBet: () => Promise<void>;
}

export const PlaceBetCard = ({
  viewingRaceId,
  lineupFinalized,
  laneTokenIds,
  laneStats,
  parsedGiraffes,
  parsedOdds,
  betLane,
  setBetLane,
  betAmountUsdc,
  setBetAmountUsdc,
  placeBetValue,
  estimatedPayoutWei,
  connectedAddress,
  userUsdcBalance,
  maxBetAmount,
  myBet,
  selectedBetLane,
  canBet,
  isBetLocked,
  isViewingLatest,
  giraffeRaceContract,
  needsApproval,
  hasEnoughUsdc,
  exceedsMaxBet,
  isApproving,
  onApprove,
  onPlaceBet,
}: PlaceBetCardProps) => {
  const oddsLabelForLane = (lane: number) => {
    if (!parsedOdds?.oddsSet) return "Odds —";
    const bps = Number(parsedOdds.oddsBps[lane] ?? 0n);
    if (!Number.isFinite(bps) || bps <= 0) return "Odds —";
    return `${(bps / 10_000).toFixed(2)}x`;
  };

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h3 className="font-semibold">Place a bet</h3>
        <p className="text-sm opacity-70">Betting opens after submissions close and the lineup is finalized.</p>

        <div className="flex flex-col gap-2 w-full">
          {Array.from({ length: LANE_COUNT }).map((_, lane) => {
            const isUserLockedBet = isBetLocked && selectedBetLane === lane;
            return (
              <button
                key={lane}
                className={`btn w-full justify-between h-auto py-3 min-h-[4.5rem] relative ${
                  selectedBetLane === lane ? "btn-primary" : "btn-outline"
                } ${
                  isUserLockedBet
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100 disabled:opacity-100 !bg-primary/20"
                    : ""
                }`}
                onClick={() => setBetLane(lane)}
                disabled={!canBet || isBetLocked}
                type="button"
              >
                {isUserLockedBet ? (
                  <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="badge badge-primary">YOUR BET</span>
                  </span>
                ) : null}
                <span className="flex items-center gap-2">
                  <GiraffeAnimated
                    idPrefix={`bet-${(viewingRaceId ?? 0n).toString()}-${lane}-${(laneTokenIds[lane] ?? 0n).toString()}`}
                    tokenId={laneTokenIds[lane] ?? 0n}
                    playbackRate={1}
                    playing={false}
                    sizePx={56}
                  />
                  {lineupFinalized && parsedGiraffes?.tokenIds?.[lane] && parsedGiraffes.tokenIds[lane] !== 0n ? (
                    <LaneName tokenId={parsedGiraffes.tokenIds[lane]} fallback={`Lane ${lane}`} />
                  ) : (
                    <span>Lane {lane}</span>
                  )}
                </span>
                <span className="flex flex-col items-end text-xs opacity-80">
                  <span>Zip {laneStats[lane]?.zip ?? 10}/10</span>
                  <span>Moxie {laneStats[lane]?.moxie ?? 10}/10</span>
                  <span>Hustle {laneStats[lane]?.hustle ?? 10}/10</span>
                  {lineupFinalized ? <span className="font-mono opacity-90">{oddsLabelForLane(lane)}</span> : null}
                </span>
              </button>
            );
          })}
        </div>

        {lineupFinalized && maxBetAmount !== null ? (
          <div className="text-xs opacity-70">Max bet: {formatUnits(maxBetAmount, USDC_DECIMALS)} USDC</div>
        ) : null}

        {isBetLocked ? (
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder="Bet amount (USDC)"
            value={myBet?.amount ? formatUnits(myBet.amount, USDC_DECIMALS) : ""}
            disabled
          />
        ) : (
          <div className={!canBet ? "opacity-50 pointer-events-none" : ""}>
            <div className="flex flex-col gap-1">
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input input-bordered w-full pr-16"
                  placeholder="Bet amount"
                  value={betAmountUsdc}
                  disabled={(!!placeBetValue && !needsApproval) || !!myBet?.hasBet}
                  onChange={e => {
                    if (!canBet) return;
                    setBetAmountUsdc(e.target.value);
                  }}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm opacity-70">USDC</span>
              </div>
              {connectedAddress && userUsdcBalance !== undefined && (
                <div className="text-xs opacity-60">Balance: {formatUnits(userUsdcBalance, USDC_DECIMALS)} USDC</div>
              )}
              {!needsApproval && placeBetValue && !myBet?.hasBet && (
                <div className="text-xs text-success">✓ Approved — ready to place bet</div>
              )}
            </div>
          </div>
        )}

        <div className="text-sm">
          <div className="flex justify-between">
            <span className="opacity-70">Estimated payout</span>
            <span className="font-mono">
              {estimatedPayoutWei === null ? "—" : `${formatUnits(estimatedPayoutWei, USDC_DECIMALS)} USDC`}
            </span>
          </div>
          <div className="text-xs opacity-60">Includes your stake. Fixed odds are locked at bet time.</div>
        </div>

        {exceedsMaxBet && maxBetAmount !== null && (
          <div className="text-xs text-error">
            Bet exceeds max bet of {formatUnits(maxBetAmount, USDC_DECIMALS)} USDC
          </div>
        )}

        {placeBetValue && userUsdcBalance !== undefined && userUsdcBalance !== null && !hasEnoughUsdc && (
          <div className="text-xs text-error">Insufficient USDC balance</div>
        )}

        {needsApproval ? (
          <button
            className="btn btn-primary"
            disabled={isApproving || !placeBetValue || !hasEnoughUsdc || !!myBet?.hasBet || exceedsMaxBet}
            onClick={onApprove}
          >
            {isApproving ? <span className="loading loading-spinner loading-xs" /> : null}
            Approve USDC
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={
              !giraffeRaceContract ||
              !connectedAddress ||
              !canBet ||
              betLane === null ||
              !placeBetValue ||
              !!myBet?.hasBet ||
              !isViewingLatest ||
              !hasEnoughUsdc ||
              exceedsMaxBet
            }
            onClick={onPlaceBet}
          >
            Place bet
          </button>
        )}
      </div>
    </div>
  );
};
