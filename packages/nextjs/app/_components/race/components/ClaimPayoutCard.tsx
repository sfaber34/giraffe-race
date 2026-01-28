"use client";

import { USDC_DECIMALS } from "../constants";
import { BET_TYPE, NextWinningClaim } from "../types";
import { LaneName } from "./LaneName";
import { formatUnits } from "viem";
import { RaffeAnimated } from "~~/components/assets/RaffeAnimated";

interface ClaimPayoutCardProps {
  connectedAddress: `0x${string}` | undefined;
  raffeRaceContract: any;
  claimUiUnlocked: boolean;
  hasRevealedClaimSnapshot: boolean;
  displayedNextWinningClaim: NextWinningClaim | null;
  displayedWinningClaimRemaining: bigint | null;
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
  onClaimPayout,
}: ClaimPayoutCardProps) => {
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
          </div>
        )}

        <button
          className="btn btn-sm btn-primary"
          disabled={!raffeRaceContract || !connectedAddress || !displayedNextWinningClaim?.hasClaim}
          onClick={onClaimPayout}
        >
          Claim payout
        </button>
      </div>
    </div>
  );
};
