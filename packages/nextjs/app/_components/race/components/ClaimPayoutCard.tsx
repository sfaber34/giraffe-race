"use client";

import { USDC_DECIMALS } from "../constants";
import { BET_TYPE, NextWinningClaim } from "../types";
import { LaneName } from "./LaneName";
import { formatUnits } from "viem";
import { RaffeAnimated } from "~~/components/assets/RaffeAnimated";

// Blockhash is available for 256 blocks after bettingCloseBlock
const BLOCKHASH_WINDOW = 256n;

interface ClaimPayoutCardProps {
  connectedAddress: `0x${string}` | undefined;
  raffeRaceContract: any;
  claimUiUnlocked: boolean;
  hasRevealedClaimSnapshot: boolean;
  displayedNextWinningClaim: NextWinningClaim | null;
  displayedWinningClaimRemaining: bigint | null;
  activeBlockNumber: bigint | undefined;
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
  // Calculate countdown for payout lock
  const getCountdownInfo = () => {
    if (!displayedNextWinningClaim?.hasClaim || !activeBlockNumber) {
      return { blocksRemaining: 0n, progress: 0, isLocked: true };
    }

    const deadline = displayedNextWinningClaim.bettingCloseBlock + BLOCKHASH_WINDOW;
    const blocksRemaining = deadline > activeBlockNumber ? deadline - activeBlockNumber : 0n;
    const elapsed =
      activeBlockNumber > displayedNextWinningClaim.bettingCloseBlock
        ? activeBlockNumber - displayedNextWinningClaim.bettingCloseBlock
        : 0n;
    const progress = Number(elapsed) / Number(BLOCKHASH_WINDOW);
    const isLocked = blocksRemaining === 0n;

    return { blocksRemaining, progress: Math.min(progress, 1), isLocked };
  };

  const countdown = getCountdownInfo();

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

            {/* Countdown Bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="opacity-70">Time to claim</span>
                <span className={countdown.isLocked ? "text-error font-medium" : "font-mono"}>
                  {countdown.isLocked ? "Expired" : `${countdown.blocksRemaining.toString()} blocks`}
                </span>
              </div>
              <div className="w-full h-2 bg-base-300 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    countdown.progress > 0.8 ? "bg-error" : countdown.progress > 0.5 ? "bg-warning" : "bg-success"
                  }`}
                  style={{ width: `${(1 - countdown.progress) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <button
          className="btn btn-sm btn-primary"
          disabled={
            !raffeRaceContract || !connectedAddress || !displayedNextWinningClaim?.hasClaim || countdown.isLocked
          }
          onClick={onClaimPayout}
        >
          Claim payout
        </button>

        {countdown.isLocked && displayedNextWinningClaim?.hasClaim && (
          <div className="text-xs text-error opacity-70">
            Claim window has expired. The blockhash is no longer available.
          </div>
        )}
      </div>
    </div>
  );
};
