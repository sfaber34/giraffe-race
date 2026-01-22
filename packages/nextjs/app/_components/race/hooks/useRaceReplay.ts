"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BASE_REPLAY_SPEED_MULTIPLIER, LANE_COUNT, MAX_TICKS, SPEED_RANGE, TRACK_LENGTH } from "../constants";
import { PlaybackSpeed } from "../types";
import { Hex, isHex } from "viem";
import { simulateRaceFromSeed } from "~~/utils/race/simulateRace";

interface UseRaceReplayProps {
  seed: Hex | undefined;
  settled: boolean;
  laneScore: number[];
}

export const useRaceReplay = ({ seed, settled, laneScore }: UseRaceReplayProps) => {
  // Replay controls
  const [isPlaying, setIsPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [raceStarted, setRaceStarted] = useState(false);
  const [startDelayRemainingMs, setStartDelayRemainingMs] = useState(3000);
  const startDelayEndAtRef = useRef<number | null>(null);
  const startDelayTimeoutRef = useRef<number | null>(null);
  const [goPhase, setGoPhase] = useState<null | "solid" | "fade">(null);
  const goPhaseTimeoutRef = useRef<number | null>(null);
  const goHideTimeoutRef = useRef<number | null>(null);
  const prevRaceStartedRef = useRef(false);
  const [svgResetNonce, setSvgResetNonce] = useState(0);

  // Check if we can simulate
  const canSimulate = useMemo(() => {
    if (!settled) return false;
    if (!seed) return false;
    return isHex(seed) && seed !== "0x" + "0".repeat(64);
  }, [settled, seed]);

  // Run simulation
  const simulation = useMemo(() => {
    if (!canSimulate || !seed) return null;
    return simulateRaceFromSeed({
      seed,
      laneCount: LANE_COUNT,
      maxTicks: MAX_TICKS,
      speedRange: SPEED_RANGE,
      trackLength: TRACK_LENGTH,
      score: laneScore,
    });
  }, [canSimulate, seed, laneScore]);

  const frames = useMemo(() => simulation?.frames ?? [], [simulation]);
  const lastFrameIndex = Math.max(0, frames.length - 1);

  // Keep frameRef in sync
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  // Reset on new seed
  useEffect(() => {
    setFrame(0);
    setRaceStarted(false);
    setStartDelayRemainingMs(3000);
    setSvgResetNonce(n => n + 1);
  }, [seed]);

  // Start-delay logic (3s hold at start line)
  const startDelayRemainingMsRef = useRef(startDelayRemainingMs);
  startDelayRemainingMsRef.current = startDelayRemainingMs;

  useEffect(() => {
    if (!simulation) return;
    if (!isPlaying) return;
    if (raceStarted) return;
    if (frame !== 0) return;

    if (startDelayTimeoutRef.current) {
      window.clearTimeout(startDelayTimeoutRef.current);
      startDelayTimeoutRef.current = null;
    }

    const remaining = Math.max(0, Math.floor(startDelayRemainingMsRef.current));
    startDelayEndAtRef.current = Date.now() + remaining;

    startDelayTimeoutRef.current = window.setTimeout(() => {
      startDelayTimeoutRef.current = null;
      startDelayEndAtRef.current = null;
      setSvgResetNonce(n => n + 1);
      setRaceStarted(true);
      setStartDelayRemainingMs(0);
    }, remaining);

    return () => {
      if (startDelayTimeoutRef.current) {
        window.clearTimeout(startDelayTimeoutRef.current);
        startDelayTimeoutRef.current = null;
      }
      if (startDelayEndAtRef.current !== null) {
        const left = Math.max(0, startDelayEndAtRef.current - Date.now());
        setStartDelayRemainingMs(left);
        startDelayEndAtRef.current = null;
      }
    };
  }, [simulation, isPlaying, raceStarted, frame]);

  // Countdown tick
  useEffect(() => {
    if (!simulation) return;
    if (!isPlaying) return;
    if (raceStarted) return;
    if (frame !== 0) return;
    if (startDelayEndAtRef.current === null) return;

    const id = window.setInterval(() => {
      const endAt = startDelayEndAtRef.current;
      if (endAt === null) return;
      setStartDelayRemainingMs(Math.max(0, endAt - Date.now()));
    }, 50);

    return () => window.clearInterval(id);
  }, [simulation, isPlaying, raceStarted, frame]);

  // "GO!" overlay logic
  useEffect(() => {
    const clearGoTimers = () => {
      if (goPhaseTimeoutRef.current) window.clearTimeout(goPhaseTimeoutRef.current);
      if (goHideTimeoutRef.current) window.clearTimeout(goHideTimeoutRef.current);
      goPhaseTimeoutRef.current = null;
      goHideTimeoutRef.current = null;
    };

    const prev = prevRaceStartedRef.current;
    prevRaceStartedRef.current = raceStarted;

    if (!simulation) {
      clearGoTimers();
      setGoPhase(null);
      return;
    }

    if (!raceStarted) {
      clearGoTimers();
      setGoPhase(null);
      return;
    }

    if (!prev && raceStarted && frameRef.current === 0) {
      clearGoTimers();
      setGoPhase("solid");
      goPhaseTimeoutRef.current = window.setTimeout(() => setGoPhase("fade"), 500);
      goHideTimeoutRef.current = window.setTimeout(() => setGoPhase(null), 750);
    }
  }, [raceStarted, simulation]);

  // If frame is manually changed, ensure race is started
  useEffect(() => {
    if (frame > 0 && !raceStarted) {
      setRaceStarted(true);
      setStartDelayRemainingMs(0);
    }
  }, [frame, raceStarted]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) return;
    if (!simulation) return;
    if (!raceStarted) return;

    const effectivePlaybackSpeed = playbackSpeed * BASE_REPLAY_SPEED_MULTIPLIER;
    const id = window.setInterval(
      () => setFrame(prev => (prev >= lastFrameIndex ? lastFrameIndex : prev + 1)),
      Math.floor(120 / effectivePlaybackSpeed),
    );
    return () => window.clearInterval(id);
  }, [isPlaying, simulation, raceStarted, lastFrameIndex, playbackSpeed]);

  // Current and previous distances
  const currentDistances = useMemo(() => frames[frame] ?? Array.from({ length: LANE_COUNT }, () => 0), [frames, frame]);
  const prevDistances = useMemo(
    () => frames[Math.max(0, frame - 1)] ?? Array.from({ length: LANE_COUNT }, () => 0),
    [frames, frame],
  );

  // Step controls
  const stepBy = (delta: -1 | 1) => {
    setIsPlaying(false);
    setRaceStarted(true);
    setStartDelayRemainingMs(0);
    setFrame(prev => {
      const next = prev + delta;
      if (next < 0) return 0;
      if (next > lastFrameIndex) return lastFrameIndex;
      return next;
    });
  };

  // Reset function
  const reset = () => {
    setFrame(0);
    setRaceStarted(false);
    setStartDelayRemainingMs(3000);
    setSvgResetNonce(n => n + 1);
  };

  const raceIsOver = !!simulation && frame >= lastFrameIndex;

  return {
    // State
    isPlaying,
    setIsPlaying,
    frame,
    setFrame,
    playbackSpeed,
    setPlaybackSpeed,
    raceStarted,
    startDelayRemainingMs,
    goPhase,
    svgResetNonce,

    // Derived
    canSimulate,
    simulation,
    frames,
    lastFrameIndex,
    currentDistances,
    prevDistances,
    raceIsOver,

    // Actions
    stepBy,
    reset,
  };
};
