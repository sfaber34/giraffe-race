"use client";

import { useMemo } from "react";
import { USDC_DECIMALS } from "../constants";
import { BET_TYPE, NextWinningClaim } from "../types";
import { LaneName } from "./LaneName";
import { formatUnits } from "viem";
import { RaffeAnimated } from "~~/components/assets/RaffeAnimated";

// Matches contract constant CLAIM_EXPIRATION_BLOCKS
const CLAIM_EXPIRATION_BLOCKS = 5400n;

interface ClaimPayoutCardProps {
  connectedAddress: `0x${string}` | undefined;
  raffeRaceContract: any;
  claimUiUnlocked: boolean;
  hasRevealedClaimSnapshot: boolean;
  displayedNextWinningClaim: NextWinningClaim | null;
  displayedWinningClaimRemaining: bigint | null;
  activeBlockNumber: bigint | null;
  onClaimPayout: () => Promise<void>;
}

const getBetTypeName = (betType: number): string => {
  switch (betType) {
    case BET_TYPE.WIN:
      return "Win";
    case BET_TYPE.PLACE:
      return "Place";
    case BET_TYPE.SHOW:
      return "Show";
    default:
      return "Win";
  }
};

interface CountdownState {
  blocksRemaining: bigint;
  percentRemaining: number;
  isExpired: boolean;
  colorClass: string;
}

export const ClaimPayoutCard = ({
  connectedAddress,
  raffeRaceContract,
  claimUiUnlocked,
  hasRevealedClaimSnapshot,
  displayedNextWinningClaim,
  displayedWinningClaimRemaining,
  activeBlockNumber,
  onClaimPayout,
}: ClaimPayoutCardProps) => {
  // Calculate countdown state based on settledAtBlock and current block
  const countdown = useMemo<CountdownState | null>(() => {
    if (!displayedNextWinningClaim?.hasClaim || !activeBlockNumber || displayedNextWinningClaim.settledAtBlock === 0n) {
      return null;
    }

    const expirationBlock = displayedNextWinningClaim.settledAtBlock + CLAIM_EXPIRATION_BLOCKS;

    if (activeBlockNumber >= expirationBlock) {
      return {
        blocksRemaining: 0n,
        percentRemaining: 0,
        isExpired: true,
        colorClass: "bg-error",
      };
    }

    const blocksRemaining = expirationBlock - activeBlockNumber;
    const percentRemaining = Number((blocksRemaining * 100n) / CLAIM_EXPIRATION_BLOCKS);

    // Color thresholds: green (>50%), yellow (20-50%), red (<20%)
    let colorClass = "bg-success";
    if (percentRemaining <= 20) {
      colorClass = "bg-error";
    } else if (percentRemaining <= 50) {
      colorClass = "bg-warning";
    }

    return {
      blocksRemaining,
      percentRemaining,
      isExpired: false,
      colorClass,
    };
  }, [displayedNextWinningClaim, activeBlockNumber]);

  // Estimate time remaining (2 seconds per block on Base)
  const timeRemaining = useMemo<string | null>(() => {
    if (!countdown || countdown.isExpired) return null;

    const secondsRemaining = Number(countdown.blocksRemaining) * 2;
    if (secondsRemaining >= 3600) {
      const hours = Math.floor(secondsRemaining / 3600);
      const minutes = Math.floor((secondsRemaining % 3600) / 60);
      return `~${hours}h ${minutes}m`;
    }
    if (secondsRemaining >= 60) {
      const minutes = Math.floor(secondsRemaining / 60);
      return `~${minutes}m`;
    }
    return `~${secondsRemaining}s`;
  }, [countdown]);

  return (
    <div className="card bg-base-100 border border-base-300 shadow-sm">
      <div className="card-body gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Claim payout</div>
          {connectedAddress && displayedWinningClaimRemaining !== null && displayedWinningClaimRemaining > 0n ? (
            <div className="badge badge-primary badge-sm">
              {displayedWinningClaimRemaining.toString()}
              <span className="ml-1 opacity-70">pending</span>
            </div>
          ) : null}
        </div>

        {!connectedAddress ? (
          <div className="text-xs opacity-70">Connect wallet to see your next claim.</div>
        ) : !claimUiUnlocked && !hasRevealedClaimSnapshot ? (
          <div className="text-xs opacity-70">Finish the replay to reveal claim status.</div>
        ) : !displayedNextWinningClaim ? (
          <div className="text-xs opacity-70">Loading claim status…</div>
        ) : !displayedNextWinningClaim.hasClaim ? (
          <div className="text-xs opacity-70">No claimable payouts.</div>
        ) : (
          <div className="space-y-3">
            {/* Your Bet */}
            <div className="flex items-center gap-3 p-2 rounded-lg bg-base-200/50">
              <RaffeAnimated
                idPrefix={`claim-${displayedNextWinningClaim.raceId.toString()}-${displayedNextWinningClaim.betLane}-${displayedNextWinningClaim.betTokenId.toString()}`}
                tokenId={displayedNextWinningClaim.betTokenId}
                playbackRate={1}
                playing={false}
                sizePx={48}
                className="flex-shrink-0"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-xs opacity-70">Your bet</span>
                <span className="text-sm font-medium">
                  {formatUnits(displayedNextWinningClaim.betAmount, USDC_DECIMALS)} USDC for{" "}
                  {displayedNextWinningClaim.betTokenId !== 0n ? (
                    <LaneName
                      tokenId={displayedNextWinningClaim.betTokenId}
                      fallback={`Lane ${displayedNextWinningClaim.betLane}`}
                    />
                  ) : (
                    `Lane ${displayedNextWinningClaim.betLane}`
                  )}{" "}
                  to{" "}
                  <span className="text-primary font-semibold">
                    {getBetTypeName(displayedNextWinningClaim.betType)}
                  </span>
                </span>
              </div>
            </div>

            {/* Payout */}
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-70">Payout</span>
              <span className="text-lg font-bold text-success">
                {formatUnits(displayedNextWinningClaim.payout, USDC_DECIMALS)} USDC
              </span>
            </div>

            {/* Claim Expiration Countdown */}
            {countdown && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="opacity-70">Claim expires in</span>
                  {countdown.isExpired ? (
                    <span className="text-error font-semibold">Expired</span>
                  ) : (
                    <span
                      className={
                        countdown.percentRemaining <= 20
                          ? "text-error"
                          : countdown.percentRemaining <= 50
                            ? "text-warning"
                            : ""
                      }
                    >
                      {countdown.blocksRemaining.toString()} blocks {timeRemaining && `(${timeRemaining})`}
                    </span>
                  )}
                </div>
                <div className="w-full h-2 bg-base-300 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${countdown.colorClass}`}
                    style={{ width: `${countdown.percentRemaining}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <button
          className="btn btn-sm btn-primary"
          disabled={
            !raffeRaceContract || !connectedAddress || !displayedNextWinningClaim?.hasClaim || countdown?.isExpired
          }
          onClick={onClaimPayout}
        >
          {countdown?.isExpired ? "Claim expired" : "Claim payout"}
        </button>
      </div>
    </div>
  );
};
