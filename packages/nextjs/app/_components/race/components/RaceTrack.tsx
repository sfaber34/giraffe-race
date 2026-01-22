"use client";

import {
  BASE_REPLAY_SPEED_MULTIPLIER,
  GIRAFFE_SIZE_PX,
  LANE_COUNT,
  LANE_GAP_PX,
  LANE_HEIGHT_PX,
  SPEED_RANGE,
  TRACK_HEIGHT_PX,
  TRACK_LENGTH,
  TRACK_LENGTH_PX,
  WORLD_PADDING_LEFT_PX,
  WORLD_WIDTH_PX,
} from "../constants";
import { MyBet, ParsedGiraffes, PlaybackSpeed } from "../types";
import { LaneName } from "./LaneName";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";

interface RaceTrackProps {
  // Viewport refs
  cameraScrollRefCb: (el: HTMLDivElement | null) => void;

  // Race state
  simulation: unknown | null;
  lineupFinalized: boolean;
  parsedGiraffes: ParsedGiraffes | null;
  currentDistances: number[];
  prevDistances: number[];

  // Replay state
  isPlaying: boolean;
  raceStarted: boolean;
  frame: number;
  lastFrameIndex: number;
  playbackSpeed: PlaybackSpeed;
  svgResetNonce: number;

  // Winner/bet state
  revealedWinner: number | null;
  myBet: MyBet | null;
}

export const RaceTrack = ({
  cameraScrollRefCb,
  simulation,
  lineupFinalized,
  parsedGiraffes,
  currentDistances,
  prevDistances,
  isPlaying,
  raceStarted,
  frame,
  lastFrameIndex,
  playbackSpeed,
  svgResetNonce,
  revealedWinner,
  myBet,
}: RaceTrackProps) => {
  return (
    <>
      {/* Fixed lane labels */}
      <div className="absolute left-3 top-3 bottom-3 z-10 flex flex-col justify-between pointer-events-none">
        {Array.from({ length: LANE_COUNT }).map((_, i) => {
          const d = Number(currentDistances[i] ?? 0);
          return (
            <div
              key={i}
              className="flex items-center gap-2 text-xs opacity-80"
              style={{ height: `${LANE_HEIGHT_PX}px` }}
            >
              <span className="opacity-60 tabular-nums"> {d}</span>
              <span className="opacity-60">
                {parsedGiraffes ? <LaneName tokenId={parsedGiraffes.tokenIds[i] ?? 0n} fallback={`Lane ${i}`} /> : null}
              </span>
            </div>
          );
        })}
      </div>

      {/* Camera viewport */}
      <div className="absolute inset-0">
        <div ref={cameraScrollRefCb} className="absolute inset-0 overflow-hidden">
          <div className="relative" style={{ width: `${WORLD_WIDTH_PX}px`, height: `${TRACK_HEIGHT_PX}px` }}>
            {/* Track background */}
            <div className="absolute inset-0">
              <div
                className="absolute top-0 bottom-0 w-[3px] bg-base-300"
                style={{ left: `${WORLD_PADDING_LEFT_PX}px` }}
              />
              <div
                className="absolute top-0 bottom-0 w-[3px] bg-base-300"
                style={{ left: `${WORLD_PADDING_LEFT_PX + TRACK_LENGTH_PX}px` }}
              />
              {/* Distance markers: thin vertical lines every 100 units */}
              {Array.from({ length: Math.floor(TRACK_LENGTH / 100) - 1 }).map((_, idx) => {
                const dist = (idx + 1) * 100; // 100..900
                const x = WORLD_PADDING_LEFT_PX + (dist / TRACK_LENGTH) * TRACK_LENGTH_PX - GIRAFFE_SIZE_PX / 2;
                return (
                  <div
                    key={dist}
                    className="absolute top-0 bottom-0 w-px bg-base-300 opacity-95 pointer-events-none"
                    style={{ left: `${x}px` }}
                  />
                );
              })}
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: "repeating-linear-gradient(90deg, transparent, transparent 29px, rgba(0,0,0,0.10) 30px)",
                }}
              />
              {Array.from({ length: LANE_COUNT }).map((_, i) => {
                const top = i * (LANE_HEIGHT_PX + LANE_GAP_PX);
                return (
                  <div
                    key={i}
                    className="absolute left-0 right-0 rounded-xl"
                    style={{
                      top: `${top}px`,
                      height: `${LANE_HEIGHT_PX}px`,
                      background: [
                        "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.10))",
                        "linear-gradient(90deg, rgba(168,118,72,0.20), rgba(168,118,72,0.12))",
                        "radial-gradient(circle at 20% 30%, rgba(0,0,0,0.12) 0 1px, transparent 2px)",
                        "radial-gradient(circle at 70% 60%, rgba(0,0,0,0.10) 0 1px, transparent 2px)",
                        "radial-gradient(circle at 40% 80%, rgba(255,255,255,0.06) 0 1px, transparent 2px)",
                        "repeating-linear-gradient(90deg, rgba(0,0,0,0.00), rgba(0,0,0,0.00) 10px, rgba(0,0,0,0.06) 11px)",
                      ].join(", "),
                      backgroundSize: "auto, auto, 18px 18px, 22px 22px, 26px 26px, auto",
                      border: "1px solid rgba(0,0,0,0.06)",
                    }}
                  />
                );
              })}
            </div>

            {/* Giraffes - show at start line when lineup is finalized, animate during replay */}
            {simulation || lineupFinalized
              ? Array.from({ length: LANE_COUNT }).map((_, i) => {
                  // Use simulation distances if available, otherwise 0 (start line)
                  const d = simulation ? Number(currentDistances[i] ?? 0) : 0;
                  const prev = simulation ? Number(prevDistances[i] ?? 0) : 0;
                  const delta = Math.max(0, d - prev);
                  const isWinner = revealedWinner === i;
                  const isUserBetLane = !!myBet?.hasBet && myBet.lane === i;

                  const MIN_ANIMATION_SPEED_FACTOR = 2.0;
                  const MAX_ANIMATION_SPEED_FACTOR = 5.0;
                  const minDelta = 1;
                  const maxDelta = SPEED_RANGE;
                  const t = Math.max(0, Math.min(1, (delta - minDelta) / (maxDelta - minDelta)));
                  const speedFactor = simulation
                    ? MIN_ANIMATION_SPEED_FACTOR + t * (MAX_ANIMATION_SPEED_FACTOR - MIN_ANIMATION_SPEED_FACTOR)
                    : 1; // Idle speed when at start line

                  const x =
                    WORLD_PADDING_LEFT_PX +
                    (Math.min(TRACK_LENGTH, Math.max(0, d)) / TRACK_LENGTH) * TRACK_LENGTH_PX -
                    GIRAFFE_SIZE_PX / 2;
                  const y = i * (LANE_HEIGHT_PX + LANE_GAP_PX) + LANE_HEIGHT_PX / 2;

                  return (
                    <div
                      key={i}
                      className="absolute left-0 top-0"
                      style={{
                        transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`,
                        transition: simulation
                          ? `transform ${Math.floor(120 / (playbackSpeed * BASE_REPLAY_SPEED_MULTIPLIER))}ms linear`
                          : undefined,
                        willChange: simulation ? "transform" : undefined,
                        filter: isWinner
                          ? "drop-shadow(0 0 12px rgba(255, 215, 0, 0.9)) drop-shadow(0 0 24px rgba(255, 215, 0, 0.6))"
                          : undefined,
                      }}
                    >
                      <div className="relative">
                        {isUserBetLane ? (
                          <div
                            className="absolute left-1/3 -translate-x-1/2 z-20 pointer-events-none select-none"
                            role="img"
                            aria-label="Your bet"
                          >
                            <span className="inline-flex items-center justify-center rounded-full bg-base-100/80 px-1.5 py-0.5 text-green-500 font-extrabold drop-shadow">
                              $
                            </span>
                          </div>
                        ) : null}
                        <GiraffeAnimated
                          idPrefix={`lane-${i}`}
                          tokenId={parsedGiraffes?.tokenIds?.[i] ?? 0n}
                          playbackRate={speedFactor}
                          resetNonce={svgResetNonce}
                          playing={simulation ? isPlaying && raceStarted && frame < lastFrameIndex : false}
                          sizePx={GIRAFFE_SIZE_PX}
                        />
                      </div>
                    </div>
                  );
                })
              : null}
          </div>
        </div>
      </div>
    </>
  );
};
