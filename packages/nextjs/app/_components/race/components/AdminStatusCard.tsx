"use client";

import { USDC_DECIMALS } from "../constants";
import { CooldownStatus, ParsedRace, ParsedSchedule, RaceStatus } from "../types";
import { BlockCountdownBar } from "./BlockCountdownBar";
import { formatUnits } from "viem";

interface AdminStatusCardProps {
  // Contract state
  isRaffeRaceLoading: boolean;
  raffeRaceContract: any;
  treasuryContract: any;
  usdcContract: any;

  // Race state
  status: RaceStatus;
  viewingRaceId: bigint | null;
  latestRaceId: bigint | null;
  isViewingLatest: boolean;
  parsed: ParsedRace | null;
  parsedSchedule: ParsedSchedule | null;

  // Block/timing
  blockNumber: bigint | undefined;
  bettingCloseBlock: bigint | null;
  cooldownStatus: CooldownStatus | null;

  // Treasury
  treasuryBalance: bigint | undefined;
  settledLiability: bigint | null;
  userUsdcBalance: bigint | undefined;
  connectedAddress: `0x${string}` | undefined;

  // Fund state
  fundAmountUsdc: string;
  setFundAmountUsdc: (value: string) => void;
  isFundingRace: boolean;

  // Actions
  onCreateRace: () => Promise<void>;
  onSettleRace: () => Promise<void>;
  onMineBlocks: (count: number) => Promise<void>;
  onFundTreasury: () => Promise<void>;

  // Flags
  activeRaceExists: boolean;
  isInCooldown: boolean;
  canSettle: boolean;
  isMining: boolean;
}

export const AdminStatusCard = ({
  isRaffeRaceLoading,
  raffeRaceContract,
  treasuryContract,
  usdcContract,
  status,
  viewingRaceId,
  latestRaceId,
  isViewingLatest,
  parsed,
  parsedSchedule,
  blockNumber,
  bettingCloseBlock,
  cooldownStatus,
  treasuryBalance,
  settledLiability,
  userUsdcBalance,
  connectedAddress,
  fundAmountUsdc,
  setFundAmountUsdc,
  isFundingRace,
  onCreateRace,
  onSettleRace,
  onMineBlocks,
  onFundTreasury,
  activeRaceExists,
  isInCooldown,
  canSettle,
  isMining,
}: AdminStatusCardProps) => {
  return (
    <div className="card bg-base-200 shadow">
      <div className="card-body gap-3">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Race status</h2>
          <div className="text-xs opacity-70">
            {isRaffeRaceLoading ? "Checking contract…" : raffeRaceContract ? "RaffeRace deployed" : "Not deployed"}
          </div>
        </div>

        {!raffeRaceContract ? (
          <div className="alert alert-info">
            <span className="text-sm">Deploy the contracts first (`yarn chain` + `yarn deploy`).</span>
          </div>
        ) : status === "no_race" ? (
          <div className="alert alert-info">
            <span className="text-sm">No active race. Create one to start betting!</span>
          </div>
        ) : (
          <div className="text-sm">
            <div className="flex justify-between">
              <span className="opacity-70">Viewing Race ID</span>
              <span className="font-mono">{viewingRaceId?.toString() ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Latest Race ID</span>
              <span className="font-mono">{latestRaceId?.toString() ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Status</span>
              <span className="font-semibold">
                {status === "awaiting_probabilities"
                  ? "⏳ Awaiting bot"
                  : status === "betting_open"
                    ? "Betting open"
                    : status === "betting_closed"
                      ? "Betting closed"
                      : "Settled"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Current block</span>
              <span className="font-mono">{blockNumber !== undefined ? blockNumber.toString() : "-"}</span>
            </div>
            {status === "awaiting_probabilities" && parsedSchedule?.oddsDeadlineBlock && (
              <div className="flex justify-between">
                <span className="opacity-70">Prob. deadline</span>
                <span className="font-mono">{parsedSchedule.oddsDeadlineBlock.toString()}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="opacity-70">Betting closes</span>
              <span className="font-mono">
                {bettingCloseBlock?.toString() ?? (status === "awaiting_probabilities" ? "—" : "-")}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Pot</span>
              <span>{parsed ? `${formatUnits(parsed.totalPot, USDC_DECIMALS)} USDC` : "-"}</span>
            </div>
          </div>
        )}

        <div className="divider my-1" />

        <div className="flex flex-col gap-3">
          {/* Probabilities window countdown (only during awaiting_probabilities phase) */}
          {status === "awaiting_probabilities" && parsedSchedule?.oddsDeadlineBlock && (
            <BlockCountdownBar
              label="⏳ Bot must set probabilities"
              current={blockNumber}
              start={parsedSchedule.oddsDeadlineBlock - 10n}
              end={parsedSchedule.oddsDeadlineBlock}
            />
          )}
          {/* Betting countdown (only after probabilities are set) */}
          {bettingCloseBlock && bettingCloseBlock > 0n && (
            <BlockCountdownBar
              label="Until betting closes"
              current={blockNumber}
              start={bettingCloseBlock - 30n}
              end={bettingCloseBlock}
            />
          )}
          {/* Settlement countdown (only after betting closes) */}
          {bettingCloseBlock && bettingCloseBlock > 0n && blockNumber && blockNumber >= bettingCloseBlock && (
            <BlockCountdownBar
              label="Until settlement available"
              current={blockNumber}
              start={bettingCloseBlock}
              end={bettingCloseBlock + 1n}
            />
          )}
          {/* Cooldown countdown (after settlement) */}
          {(status === "settled" || status === "cooldown") &&
            cooldownStatus &&
            cooldownStatus.cooldownEndsAtBlock > 0n && (
              <BlockCountdownBar
                label="Cooldown (next race)"
                current={blockNumber}
                start={parsedSchedule?.settledAtBlock ?? undefined}
                end={cooldownStatus.cooldownEndsAtBlock}
              />
            )}
        </div>

        <div className="divider my-1" />

        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">Race controls</div>
          {!isViewingLatest ? (
            <div className="text-xs opacity-70">
              You&apos;re viewing a past race. Switch to <span className="font-semibold">Latest</span> to manage the
              active race.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-primary"
              disabled={!raffeRaceContract || activeRaceExists || isInCooldown || !isViewingLatest}
              onClick={onCreateRace}
            >
              {isInCooldown && cooldownStatus
                ? `Cooldown (${cooldownStatus.blocksRemaining.toString()} blocks)`
                : "Create race"}
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={!raffeRaceContract || !canSettle || !isViewingLatest}
              onClick={onSettleRace}
            >
              Settle race
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-xs opacity-70">Mine blocks (local)</span>
            <button className="btn btn-xs" onClick={() => onMineBlocks(1)} disabled={isMining}>
              +1
            </button>
            <button className="btn btn-xs" onClick={() => onMineBlocks(10)} disabled={isMining}>
              +10
            </button>
            <button className="btn btn-xs" onClick={() => onMineBlocks(50)} disabled={isMining}>
              +50
            </button>
            <button className="btn btn-xs" onClick={() => onMineBlocks(100)} disabled={isMining}>
              +100
            </button>
            <button className="btn btn-xs" onClick={() => onMineBlocks(500)} disabled={isMining}>
              +500
            </button>
            <button className="btn btn-xs" onClick={() => onMineBlocks(1000)} disabled={isMining}>
              +1000
            </button>
          </div>
          <div className="text-xs opacity-70">
            {status === "awaiting_probabilities"
              ? "Waiting for bot to send probabilities (10 block window). Betting opens after."
              : "Lineup from queue → Bot sends probabilities → Contract calculates odds → Betting opens."}
          </div>
        </div>

        <div className="divider my-1" />

        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">Fund bankroll</div>
          {!treasuryContract ? (
            <div className="text-xs opacity-70">Deploy the contracts first to get the Treasury address.</div>
          ) : (
            <>
              <div className="text-xs">
                <div className="flex justify-between">
                  <span className="opacity-70">Treasury balance</span>
                  <span className="font-mono">
                    {treasuryBalance !== undefined ? `${formatUnits(treasuryBalance, USDC_DECIMALS)} USDC` : "-"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Unpaid liability</span>
                  <span className="font-mono">
                    {settledLiability === null ? "-" : `${formatUnits(settledLiability, USDC_DECIMALS)} USDC`}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="opacity-70">Available balance</span>
                  <span className="font-mono">
                    {treasuryBalance !== undefined && settledLiability !== null
                      ? `${formatUnits(treasuryBalance - settledLiability, USDC_DECIMALS)} USDC`
                      : "-"}
                  </span>
                </div>
                {connectedAddress && userUsdcBalance !== undefined && (
                  <div className="flex justify-between">
                    <span className="opacity-70">Your USDC</span>
                    <span className="font-mono">{formatUnits(userUsdcBalance, USDC_DECIMALS)} USDC</span>
                  </div>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input input-bordered input-sm w-full pr-16"
                  placeholder="Amount to send"
                  value={fundAmountUsdc}
                  onChange={e => setFundAmountUsdc(e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm opacity-70">USDC</span>
              </div>
              <button
                className="btn btn-sm btn-outline"
                disabled={
                  !connectedAddress ||
                  !treasuryContract?.address ||
                  !usdcContract?.address ||
                  isFundingRace ||
                  !fundAmountUsdc.trim()
                }
                onClick={onFundTreasury}
              >
                {isFundingRace ? <span className="loading loading-spinner loading-xs" /> : null}
                <span>{isFundingRace ? "Funding…" : "Send USDC to Treasury"}</span>
              </button>
              <div className="text-xs opacity-70">
                USDC is transferred to the Treasury contract (used to cover fixed-odds payouts).
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
