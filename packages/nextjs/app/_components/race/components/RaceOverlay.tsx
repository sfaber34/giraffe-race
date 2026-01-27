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
  bettingCloseBlock: bigint | null;

  // Actions
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
  bettingCloseBlock,
}: RaceOverlayProps) => {
  const revealedWinner = raceIsOver && parsed?.settled ? parsed.winner : null;
  const BETTING_WINDOW_BLOCKS = 30n;

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
          </div>
        ) : null}
      </>
    );
  }

  // Pre-race overlay (awaiting probabilities, betting open, bet placed, settled, cooldown, no race)
  return (
    <>
      {status === "awaiting_probabilities" ? (
        <div
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg"
          style={{ minWidth: 320 }}
        >
          <div className="text-3xl font-black text-warning drop-shadow">⏳ Awaiting bot</div>
          <div className="text-lg font-semibold text-base-content/70">Bot must set probabilities</div>
          <div className="text-sm text-base-content/50">Betting opens after probabilities are set</div>
          {parsedSchedule?.oddsDeadlineBlock && (
            <div className="w-full mt-2">
              <BlockCountdownBar
                label="Deadline"
                current={blockNumber}
                start={parsedSchedule.oddsDeadlineBlock - 10n}
                end={parsedSchedule.oddsDeadlineBlock}
              />
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
          <div className="text-sm text-base-content/60 mt-1">Waiting for the next race to begin…</div>
        </div>
      ) : status === "no_race" ? (
        // No race exists - prompt to create one
        <div
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg pointer-events-auto"
          style={{ minWidth: 320 }}
        >
          <div className="text-3xl font-black text-primary drop-shadow">No race active</div>
          <div className="text-lg font-semibold text-base-content/70">Waiting for the next race to be created…</div>
        </div>
      ) : null}
    </>
  );
};
