"use client";

import React, { memo } from "react";
import {
  BASE_REPLAY_SPEED_MULTIPLIER,
  LANE_COUNT,
  PX_PER_UNIT,
  SPEED_RANGE,
  TRACK_LENGTH,
  TRACK_LENGTH_PX,
} from "../constants";
import { TrackDimensions } from "../hooks/useTrackDimensions";
import { MyBets, ParsedGiraffes, PlaybackSpeed } from "../types";
import { LaneName } from "./LaneName";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";

interface RaceTrackProps {
  // Viewport refs
  cameraScrollRefCb: (el: HTMLDivElement | null) => void;

  // Responsive dimensions
  dimensions: TrackDimensions;

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

  // Bet state
  myBets: MyBets | null;
}

/**
 * Compute Y position for a giraffe based on lane index.
 * Creates depth illusion: lane 0 at top (furthest), lane 5 at bottom (closest).
 */
const getLaneY = (laneIndex: number, trackBaseY: number, trackVerticalSpread: number): number => {
  // Linear interpolation: lane 0 is at top, lane 5 is at bottom
  const t = laneIndex / (LANE_COUNT - 1);
  return trackBaseY - trackVerticalSpread / 2 + t * trackVerticalSpread;
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

export const RaceTrack = memo(function RaceTrack({
  cameraScrollRefCb,
  dimensions,
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
  myBets,
}: RaceTrackProps) {
  const { trackHeight, trackBaseY, trackVerticalSpread, giraffeSize, worldPaddingLeft, worldPaddingRight } = dimensions;

  // Compute world width dynamically based on responsive padding
  const worldWidth = worldPaddingLeft + TRACK_LENGTH_PX + worldPaddingRight;

  return (
    <>
      {/* Camera viewport */}
      <div className="absolute inset-0">
        <div ref={cameraScrollRefCb} className="absolute inset-0 overflow-hidden">
          <div className="relative" style={{ width: `${worldWidth}px`, height: `${trackHeight}px` }}>
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
                const y = (i / 13) * trackHeight;
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
                  left: `${worldPaddingLeft}px`,
                  top: 0,
                  width: "4px",
                  height: `${trackHeight}px`,
                  transform: "skewY(-3deg)",
                }}
              />

              {/* Finish line */}
              <div
                className="absolute"
                style={{
                  left: `${worldPaddingLeft + TRACK_LENGTH_PX}px`,
                  top: 0,
                  width: "6px",
                  height: `${trackHeight}px`,
                  transform: "skewY(-3deg)",
                  background: "repeating-linear-gradient(180deg, #fff 0px, #fff 6px, #222 6px, #222 12px)",
                }}
              />

              {/* Distance markers with perspective */}
              {Array.from({ length: Math.floor(TRACK_LENGTH / 100) - 1 }).map((_, idx) => {
                const dist = (idx + 1) * 100;
                const x = worldPaddingLeft + (dist / TRACK_LENGTH) * TRACK_LENGTH_PX;
                return (
                  <div
                    key={dist}
                    className="absolute opacity-20 pointer-events-none"
                    style={{
                      left: `${x}px`,
                      top: 0,
                      width: "2px",
                      height: `${trackHeight}px`,
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

                    // Determine which bets the user has on this lane
                    const hasWinBet = myBets?.win?.hasBet && myBets.win.lane === i;
                    const hasPlaceBet = myBets?.place?.hasBet && myBets.place.lane === i;
                    const hasShowBet = myBets?.show?.hasBet && myBets.show.lane === i;

                    const MIN_ANIMATION_SPEED_FACTOR = 2.0;
                    const MAX_ANIMATION_SPEED_FACTOR = 5.0;
                    const minDelta = 1;
                    const maxDelta = SPEED_RANGE;
                    const t = Math.max(0, Math.min(1, (delta - minDelta) / (maxDelta - minDelta)));
                    const speedFactor = simulation
                      ? MIN_ANIMATION_SPEED_FACTOR + t * (MAX_ANIMATION_SPEED_FACTOR - MIN_ANIMATION_SPEED_FACTOR)
                      : 1;

                    // Allow giraffes to run past the finish line to their actual distances
                    // Distance is in race units, convert to pixels directly (no upper clamp)
                    const x = worldPaddingLeft + Math.max(0, d) * PX_PER_UNIT - giraffeSize / 2;
                    const y = getLaneY(i, trackBaseY, trackVerticalSpread);
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
                        }}
                      >
                        <div className="relative">
                          <GiraffeAnimated
                            idPrefix={`lane-${i}`}
                            tokenId={parsedGiraffes?.tokenIds?.[i] ?? 0n}
                            playbackRate={speedFactor}
                            resetNonce={svgResetNonce}
                            playing={simulation ? isPlaying && raceStarted && frame < lastFrameIndex : false}
                            sizePx={giraffeSize}
                          />
                          {/* Name label - positioned to the right of the giraffe's face */}
                          {parsedGiraffes?.tokenIds?.[i] ? (
                            <div
                              className="absolute pointer-events-none select-none whitespace-nowrap"
                              style={{
                                left: `${giraffeSize * 1.05}px`,
                                top: `${giraffeSize * 0.1}px`,
                              }}
                            >
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-semibold"
                                style={{
                                  textShadow: "0 1px 2px rgba(0,0,0,0.1)",
                                }}
                              >
                                <LaneName tokenId={parsedGiraffes.tokenIds[i]} fallback={`#${i + 1}`} />
                                {(hasWinBet || hasPlaceBet || hasShowBet) && (
                                  <span className="font-bold">
                                    (
                                    {[
                                      hasWinBet && (
                                        <span key="w" className="text-yellow-500">
                                          W
                                        </span>
                                      ),
                                      hasPlaceBet && (
                                        <span key="p" className="text-blue-400">
                                          P
                                        </span>
                                      ),
                                      hasShowBet && (
                                        <span key="s" className="text-green-400">
                                          S
                                        </span>
                                      ),
                                    ]
                                      .filter(Boolean)
                                      .reduce((acc: React.ReactNode[], el, idx) => {
                                        if (idx > 0)
                                          acc.push(
                                            <span key={`slash-${idx}`} className="opacity-70">
                                              /
                                            </span>,
                                          );
                                        acc.push(el);
                                        return acc;
                                      }, [])}
                                    )
                                  </span>
                                )}
                              </span>
                            </div>
                          ) : null}
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
});
