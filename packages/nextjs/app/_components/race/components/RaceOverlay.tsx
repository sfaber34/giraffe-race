"use client";

import { MyBets, ParsedFinishOrder, ParsedRace, ParsedSchedule, RaceStatus } from "../types";
import { BlockCountdownBar } from "./BlockCountdownBar";
import { LaneName } from "./LaneName";
import { RaffeAnimated } from "~~/components/assets/RaffeAnimated";

/* ─────────────────────────────────────────────────────────────────────────────
 * RaceResultsOverlay - Reusable component for showing race finish results
 * ───────────────────────────────────────────────────────────────────────────── */

interface RaceResultsOverlayProps {
  idPrefix: string;
  viewingRaceId: bigint | null;
  laneTokenIds: bigint[];
  parsedFinishOrder: ParsedFinishOrder | null;
  parsed: ParsedRace | null;
  parsedSchedule: ParsedSchedule | null;
  blockNumber: bigint | undefined;
  myBets: MyBets | null;
}

const RaceResultsOverlay = ({
  idPrefix,
  viewingRaceId,
  laneTokenIds,
  parsedFinishOrder,
  parsed,
  parsedSchedule,
  blockNumber,
  myBets,
}: RaceResultsOverlayProps) => {
  const raceIdStr = (viewingRaceId ?? 0n).toString();

  // Check if user placed any bets and if any won
  const hasAnyBet = myBets?.win.hasBet || myBets?.place.hasBet || myBets?.show.hasBet;

  let winningBetCount = 0;
  if (myBets && parsedFinishOrder) {
    const firstLanes = parsedFinishOrder.first.lanes;
    const secondLanes = parsedFinishOrder.second.lanes;
    const thirdLanes = parsedFinishOrder.third.lanes;

    // Win bet: lane must be in 1st
    if (myBets.win.hasBet && firstLanes.includes(myBets.win.lane)) winningBetCount++;
    // Place bet: lane must be in 1st or 2nd
    if (myBets.place.hasBet && (firstLanes.includes(myBets.place.lane) || secondLanes.includes(myBets.place.lane)))
      winningBetCount++;
    // Show bet: lane must be in 1st, 2nd, or 3rd
    if (
      myBets.show.hasBet &&
      (firstLanes.includes(myBets.show.lane) ||
        secondLanes.includes(myBets.show.lane) ||
        thirdLanes.includes(myBets.show.lane))
    )
      winningBetCount++;
  }

  return (
    <div
      className="flex flex-col items-center gap-3 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg pointer-events-auto"
      style={{ minWidth: 400 }}
    >
      <div className="text-3xl font-black text-primary drop-shadow">Race complete</div>

      {hasAnyBet && (
        <div className={`text-lg font-semibold ${winningBetCount > 0 ? "text-success" : "text-base-content/70"}`}>
          {winningBetCount > 0
            ? `Your bet${winningBetCount > 1 ? "s" : ""} hit! Claim your winnings below`
            : "Sorry, none of your bets hit"}
        </div>
      )}

      {parsedFinishOrder ? (
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
                    <RaffeAnimated
                      idPrefix={`${idPrefix}-1st-${raceIdStr}-${lane}`}
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
                    <RaffeAnimated
                      idPrefix={`${idPrefix}-2nd-${raceIdStr}-${lane}`}
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
                    <RaffeAnimated
                      idPrefix={`${idPrefix}-3rd-${raceIdStr}-${lane}`}
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
      ) : parsed?.winner !== undefined ? (
        // Fallback to just winner if no finish order data
        <div className="text-lg font-semibold text-base-content/70 flex items-center gap-2">
          <span>Winner:</span>
          <RaffeAnimated
            idPrefix={`${idPrefix}-winner-${raceIdStr}-${parsed.winner}`}
            tokenId={laneTokenIds[parsed.winner] ?? 0n}
            playbackRate={1}
            playing={false}
            sizePx={40}
          />
          <LaneName tokenId={laneTokenIds[parsed.winner] ?? 0n} fallback={`Lane ${parsed.winner}`} />
        </div>
      ) : null}

      {parsedSchedule?.settledAtBlock && (
        <div className="w-full mt-2">
          <BlockCountdownBar
            label="Next race in"
            current={blockNumber}
            start={parsedSchedule.settledAtBlock}
            end={parsedSchedule.settledAtBlock + 30n}
          />
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * RaceOverlay - Main overlay component
 * ───────────────────────────────────────────────────────────────────────────── */

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
  laneTokenIds: bigint[];
  parsedFinishOrder: ParsedFinishOrder | null;
  myBets: MyBets | null;

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
  laneTokenIds,
  parsedFinishOrder,
  myBets,
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
        ) : raceIsOver ? (
          <RaceResultsOverlay
            idPrefix="overlay-sim"
            viewingRaceId={viewingRaceId}
            laneTokenIds={laneTokenIds}
            parsedFinishOrder={parsedFinishOrder}
            parsed={parsed}
            parsedSchedule={parsedSchedule}
            blockNumber={blockNumber}
            myBets={myBets}
          />
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
          <div className="text-3xl font-black text-primary drop-shadow">Setting odds</div>
          <div className="text-lg font-semibold text-base-content/70">Betting opens soon!</div>
        </div>
      ) : status === "betting_open" ? (
        <div
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-2xl bg-base-100/90 backdrop-blur-sm shadow-lg"
          style={{ minWidth: 320 }}
        >
          <div className="text-3xl font-black text-primary drop-shadow">Betting open</div>
          <div className="text-lg font-semibold text-base-content/70">Place your bets!</div>
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
          <div className="text-3xl font-black text-primary drop-shadow">Betting closed</div>
          <div className="text-lg font-semibold text-base-content/70">Race starts soon!</div>
        </div>
      ) : status === "settled" || status === "cooldown" ? (
        <RaceResultsOverlay
          idPrefix="overlay-settled"
          viewingRaceId={viewingRaceId}
          laneTokenIds={laneTokenIds}
          parsedFinishOrder={parsedFinishOrder}
          parsed={parsed}
          parsedSchedule={parsedSchedule}
          blockNumber={blockNumber}
          myBets={myBets}
        />
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
