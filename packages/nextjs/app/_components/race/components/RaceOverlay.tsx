"use client";

import { USDC_DECIMALS } from "../constants";
import { CooldownStatus, MyBet, ParsedFinishOrder, ParsedRace, ParsedSchedule, RaceStatus } from "../types";
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
  parsedFinishOrder: ParsedFinishOrder | null;

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
  parsedFinishOrder,
  myBet,
  estimatedPayoutWei,
  blockNumber,
  bettingCloseBlock,
}: RaceOverlayProps) => {
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
        ) : raceIsOver && parsedFinishOrder ? (
          // Race is over - show all 3 places
          <div
            className="flex flex-col items-center gap-3 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg pointer-events-auto"
            style={{ minWidth: 400 }}
          >
            <div className="text-3xl font-black text-primary drop-shadow">Race complete</div>

            <div className="flex flex-col gap-2 w-full">
              {/* 1st Place */}
              {parsedFinishOrder.first.lanes.length > 0 && (
                <div className="flex items-center gap-2 text-base">
                  <span className="text-warning font-bold text-lg">1st:</span>
                  {parsedFinishOrder.first.lanes.map((lane, idx) => {
                    const tokenId = laneTokenIds[lane] ?? 0n;
                    return (
                      <div key={lane} className="flex items-center gap-1.5">
                        {idx > 0 && <span className="opacity-50">,</span>}
                        <GiraffeAnimated
                          idPrefix={`overlay-1st-${(viewingRaceId ?? 0n).toString()}-${lane}`}
                          tokenId={tokenId}
                          playbackRate={1}
                          playing={false}
                          sizePx={40}
                        />
                        <span className="font-semibold">
                          <LaneName tokenId={tokenId} fallback={`Lane ${lane}`} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 2nd Place */}
              {parsedFinishOrder.second.lanes.length > 0 && (
                <div className="flex items-center gap-2 text-base">
                  <span className="text-info font-bold text-lg">2nd:</span>
                  {parsedFinishOrder.second.lanes.map((lane, idx) => {
                    const tokenId = laneTokenIds[lane] ?? 0n;
                    return (
                      <div key={lane} className="flex items-center gap-1.5">
                        {idx > 0 && <span className="opacity-50">,</span>}
                        <GiraffeAnimated
                          idPrefix={`overlay-2nd-${(viewingRaceId ?? 0n).toString()}-${lane}`}
                          tokenId={tokenId}
                          playbackRate={1}
                          playing={false}
                          sizePx={40}
                        />
                        <span className="font-semibold">
                          <LaneName tokenId={tokenId} fallback={`Lane ${lane}`} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 3rd Place */}
              {parsedFinishOrder.third.lanes.length > 0 && (
                <div className="flex items-center gap-2 text-base">
                  <span className="text-success font-bold text-lg">3rd:</span>
                  {parsedFinishOrder.third.lanes.map((lane, idx) => {
                    const tokenId = laneTokenIds[lane] ?? 0n;
                    return (
                      <div key={lane} className="flex items-center gap-1.5">
                        {idx > 0 && <span className="opacity-50">,</span>}
                        <GiraffeAnimated
                          idPrefix={`overlay-3rd-${(viewingRaceId ?? 0n).toString()}-${lane}`}
                          tokenId={tokenId}
                          playbackRate={1}
                          playing={false}
                          sizePx={40}
                        />
                        <span className="font-semibold">
                          <LaneName tokenId={tokenId} fallback={`Lane ${lane}`} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
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
          <div className="text-3xl font-black text-primary drop-shadow">⏳ Setting odds</div>
          <div className="text-lg font-semibold text-base-content/70">Betting opens soon!</div>
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
              <div className="text-lg font-semibold text-base-content/70">Place your bets!</div>
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
              <div className="text-lg font-semibold text-base-content/70">Race starts soon!</div>
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
          <div className="text-3xl font-black text-primary drop-shadow">Loading...</div>
        </div>
      ) : null}
    </>
  );
};
