"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BASE_REPLAY_SPEED_MULTIPLIER, RAFFE_SIZE_PX, TRACK_LENGTH, TRACK_LENGTH_PX } from "../constants";
import { PlaybackSpeed } from "../types";

interface UseRaceCameraProps {
  simulation: unknown | null;
  currentDistances: number[];
  playbackSpeed: PlaybackSpeed;
  cameraStartX: number;
  worldPaddingLeft: number;
  worldPaddingRight: number;
  cameraFinishInset: number;
}

export const useRaceCamera = ({
  simulation,
  currentDistances,
  playbackSpeed,
  cameraStartX,
  worldPaddingLeft,
  worldPaddingRight,
  cameraFinishInset,
}: UseRaceCameraProps) => {
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const viewportRefCb = useMemo(() => (el: HTMLDivElement | null) => setViewportEl(el), []);
  const [viewportWidthPx, setViewportWidthPx] = useState(0);

  const [cameraScrollEl, setCameraScrollEl] = useState<HTMLDivElement | null>(null);
  const cameraScrollRefCb = useMemo(() => (el: HTMLDivElement | null) => setCameraScrollEl(el), []);

  const [cameraX, setCameraX] = useState(cameraStartX);
  const cameraTargetXRef = useRef(cameraStartX);
  const cameraSmoothRafRef = useRef<number | null>(null);
  const cameraSmoothLastTsRef = useRef<number | null>(null);
  const playbackSpeedRef = useRef(playbackSpeed);
  const cameraSpringXRef = useRef<number | null>(null);
  const cameraSpringVRef = useRef(0);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  // Track viewport size
  useEffect(() => {
    const el = viewportEl;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width ?? 0;
      setViewportWidthPx(w);
    });
    ro.observe(el);
    setViewportWidthPx(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [viewportEl]);

  // Compute cameraX from simulation state
  useEffect(() => {
    if (!simulation) {
      setCameraX(cameraStartX);
      return;
    }

    const viewportWorldWidth = viewportWidthPx > 0 ? viewportWidthPx : 0;
    if (viewportWorldWidth <= 0) {
      setCameraX(cameraStartX);
      return;
    }

    // Compute derived values from responsive padding
    const worldWidth = worldPaddingLeft + TRACK_LENGTH_PX + worldPaddingRight;
    const finishLineX = worldPaddingLeft + TRACK_LENGTH_PX;

    const distances = currentDistances.map(x => Number(x ?? 0));
    const maxDist = Math.max(...distances);
    const spriteHalf = RAFFE_SIZE_PX / 2;
    const maxRunnerX = worldPaddingLeft + (maxDist / TRACK_LENGTH) * TRACK_LENGTH_PX - spriteHalf;

    const avgDist = distances.length ? distances.reduce((sum, d) => sum + d, 0) / distances.length : 0;
    const focalX = worldPaddingLeft + (avgDist / TRACK_LENGTH) * TRACK_LENGTH_PX - spriteHalf;

    const spritePad = 12;
    const minLeaderScreenX = spriteHalf + spritePad;
    const maxLeaderScreenX = Math.max(minLeaderScreenX, viewportWorldWidth - (spriteHalf + spritePad));

    const followStartThresholdScreenX = viewportWorldWidth * 0.5;
    const followStartX = Math.max(minLeaderScreenX, followStartThresholdScreenX);

    const targetFocalScreenX = viewportWorldWidth * 0.5;
    const desiredFocalScreenX = Math.min(maxLeaderScreenX, Math.max(minLeaderScreenX, targetFocalScreenX));

    const maxCameraX = Math.max(0, worldWidth - viewportWorldWidth);

    const freezeX = Math.min(maxCameraX, Math.max(0, finishLineX - (viewportWorldWidth - cameraFinishInset)));

    const followFocalX = Math.min(maxCameraX, Math.max(0, focalX - desiredFocalScreenX));
    const keepMaxVisibleX = Math.min(maxCameraX, Math.max(0, maxRunnerX - maxLeaderScreenX));
    const followX = Math.max(followFocalX, keepMaxVisibleX);

    const nextCameraX = maxRunnerX < followStartX ? cameraStartX : Math.min(followX, freezeX);
    setCameraX(nextCameraX);
  }, [
    simulation,
    currentDistances,
    viewportWidthPx,
    cameraStartX,
    worldPaddingLeft,
    worldPaddingRight,
    cameraFinishInset,
  ]);

  useEffect(() => {
    cameraTargetXRef.current = Math.max(0, cameraX);
  }, [cameraX]);

  // Reset camera when no simulation
  useEffect(() => {
    if (!cameraScrollEl) return;
    if (!simulation) {
      cameraScrollEl.scrollLeft = cameraStartX;
      cameraSpringXRef.current = cameraStartX;
      cameraSpringVRef.current = 0;
    }
  }, [cameraScrollEl, simulation, cameraStartX]);

  // Smooth camera with spring
  useEffect(() => {
    const el = cameraScrollEl;
    if (!el || !simulation) return;
    cameraSmoothLastTsRef.current = null;
    cameraSpringXRef.current = null;
    cameraSpringVRef.current = 0;

    const step = (now: number) => {
      const last = cameraSmoothLastTsRef.current;
      cameraSmoothLastTsRef.current = now;
      const dt = last === null ? 16 : Math.min(64, Math.max(0, now - last));
      const dtSec = dt / 1000;

      const target = cameraTargetXRef.current;
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);

      const smoothTimeSec = Math.max(0.05, 0.55 / (playbackSpeedRef.current * BASE_REPLAY_SPEED_MULTIPLIER));
      const omega = 2 / smoothTimeSec;
      const x = omega * dtSec;
      const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

      const current = cameraSpringXRef.current ?? el.scrollLeft;
      const change = current - target;
      const temp = (cameraSpringVRef.current + omega * change) * dtSec;
      const newVel = (cameraSpringVRef.current - omega * temp) * exp;
      const newPos = target + (change + temp) * exp;

      cameraSpringVRef.current = newVel;
      cameraSpringXRef.current = Math.max(0, Math.min(maxScroll, newPos));
      el.scrollLeft = cameraSpringXRef.current;

      cameraSmoothRafRef.current = requestAnimationFrame(step);
    };

    if (cameraSmoothRafRef.current) {
      cancelAnimationFrame(cameraSmoothRafRef.current);
      cameraSmoothRafRef.current = null;
    }
    cameraSmoothRafRef.current = requestAnimationFrame(step);

    return () => {
      if (cameraSmoothRafRef.current) cancelAnimationFrame(cameraSmoothRafRef.current);
      cameraSmoothRafRef.current = null;
      cameraSmoothLastTsRef.current = null;
    };
  }, [cameraScrollEl, simulation]);

  return {
    viewportRefCb,
    cameraScrollRefCb,
    viewportWidthPx,
  };
};
