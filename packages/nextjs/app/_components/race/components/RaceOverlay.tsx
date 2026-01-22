"use client";

import { USDC_DECIMALS } from "../constants";
import { CooldownStatus, MyBet, ParsedRace, ParsedSchedule, RaceStatus } from "../types";
import { BlockCountdownBar } from "./BlockCountdownBar";
import { LaneName } from "./LaneName";
import { formatUnits } from "viem";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";

interface RaceOverlayProps {
  // State
  status: RaceStatus;
  simulation: unknown | null;
  raceIsOver: boolean;
  isPlaying: boolean;
  raceStarted: boolean;
  frame: number;
  startDelayRemainingMs: number;
  goPhase: "solid" | "fade" | null;

  // Race data
  viewingRaceId: bigint | null;
  parsed: ParsedRace | null;
  parsedSchedule: ParsedSchedule | null;
  cooldownStatus: CooldownStatus | null;
  laneTokenIds: bigint[];

  // Bet data
  myBet: MyBet | null;
  estimatedPayoutWei: bigint | null;

  // Block data
  blockNumber: bigint | undefined;
  submissionCloseBlock: bigint | null;
  bettingCloseBlock: bigint | null;
  startBlock: bigint | null;

  // UI state
  submittedTokenId: bigint | null;
  ownedTokenNameById: Record<string, string>;

  // Actions
  onCreateRace: () => Promise<void>;
}

export const RaceOverlay = ({
  status,
  simulation,
  raceIsOver,
  isPlaying,
  raceStarted,
  frame,
  startDelayRemainingMs,
  goPhase,
  viewingRaceId,
  parsed,
  parsedSchedule,
  cooldownStatus,
  laneTokenIds,
  myBet,
  estimatedPayoutWei,
  blockNumber,
  submissionCloseBlock,
  bettingCloseBlock,
  startBlock,
  submittedTokenId,
  ownedTokenNameById,
  onCreateRace,
}: RaceOverlayProps) => {
  const revealedWinner = raceIsOver && parsed?.settled ? parsed.winner : null;
  const BETTING_WINDOW_BLOCKS = 10n;

  if (simulation) {
    // Race replay overlay (countdown, GO!, results)
    return (
      <>
        {goPhase ? (
          <div
            className={`flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg transition-opacity duration-[250ms] ${
              goPhase === "solid" ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="text-6xl font-black text-primary drop-shadow">GO!</div>
          </div>
        ) : isPlaying && !raceStarted && frame === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg">
            <div className="text-6xl font-black text-primary drop-shadow">
              {Math.max(1, Math.ceil(startDelayRemainingMs / 1000))}
            </div>
          </div>
        ) : raceIsOver && myBet?.hasBet && revealedWinner !== null ? (
          // User placed a bet - show win/lose result with cooldown
          <div
            className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg pointer-events-auto"
            style={{ minWidth: 320 }}
          >
            {myBet.lane === revealedWinner ? (
              <>
                <div className="text-4xl font-black text-success drop-shadow">Your bet hit!</div>
                <div className="text-xl font-semibold text-success/80">
                  {myBet.claimed
                    ? "Payout claimed"
                    : `Claim your ${estimatedPayoutWei ? formatUnits(estimatedPayoutWei, USDC_DECIMALS) : "—"} USDC payout below`}
                </div>
              </>
            ) : (
              <>
                <div className="text-4xl font-black text-error drop-shadow">Sorry</div>
                <div className="text-xl font-semibold text-error/80">Your bet didn&apos;t win</div>
              </>
            )}
            {cooldownStatus && cooldownStatus.cooldownEndsAtBlock > 0n && (
              <div className="w-full mt-2">
                <BlockCountdownBar
                  label={cooldownStatus.canCreate ? "Next race available" : "Next race in"}
                  current={blockNumber}
                  start={parsedSchedule?.settledAtBlock ?? undefined}
                  end={cooldownStatus.cooldownEndsAtBlock}
                />
              </div>
            )}
            <button
              className="btn btn-primary btn-sm mt-2"
              disabled={!cooldownStatus?.canCreate}
              onClick={onCreateRace}
            >
              Create Next Race
            </button>
          </div>
        ) : raceIsOver && revealedWinner !== null ? (
          // User did NOT place a bet - show race over with cooldown
          <div
            className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg pointer-events-auto"
            style={{ minWidth: 320 }}
          >
            <div className="text-3xl font-black text-primary drop-shadow">Race complete</div>
            <div className="text-lg font-semibold text-base-content/70 flex items-center gap-2">
              <span>Winner:</span>
              <GiraffeAnimated
                idPrefix={`overlay-winner-${(viewingRaceId ?? 0n).toString()}-${revealedWinner}`}
                tokenId={laneTokenIds[revealedWinner] ?? 0n}
                playbackRate={1}
                playing={true}
                sizePx={48}
              />
              <LaneName tokenId={laneTokenIds[revealedWinner] ?? 0n} fallback={`Lane ${revealedWinner}`} />
            </div>
            {cooldownStatus && cooldownStatus.cooldownEndsAtBlock > 0n && (
              <div className="w-full mt-2">
                <BlockCountdownBar
                  label={cooldownStatus.canCreate ? "Next race available" : "Next race in"}
                  current={blockNumber}
                  start={parsedSchedule?.settledAtBlock ?? undefined}
                  end={cooldownStatus.cooldownEndsAtBlock}
                />
              </div>
            )}
            <button
              className="btn btn-primary btn-sm mt-2"
              disabled={!cooldownStatus?.canCreate}
              onClick={onCreateRace}
            >
              Create Next Race
            </button>
          </div>
        ) : null}
      </>
    );
  }

  // Pre-race overlay (submissions open, awaiting finalization, betting open, bet placed, settled, cooldown)
  return (
    <>
      {status === "submissions_open" || status === "awaiting_finalization" ? (
        <div
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg"
          style={{ minWidth: 320 }}
        >
          <div className="text-3xl font-black text-primary drop-shadow">
            {status === "submissions_open" ? "Submissions open" : "Awaiting lineup"}
          </div>
          {submittedTokenId ? (
            <div className="text-xl font-semibold text-base-content/80 flex items-center gap-2">
              <span>You entered</span>
              <GiraffeAnimated
                idPrefix={`overlay-submitted-${(viewingRaceId ?? 0n).toString()}-${submittedTokenId.toString()}`}
                tokenId={submittedTokenId}
                playbackRate={1}
                playing={true}
                sizePx={48}
              />
              <span>
                {(ownedTokenNameById[submittedTokenId.toString()] || "").trim()
                  ? ownedTokenNameById[submittedTokenId.toString()]
                  : `#${submittedTokenId.toString()}`}
              </span>
            </div>
          ) : (
            <div className="text-lg font-semibold text-base-content/70">
              {status === "submissions_open" ? "Enter a giraffe" : "Waiting for finalization..."}
            </div>
          )}
          {status === "submissions_open" && (
            <div className="w-full mt-2">
              <BlockCountdownBar
                label="Submissions close in"
                current={blockNumber}
                start={startBlock ?? undefined}
                end={submissionCloseBlock ?? undefined}
              />
            </div>
          )}
          {status === "awaiting_finalization" && (
            <div className="w-full mt-2 text-sm text-base-content/60 text-center">
              Submissions closed. Waiting for lineup to be finalized.
            </div>
          )}
        </div>
      ) : status === "betting_open" ? (
        <div
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg"
          style={{ minWidth: 320 }}
        >
          {myBet?.hasBet ? (
            <>
              <div className="text-3xl font-black text-primary drop-shadow">Bet placed</div>
              <div className="text-lg font-semibold text-base-content/80 flex items-center gap-2">
                <span>You bet {formatUnits(myBet.amount, USDC_DECIMALS)} USDC on</span>
                <GiraffeAnimated
                  idPrefix={`overlay-bet-${(viewingRaceId ?? 0n).toString()}-${myBet.lane}`}
                  tokenId={laneTokenIds[myBet.lane] ?? 0n}
                  playbackRate={1}
                  playing={true}
                  sizePx={48}
                />
                <LaneName tokenId={laneTokenIds[myBet.lane] ?? 0n} fallback={`Lane ${myBet.lane}`} />
              </div>
              <div className="text-lg font-semibold text-base-content/70">
                Payout: {estimatedPayoutWei ? `${formatUnits(estimatedPayoutWei, USDC_DECIMALS)} USDC` : "—"}
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl font-black text-primary drop-shadow">Betting open</div>
              <div className="text-lg font-semibold text-base-content/70">Pick a giraffe to win</div>
            </>
          )}
          <div className="w-full mt-2">
            <BlockCountdownBar
              label="Betting closes in"
              current={blockNumber}
              start={bettingCloseBlock ? bettingCloseBlock - BETTING_WINDOW_BLOCKS : undefined}
              end={bettingCloseBlock ?? undefined}
            />
          </div>
        </div>
      ) : status === "betting_closed" ? (
        <div
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg"
          style={{ minWidth: 320 }}
        >
          {myBet?.hasBet ? (
            <>
              <div className="text-3xl font-black text-primary drop-shadow">Bet placed</div>
              <div className="text-lg font-semibold text-base-content/80 flex items-center gap-2">
                <span>You bet {formatUnits(myBet.amount, USDC_DECIMALS)} USDC on</span>
                <GiraffeAnimated
                  idPrefix={`overlay-bet-closed-${(viewingRaceId ?? 0n).toString()}-${myBet.lane}`}
                  tokenId={laneTokenIds[myBet.lane] ?? 0n}
                  playbackRate={1}
                  playing={true}
                  sizePx={48}
                />
                <LaneName tokenId={laneTokenIds[myBet.lane] ?? 0n} fallback={`Lane ${myBet.lane}`} />
              </div>
              <div className="text-lg font-semibold text-base-content/70">
                Payout: {estimatedPayoutWei ? `${formatUnits(estimatedPayoutWei, USDC_DECIMALS)} USDC` : "—"}
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl font-black text-primary drop-shadow">Betting closed</div>
              <div className="text-lg font-semibold text-base-content/70">Waiting for settlement</div>
            </>
          )}
        </div>
      ) : status === "settled" || status === "cooldown" ? (
        // Race is settled or in cooldown - show waiting for next race
        <div
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg pointer-events-auto"
          style={{ minWidth: 320 }}
        >
          <div className="text-3xl font-black text-primary drop-shadow">Race complete</div>
          {parsed?.winner !== undefined && (
            <div className="text-lg font-semibold text-base-content/70 flex items-center gap-2">
              <span>Winner:</span>
              <GiraffeAnimated
                idPrefix={`overlay-settled-winner-${(viewingRaceId ?? 0n).toString()}-${parsed.winner}`}
                tokenId={laneTokenIds[parsed.winner] ?? 0n}
                playbackRate={1}
                playing={true}
                sizePx={48}
              />
              <LaneName tokenId={laneTokenIds[parsed.winner] ?? 0n} fallback={`Lane ${parsed.winner}`} />
            </div>
          )}
          {cooldownStatus && cooldownStatus.cooldownEndsAtBlock > 0n && (
            <div className="w-full mt-2">
              <BlockCountdownBar
                label={cooldownStatus.canCreate ? "Next race available" : "Next race in"}
                current={blockNumber}
                start={parsedSchedule?.settledAtBlock ?? undefined}
                end={cooldownStatus.cooldownEndsAtBlock}
              />
            </div>
          )}
          <button className="btn btn-primary btn-sm mt-2" disabled={!cooldownStatus?.canCreate} onClick={onCreateRace}>
            Create Next Race
          </button>
        </div>
      ) : status === "no_race" ? (
        // No race exists - prompt to create one
        <div
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg pointer-events-auto"
          style={{ minWidth: 320 }}
        >
          <div className="text-3xl font-black text-primary drop-shadow">No race active</div>
          <div className="text-lg font-semibold text-base-content/70">Create a race to get started</div>
          <button className="btn btn-primary btn-sm mt-2" onClick={onCreateRace}>
            Create Race
          </button>
        </div>
      ) : null}
    </>
  );
};
