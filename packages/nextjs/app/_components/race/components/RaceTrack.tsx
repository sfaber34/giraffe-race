"use client";

import {
  BASE_REPLAY_SPEED_MULTIPLIER,
  GIRAFFE_SIZE_PX,
  LANE_COUNT,
  SPEED_RANGE,
  TRACK_BASE_Y_PX,
  TRACK_HEIGHT_PX,
  TRACK_LENGTH,
  TRACK_LENGTH_PX,
  TRACK_VERTICAL_SPREAD_PX,
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

/**
 * Compute Y position for a giraffe based on lane index.
 * Creates depth illusion: lane 0 at top (furthest), lane 5 at bottom (closest).
 */
const getLaneY = (laneIndex: number): number => {
  // Linear interpolation: lane 0 is at top, lane 5 is at bottom
  const t = laneIndex / (LANE_COUNT - 1);
  return TRACK_BASE_Y_PX - TRACK_VERTICAL_SPREAD_PX / 2 + t * TRACK_VERTICAL_SPREAD_PX;
};

/**
 * Get z-index for depth ordering. Higher lane = closer to camera = higher z-index.
 */
const getLaneZIndex = (laneIndex: number): number => {
  return 10 + laneIndex;
};

/**
 * Get scale factor for giraffes. All same size for cartoon style.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getLaneScale = (_laneIndex: number): number => 1.0;

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
      {/* Fixed lane labels - repositioned for side view */}
      <div className="absolute left-3 top-3 z-20 flex flex-col gap-1 pointer-events-none">
        {Array.from({ length: LANE_COUNT }).map((_, i) => {
          const d = Number(currentDistances[i] ?? 0);
          return (
            <div
              key={i}
              className="flex items-center gap-2 text-xs"
              style={{
                opacity: 0.6 + i * 0.06,
                transform: `scale(${0.9 + i * 0.02})`,
              }}
            >
              <span className="tabular-nums w-8 text-right">{d}</span>
              <span className="truncate max-w-[80px]">
                {parsedGiraffes ? <LaneName tokenId={parsedGiraffes.tokenIds[i] ?? 0n} fallback={`#${i + 1}`} /> : null}
              </span>
            </div>
          );
        })}
      </div>

      {/* Camera viewport */}
      <div className="absolute inset-0">
        <div ref={cameraScrollRefCb} className="absolute inset-0 overflow-hidden">
          <div className="relative" style={{ width: `${WORLD_WIDTH_PX}px`, height: `${TRACK_HEIGHT_PX}px` }}>
            {/* Track background - single wide track with perspective */}
            <div className="absolute inset-0">
              {/* Ground/track surface with perspective gradient */}
              <div
                className="absolute inset-0"
                style={{
                  background: `
                    linear-gradient(180deg, 
                      rgba(139, 90, 43, 0.15) 0%,
                      rgba(168, 118, 72, 0.35) 30%,
                      rgba(168, 118, 72, 0.5) 60%,
                      rgba(139, 90, 43, 0.6) 100%
                    )
                  `,
                  borderTop: "2px solid rgba(139, 90, 43, 0.3)",
                  borderBottom: "3px solid rgba(101, 67, 33, 0.5)",
                }}
              />

              {/* Track surface texture lines for depth */}
              {Array.from({ length: 14 }).map((_, i) => {
                const y = (i / 13) * TRACK_HEIGHT_PX;
                const opacity = 0.08 + (i / 13) * 0.12;
                return (
                  <div
                    key={`line-${i}`}
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{
                      top: `${y}px`,
                      height: "1px",
                      background: `linear-gradient(90deg, transparent 0%, rgba(0,0,0,${opacity}) 10%, rgba(0,0,0,${opacity}) 90%, transparent 100%)`,
                    }}
                  />
                );
              })}

              {/* Start line */}
              <div
                className="absolute bg-white/40"
                style={{
                  left: `${WORLD_PADDING_LEFT_PX}px`,
                  top: 0,
                  width: "4px",
                  height: `${TRACK_HEIGHT_PX}px`,
                  transform: "skewY(-3deg)",
                }}
              />

              {/* Finish line */}
              <div
                className="absolute"
                style={{
                  left: `${WORLD_PADDING_LEFT_PX + TRACK_LENGTH_PX}px`,
                  top: 0,
                  width: "6px",
                  height: `${TRACK_HEIGHT_PX}px`,
                  transform: "skewY(-3deg)",
                  background: "repeating-linear-gradient(180deg, #fff 0px, #fff 6px, #222 6px, #222 12px)",
                }}
              />

              {/* Distance markers with perspective */}
              {Array.from({ length: Math.floor(TRACK_LENGTH / 100) - 1 }).map((_, idx) => {
                const dist = (idx + 1) * 100;
                const x = WORLD_PADDING_LEFT_PX + (dist / TRACK_LENGTH) * TRACK_LENGTH_PX;
                return (
                  <div
                    key={dist}
                    className="absolute opacity-20 pointer-events-none"
                    style={{
                      left: `${x}px`,
                      top: 0,
                      width: "2px",
                      height: `${TRACK_HEIGHT_PX}px`,
                      background: "rgba(255,255,255,0.5)",
                      transform: "skewY(-3deg)",
                    }}
                  />
                );
              })}
            </div>

            {/* Giraffes - all on same track with depth staggering */}
            {simulation || lineupFinalized
              ? Array.from({ length: LANE_COUNT })
                  // Sort by lane index so back lanes render first (painter's algorithm)
                  .map((_, i) => i)
                  .sort((a, b) => a - b)
                  .map(i => {
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
                      : 1;

                    const x =
                      WORLD_PADDING_LEFT_PX +
                      (Math.min(TRACK_LENGTH, Math.max(0, d)) / TRACK_LENGTH) * TRACK_LENGTH_PX -
                      GIRAFFE_SIZE_PX / 2;
                    const y = getLaneY(i);
                    const scale = getLaneScale(i);
                    const zIndex = getLaneZIndex(i);

                    return (
                      <div
                        key={i}
                        className="absolute left-0 top-0"
                        style={{
                          transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`,
                          transition: simulation
                            ? `transform ${Math.floor(120 / (playbackSpeed * BASE_REPLAY_SPEED_MULTIPLIER))}ms linear`
                            : undefined,
                          willChange: simulation ? "transform" : undefined,
                          zIndex,
                          filter: isWinner
                            ? "drop-shadow(0 0 12px rgba(255, 215, 0, 0.9)) drop-shadow(0 0 24px rgba(255, 215, 0, 0.6))"
                            : undefined,
                        }}
                      >
                        <div className="relative">
                          {isUserBetLane ? (
                            <div
                              className="absolute left-1/3 -translate-x-1/2 -top-2 z-30 pointer-events-none select-none"
                              role="img"
                              aria-label="Your bet"
                            >
                              <span className="inline-flex items-center justify-center rounded-full bg-base-100/90 px-1.5 py-0.5 text-green-500 font-extrabold drop-shadow text-sm">
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
