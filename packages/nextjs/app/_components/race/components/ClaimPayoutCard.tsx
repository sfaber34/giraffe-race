"use client";

import { USDC_DECIMALS } from "../constants";
import { NextWinningClaim } from "../types";
import { LaneName } from "./LaneName";
import { formatUnits } from "viem";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";

interface ClaimPayoutCardProps {
  connectedAddress: `0x${string}` | undefined;
  giraffeRaceContract: any;
  claimUiUnlocked: boolean;
  hasRevealedClaimSnapshot: boolean;
  displayedNextWinningClaim: NextWinningClaim | null;
  displayedWinningClaimRemaining: bigint | null;
  onClaimPayout: () => Promise<void>;
}

export const ClaimPayoutCard = ({
  connectedAddress,
  giraffeRaceContract,
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
          <div className="text-xs">
            <div className="flex justify-between">
              <span className="opacity-70">Next payout race</span>
              <span className="font-mono">{displayedNextWinningClaim.raceId.toString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="opacity-70">Your bet</span>
              <span className="font-semibold text-right">
                <GiraffeAnimated
                  idPrefix={`claim-${displayedNextWinningClaim.raceId.toString()}-${displayedNextWinningClaim.betLane}-${displayedNextWinningClaim.betTokenId.toString()}`}
                  tokenId={displayedNextWinningClaim.betTokenId}
                  playbackRate={1}
                  playing={true}
                  sizePx={48}
                  className="inline-block align-middle"
                />{" "}
                {displayedNextWinningClaim.betTokenId !== 0n ? (
                  <LaneName
                    tokenId={displayedNextWinningClaim.betTokenId}
                    fallback={`Lane ${displayedNextWinningClaim.betLane}`}
                  />
                ) : (
                  `Lane ${displayedNextWinningClaim.betLane}`
                )}{" "}
                · {formatUnits(displayedNextWinningClaim.betAmount, USDC_DECIMALS)} USDC
              </span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Outcome</span>
              <span className="font-semibold text-success">Won</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Estimated payout</span>
              <span className="font-mono text-success">
                {formatUnits(displayedNextWinningClaim.payout, USDC_DECIMALS)} USDC
              </span>
            </div>
          </div>
        )}
        <button
          className="btn btn-sm btn-primary"
          disabled={!giraffeRaceContract || !connectedAddress || !displayedNextWinningClaim?.hasClaim}
          onClick={onClaimPayout}
        >
          Claim payout
        </button>
        <div className="text-xs opacity-70">
          {!claimUiUnlocked
            ? "Claim status may increase after the replay finishes."
            : "Claim is enabled only when you have a payout to claim."}
        </div>
      </div>
    </div>
  );
};
