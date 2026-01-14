"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { Hex, formatEther, isHex, toHex } from "viem";
import { usePublicClient } from "wagmi";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { simulateRaceFromSeed } from "~~/utils/race/simulateRace";

const LANE_COUNT = 4 as const;
const LANE_EMOJI = "🦒";
// Simulation constants (keep in sync with AnimalRace.sol)
const SPEED_RANGE = 10;

const LaneName = ({ tokenId, fallback }: { tokenId: bigint; fallback: string }) => {
  const enabled = tokenId !== 0n;
  const { data: nameData } = useScaffoldReadContract({
    contractName: "AnimalNFT",
    functionName: "nameOf",
    args: [enabled ? tokenId : undefined],
    query: { enabled },
  });

  const name = (nameData as string | undefined) ?? "";
  return <span>{name.trim() ? name : fallback}</span>;
};

export const AnimalRaceHome = () => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });

  const [raceId, setRaceId] = useState<bigint>(0n);
  const [isPlaying, setIsPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [isMining, setIsMining] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 3>(1);
  const [raceStarted, setRaceStarted] = useState(false);
  const [startDelayRemainingMs, setStartDelayRemainingMs] = useState(3000);
  const startDelayEndAtRef = useRef<number | null>(null);
  const startDelayTimeoutRef = useRef<number | null>(null);
  const [svgResetNonce, setSvgResetNonce] = useState(0);

  const { data: animalRaceContract, isLoading: isAnimalRaceLoading } = useDeployedContractInfo({
    contractName: "AnimalRace",
  });

  const readEnabled = !!animalRaceContract;
  const raceIdArg = readEnabled ? raceId : undefined;

  const { data: raceData, isLoading: isRaceLoading } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getRace",
    args: [raceIdArg],
    query: { enabled: readEnabled && raceIdArg !== undefined },
  });

  const { data: raceAnimalsData, isLoading: isRaceAnimalsLoading } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getRaceAnimals",
    args: [raceIdArg],
    query: { enabled: readEnabled && raceIdArg !== undefined },
  });

  const { data: houseAddress } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "house",
    query: { enabled: readEnabled },
  });

  const parsed = useMemo(() => {
    if (!raceData) return null;
    const [closeBlock, settled, winner, seed, totalPot, totalOnAnimal] = raceData;
    return {
      closeBlock: closeBlock as bigint,
      settled: settled as boolean,
      winner: Number(winner as any),
      seed: seed as Hex,
      totalPot: totalPot as bigint,
      totalOnAnimal: (totalOnAnimal as readonly bigint[]).map(x => BigInt(x)),
    };
  }, [raceData]);

  const parsedAnimals = useMemo(() => {
    if (!raceAnimalsData) return null;
    const [assignedCount, tokenIds, originalOwners] = raceAnimalsData;
    return {
      assignedCount: Number(assignedCount as any),
      tokenIds: (tokenIds as readonly bigint[]).map(x => BigInt(x)),
      originalOwners: originalOwners as readonly `0x${string}`[],
    };
  }, [raceAnimalsData]);

  const canSimulate = useMemo(() => {
    if (!parsed?.settled) return false;
    if (!parsed.seed) return false;
    return isHex(parsed.seed) && parsed.seed !== "0x" + "0".repeat(64);
  }, [parsed]);

  const simulation = useMemo(() => {
    if (!parsed || !canSimulate) return null;
    return simulateRaceFromSeed({
      seed: parsed.seed,
      // Keep these in sync with `AnimalRace.sol` constants
      animalCount: LANE_COUNT,
      maxTicks: 500,
      speedRange: SPEED_RANGE,
      trackLength: 1000,
    });
  }, [parsed, canSimulate]);

  const frames = useMemo(() => simulation?.frames ?? [], [simulation]);
  const lastFrameIndex = Math.max(0, frames.length - 1);

  useEffect(() => {
    setFrame(0);
    setRaceStarted(false);
    setStartDelayRemainingMs(3000);
    setSvgResetNonce(n => n + 1);
  }, [parsed?.seed]);

  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const viewportRefCb = useCallback((el: HTMLDivElement | null) => {
    setViewportEl(el);
  }, []);
  const [viewportWidthPx, setViewportWidthPx] = useState(0);

  const [cameraScrollEl, setCameraScrollEl] = useState<HTMLDivElement | null>(null);
  const cameraScrollRefCb = useCallback((el: HTMLDivElement | null) => {
    setCameraScrollEl(el);
  }, []);
  const [cameraX, setCameraX] = useState(0);
  // Camera smoothing: continuously ease scrollLeft toward the computed cameraX target.
  const cameraTargetXRef = useRef(0);
  const cameraSmoothRafRef = useRef<number | null>(null);
  const cameraSmoothLastTsRef = useRef<number | null>(null);
  const playbackSpeedRef = useRef(playbackSpeed);
  const cameraSpringXRef = useRef<number | null>(null);
  const cameraSpringVRef = useRef(0);

  // Start-delay logic: hold the racers at the start line for 3s, then begin ticking.
  useEffect(() => {
    // Only apply the start delay at the beginning of a run.
    if (!simulation) return;
    if (!isPlaying) return;
    if (raceStarted) return;
    if (frame !== 0) return;

    // Clean any prior timer (shouldn't happen often, but keeps it robust).
    if (startDelayTimeoutRef.current) {
      window.clearTimeout(startDelayTimeoutRef.current);
      startDelayTimeoutRef.current = null;
    }

    const remaining = Math.max(0, Math.floor(startDelayRemainingMs));
    startDelayEndAtRef.current = Date.now() + remaining;

    startDelayTimeoutRef.current = window.setTimeout(() => {
      startDelayTimeoutRef.current = null;
      startDelayEndAtRef.current = null;
      setSvgResetNonce(n => n + 1); // force feet-on-ground at the exact start moment
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
  }, [simulation, isPlaying, raceStarted, frame, startDelayRemainingMs]);

  // If the user manually advances frames, don't enforce the start delay.
  useEffect(() => {
    if (frame > 0 && !raceStarted) {
      setRaceStarted(true);
      setStartDelayRemainingMs(0);
    }
  }, [frame, raceStarted]);

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

  useEffect(() => {
    if (!isPlaying) return;
    if (!simulation) return;
    if (!raceStarted) return;

    const id = window.setInterval(
      () => {
        setFrame(prev => (prev >= lastFrameIndex ? lastFrameIndex : prev + 1));
      },
      Math.floor(120 / playbackSpeed),
    );

    return () => window.clearInterval(id);
  }, [isPlaying, simulation, raceStarted, lastFrameIndex, playbackSpeed]);

  const currentDistances = useMemo(() => frames[frame] ?? [0, 0, 0, 0], [frames, frame]);
  const trackLength = 1000;
  const prevDistances = useMemo(() => frames[Math.max(0, frame - 1)] ?? [0, 0, 0, 0], [frames, frame]);

  // Track/camera geometry (in "world" pixels; scaling is handled separately).
  const laneHeightPx = 86;
  const laneGapPx = 10;
  const worldPaddingLeftPx = 80;
  const worldPaddingRightPx = 140;
  const pxPerUnit = 3;
  const giraffeSizePx = 78;
  const trackLengthPx = trackLength * pxPerUnit;
  const finishLineX = worldPaddingLeftPx + trackLengthPx;
  const worldWidthPx = worldPaddingLeftPx + trackLengthPx + worldPaddingRightPx;
  const trackHeightPx = LANE_COUNT * (laneHeightPx + laneGapPx) - laneGapPx;

  // Compute cameraX in a side-effect so we can drive scrollLeft (instead of animating transforms).
  useEffect(() => {
    if (!simulation) {
      setCameraX(0);
      return;
    }

    const viewportWorldWidth = viewportWidthPx > 0 ? viewportWidthPx : 0;
    if (viewportWorldWidth <= 0) {
      setCameraX(0);
      return;
    }

    const distances = currentDistances.map(x => Number(x ?? 0));
    const maxDist = Math.max(...distances);
    const maxRunnerX = worldPaddingLeftPx + (maxDist / trackLength) * trackLengthPx;

    // Use the average position of all runners as the camera focal point.
    // This makes the camera feel less "twitchy" than chasing the instantaneous leader.
    const avgDist = distances.length ? distances.reduce((sum, d) => sum + d, 0) / distances.length : 0;
    const focalX = worldPaddingLeftPx + (avgDist / trackLength) * trackLengthPx;

    // Keep the leader fully visible (account for sprite width), not just the leader point.
    const spriteHalf = giraffeSizePx / 2;
    const spritePad = 12;
    const minLeaderScreenX = spriteHalf + spritePad;
    const maxLeaderScreenX = Math.max(minLeaderScreenX, viewportWorldWidth - (spriteHalf + spritePad));

    // Camera behavior:
    // 1) Start: no camera movement.
    // 2) Mid-race: follow leader, keeping them toward the right side of the viewport.
    // 3) Finish approach: stop slewing once the finish line is visible on the right side.
    const followStartThresholdScreenX = viewportWorldWidth * 0.5;
    const followStartX = Math.max(minLeaderScreenX, followStartThresholdScreenX);

    // When panning, keep the pack closer to center (was ~80% toward the right edge).
    const targetFocalScreenX = viewportWorldWidth * 0.5;
    const desiredFocalScreenX = Math.min(maxLeaderScreenX, Math.max(minLeaderScreenX, targetFocalScreenX));

    const maxCameraX = Math.max(0, worldWidthPx - viewportWorldWidth);

    const finishInset = 150;
    const freezeX = Math.min(maxCameraX, Math.max(0, finishLineX - (viewportWorldWidth - finishInset)));

    const followFocalX = Math.min(maxCameraX, Math.max(0, focalX - desiredFocalScreenX));
    // Ensure the furthest runner doesn't slip past the right edge during follow.
    const keepMaxVisibleX = Math.min(maxCameraX, Math.max(0, maxRunnerX - maxLeaderScreenX));
    const followX = Math.max(followFocalX, keepMaxVisibleX);

    const nextCameraX = maxRunnerX < followStartX ? 0 : Math.min(followX, freezeX);
    setCameraX(nextCameraX);
  }, [
    simulation,
    currentDistances,
    viewportWidthPx,
    trackLength,
    trackLengthPx,
    finishLineX,
    worldWidthPx,
    worldPaddingLeftPx,
    giraffeSizePx,
  ]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    cameraTargetXRef.current = Math.max(0, cameraX);
  }, [cameraX]);

  // Drive camera via scrollLeft with spring smoothing (less choppy when target updates in discrete ticks).
  useEffect(() => {
    const el = cameraScrollEl;
    if (!el) return;
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

      // Critically-damped spring (Unity-style SmoothDamp) toward `target`.
      // Smaller smoothTime = snappier. Scale down with playbackSpeed so faster playback doesn't feel too laggy.
      const smoothTimeSec = Math.max(0.05, 0.55 / playbackSpeedRef.current);
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

    // Cancel any prior loop (shouldn't happen often, but keeps it robust).
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
  }, [cameraScrollEl]);

  const verifiedWinner = parsed?.settled ? parsed.winner : null;
  const simulatedWinner = simulation ? simulation.winner : null;
  const winnersMatch = verifiedWinner !== null && simulatedWinner !== null && verifiedWinner === simulatedWinner;

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

  const mineBlocks = async (count: number) => {
    if (!publicClient) return;
    setIsMining(true);
    try {
      const hexCount = toHex(count);
      // Anvil
      try {
        // `anvil_mine` typically accepts [numBlocks] (hex quantity)
        await publicClient.request({ method: "anvil_mine" as any, params: [hexCount] as any });
        return;
      } catch {
        // Hardhat
        try {
          await publicClient.request({ method: "hardhat_mine" as any, params: [hexCount] as any });
          return;
        } catch {
          // Generic fallback: mine 1 block N times
          for (let i = 0; i < count; i++) {
            await publicClient.request({ method: "evm_mine" as any, params: [] as any });
          }
        }
      }
    } finally {
      setIsMining(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 w-full px-6 py-10">
      <div className="card bg-base-200 shadow">
        <div className="card-body gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Mine blocks (local)</div>
            {isMining ? <span className="text-xs opacity-70">Mining…</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm" onClick={() => mineBlocks(1)} disabled={!publicClient || isMining}>
              Mine +1
            </button>
            <button className="btn btn-sm" onClick={() => mineBlocks(10)} disabled={!publicClient || isMining}>
              Mine +10
            </button>
            <button className="btn btn-sm" onClick={() => mineBlocks(50)} disabled={!publicClient || isMining}>
              Mine +50
            </button>
          </div>
          <div className="text-xs opacity-70">
            Uses <span className="font-mono">anvil_mine</span>/<span className="font-mono">hardhat_mine</span> when
            available.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Race Viewer</h2>
              <div className="text-xs opacity-70">
                {isAnimalRaceLoading
                  ? "Checking contract…"
                  : animalRaceContract
                    ? "AnimalRace deployed"
                    : "Not deployed"}
              </div>
            </div>

            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">Race ID</span>
              </div>
              <input
                className="input input-bordered w-full"
                value={raceId.toString()}
                onChange={e => {
                  const v = e.target.value.trim();
                  setRaceId(v === "" ? 0n : BigInt(v));
                }}
                inputMode="numeric"
              />
            </label>

            <div className="text-sm">
              <div className="flex justify-between">
                <span className="opacity-70">Status</span>
                <span>{isRaceLoading ? "Loading…" : parsed?.settled ? "Settled" : "Not settled"}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Close block</span>
                <span>{parsed ? parsed.closeBlock.toString() : "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Total pot</span>
                <span>{parsed ? `${formatEther(parsed.totalPot)} ETH` : "-"}</span>
              </div>
            </div>

            <div className="divider my-1" />

            <div className="text-sm">
              <div className="flex justify-between">
                <span className="opacity-70">Lane NFTs</span>
                <span>
                  {isRaceAnimalsLoading
                    ? "Loading…"
                    : parsedAnimals
                      ? `${parsedAnimals.assignedCount}/4 assigned`
                      : "-"}
                </span>
              </div>

              {parsedAnimals ? (
                <div className="mt-2 flex flex-col gap-2">
                  {Array.from({ length: LANE_COUNT }).map((_, lane) => {
                    const tokenId = parsedAnimals.tokenIds[lane] ?? 0n;
                    const owner = parsedAnimals.originalOwners[lane];
                    const isHouse = !!houseAddress && owner?.toLowerCase?.() === (houseAddress as string).toLowerCase();

                    return (
                      <div key={lane} className="rounded-xl bg-base-100 border border-base-300 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">
                            Lane {lane}: {LANE_EMOJI} <LaneName tokenId={tokenId} fallback={`Lane ${lane}`} />
                          </div>
                          <div className="text-xs opacity-70">
                            {tokenId === 0n ? "Unassigned" : isHouse ? "House" : "Submitted"}
                          </div>
                        </div>

                        {tokenId === 0n ? (
                          <div className="text-xs opacity-70 mt-1">No NFT assigned yet.</div>
                        ) : (
                          <div className="mt-1 grid grid-cols-1 gap-1">
                            <div className="flex justify-between text-xs">
                              <span className="opacity-70">Token ID</span>
                              <span className="font-mono">{tokenId.toString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="opacity-70">Original owner</span>
                              <span className="text-right">
                                <Address address={owner} chain={targetNetwork} />
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 text-xs opacity-70">No lane data yet.</div>
              )}
            </div>

            <div className="divider my-1" />

            <div className="text-sm">
              <div className="flex justify-between items-center">
                <span className="opacity-70">Verified winner (on-chain)</span>
                <span className="font-semibold">
                  {verifiedWinner === null ? (
                    "-"
                  ) : (
                    <>
                      {LANE_EMOJI}{" "}
                      {parsedAnimals ? (
                        <LaneName
                          tokenId={parsedAnimals.tokenIds[verifiedWinner] ?? 0n}
                          fallback={`Lane ${verifiedWinner}`}
                        />
                      ) : (
                        `Lane ${verifiedWinner}`
                      )}
                    </>
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="opacity-70">Simulated winner (TS replay)</span>
                <span className="font-semibold">
                  {simulatedWinner === null ? (
                    "-"
                  ) : (
                    <>
                      {LANE_EMOJI}{" "}
                      {parsedAnimals ? (
                        <LaneName
                          tokenId={parsedAnimals.tokenIds[simulatedWinner] ?? 0n}
                          fallback={`Lane ${simulatedWinner}`}
                        />
                      ) : (
                        `Lane ${simulatedWinner}`
                      )}
                    </>
                  )}
                </span>
              </div>
              {verifiedWinner !== null && simulatedWinner !== null ? (
                <div className={`mt-2 alert ${winnersMatch ? "alert-success" : "alert-warning"}`}>
                  <span className="text-sm">
                    {winnersMatch ? "Verified: simulation matches on-chain winner." : "Mismatch: check seed/constants."}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="card bg-base-200 shadow">
        <div className="card-body gap-4">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Race</h2>
            <div className="flex items-center gap-2">
              <div className="join">
                <button
                  className={`btn btn-sm join-item ${playbackSpeed === 1 ? "btn-active" : ""}`}
                  onClick={() => setPlaybackSpeed(1)}
                  disabled={!simulation}
                >
                  1x
                </button>
                <button
                  className={`btn btn-sm join-item ${playbackSpeed === 2 ? "btn-active" : ""}`}
                  onClick={() => setPlaybackSpeed(2)}
                  disabled={!simulation}
                >
                  2x
                </button>
                <button
                  className={`btn btn-sm join-item ${playbackSpeed === 3 ? "btn-active" : ""}`}
                  onClick={() => setPlaybackSpeed(3)}
                  disabled={!simulation}
                >
                  3x
                </button>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setFrame(0);
                  setRaceStarted(false);
                  setStartDelayRemainingMs(3000);
                  setSvgResetNonce(n => n + 1);
                }}
                disabled={!simulation}
              >
                Reset
              </button>
              <button className="btn btn-sm" onClick={() => stepBy(-1)} disabled={!simulation || frame === 0}>
                ◀︎ Tick
              </button>
              <button
                className="btn btn-sm"
                onClick={() => stepBy(1)}
                disabled={!simulation || frame >= lastFrameIndex}
              >
                Tick ▶︎
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => setIsPlaying(p => !p)} disabled={!simulation}>
                {isPlaying ? "Pause" : "Play"}
              </button>
            </div>
          </div>

          {!animalRaceContract ? (
            <div className="alert alert-info">
              <span className="text-sm">
                Deploy the contracts first (run `yarn chain` + `yarn deploy`). Then settle a race in `/debug`.
              </span>
            </div>
          ) : !parsed ? (
            <div className="alert alert-warning">
              <span className="text-sm">
                No race data yet. Make sure `raceId` exists (create a race + place bets + settle).
              </span>
            </div>
          ) : !parsed.settled ? (
            <div className="alert alert-info">
              <span className="text-sm">Race isn’t settled yet, so the seed is unknown. Settle it to replay.</span>
            </div>
          ) : !simulation ? (
            <div className="alert alert-warning">
              <span className="text-sm">Missing/invalid seed. Try settling the race again.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between text-sm opacity-70">
                <span>
                  Tick: <span className="font-semibold opacity-100">{frame}</span> / {lastFrameIndex}
                </span>
                <span>
                  Finish: <span className="font-semibold opacity-100">{trackLength}</span>
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {/* Shared track: all lanes update on the same frame/tick (must match on-chain sim) */}
                {(() => {
                  const transitionMs = Math.floor(120 / playbackSpeed);
                  const raceIsOver = frame >= lastFrameIndex;

                  return (
                    <div
                      ref={viewportRefCb}
                      className="relative w-full rounded-2xl bg-base-100 border border-base-300 overflow-hidden"
                      style={{ height: `${trackHeightPx}px` }}
                    >
                      {/* Fixed lane labels */}
                      <div className="absolute left-3 top-3 bottom-3 z-10 flex flex-col justify-between pointer-events-none">
                        {Array.from({ length: LANE_COUNT }).map((_, i) => {
                          const d = Number(currentDistances[i] ?? 0);
                          const isWinner = verifiedWinner === i;
                          return (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-xs opacity-80"
                              style={{ height: `${laneHeightPx}px` }}
                            >
                              <span className="font-medium whitespace-nowrap">
                                Lane {i}
                                {isWinner ? " (winner)" : ""}
                              </span>
                              <span className="opacity-60 tabular-nums">· {d}</span>
                              <span className="opacity-60">
                                {parsedAnimals ? (
                                  <LaneName tokenId={parsedAnimals.tokenIds[i] ?? 0n} fallback={`Lane ${i}`} />
                                ) : null}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Camera viewport */}
                      <div className="absolute inset-0">
                        <div ref={cameraScrollRefCb} className="absolute inset-0 overflow-hidden">
                          <div
                            className="relative"
                            style={{ width: `${worldWidthPx}px`, height: `${trackHeightPx}px` }}
                          >
                            {/* Track background */}
                            <div className="absolute inset-0">
                              {/* Start + finish */}
                              <div
                                className="absolute top-3 bottom-3 w-[3px] bg-base-300"
                                style={{ left: `${worldPaddingLeftPx}px` }}
                              />
                              <div
                                className="absolute top-3 bottom-3 w-[3px] bg-base-300"
                                style={{
                                  left: `${worldPaddingLeftPx + trackLengthPx}px`,
                                }}
                              />

                              {/* Tick grid */}
                              <div
                                className="absolute inset-0 opacity-30"
                                style={{
                                  background:
                                    "repeating-linear-gradient(90deg, transparent, transparent 29px, rgba(0,0,0,0.10) 30px)",
                                }}
                              />

                              {/* Lanes */}
                              {Array.from({ length: LANE_COUNT }).map((_, i) => {
                                const top = i * (laneHeightPx + laneGapPx);
                                return (
                                  <div
                                    key={i}
                                    className="absolute left-0 right-0 rounded-xl"
                                    style={{
                                      top: `${top}px`,
                                      height: `${laneHeightPx}px`,
                                      // Dirt-ish lane texture: base tint + speckles + subtle ruts.
                                      // (Pure CSS, no assets; tuned to remain readable on light/dark themes.)
                                      background: [
                                        // soft lighting
                                        "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.10))",
                                        // dirt tint
                                        "linear-gradient(90deg, rgba(168,118,72,0.20), rgba(168,118,72,0.12))",
                                        // speckles
                                        "radial-gradient(circle at 20% 30%, rgba(0,0,0,0.12) 0 1px, transparent 2px)",
                                        "radial-gradient(circle at 70% 60%, rgba(0,0,0,0.10) 0 1px, transparent 2px)",
                                        "radial-gradient(circle at 40% 80%, rgba(255,255,255,0.06) 0 1px, transparent 2px)",
                                        // subtle ruts/striations
                                        "repeating-linear-gradient(90deg, rgba(0,0,0,0.00), rgba(0,0,0,0.00) 10px, rgba(0,0,0,0.06) 11px)",
                                      ].join(", "),
                                      backgroundSize: "auto, auto, 18px 18px, 22px 22px, 26px 26px, auto",
                                      border: "1px solid rgba(0,0,0,0.06)",
                                    }}
                                  />
                                );
                              })}
                            </div>

                            {/* Giraffes */}
                            {Array.from({ length: LANE_COUNT }).map((_, i) => {
                              const d = Number(currentDistances[i] ?? 0);
                              const prev = Number(prevDistances[i] ?? 0);
                              const delta = Math.max(0, d - prev); // 1..10 normally (per on-chain)
                              const isWinner = verifiedWinner === i;

                              // Tie the SVG animation speed to the *per-tick* movement delta.
                              // Movement uses the same frames array as the on-chain sim; this only changes visuals.
                              // Delta ranges from 1 to speedRange (10) based on on-chain simulation.
                              const MIN_ANIMATION_SPEED_FACTOR = 2.0;
                              const MAX_ANIMATION_SPEED_FACTOR = 5.0;
                              const minDelta = 1;
                              const maxDelta = SPEED_RANGE;
                              const t = Math.max(0, Math.min(1, (delta - minDelta) / (maxDelta - minDelta)));
                              const speedFactor =
                                MIN_ANIMATION_SPEED_FACTOR +
                                t * (MAX_ANIMATION_SPEED_FACTOR - MIN_ANIMATION_SPEED_FACTOR);

                              const x =
                                worldPaddingLeftPx +
                                (Math.min(trackLength, Math.max(0, d)) / trackLength) * trackLengthPx;
                              const y = i * (laneHeightPx + laneGapPx) + laneHeightPx / 2;

                              return (
                                <div
                                  key={i}
                                  className="absolute left-0 top-0"
                                  style={{
                                    transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`,
                                    transition: `transform ${transitionMs}ms linear`,
                                    willChange: "transform",
                                    filter: isWinner ? "drop-shadow(0 6px 10px rgba(0,0,0,0.25))" : undefined,
                                  }}
                                >
                                  <GiraffeAnimated
                                    idPrefix={`lane-${i}`}
                                    playbackRate={speedFactor}
                                    resetNonce={svgResetNonce}
                                    playing={isPlaying && raceStarted && !raceIsOver}
                                    sizePx={giraffeSizePx}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <details className="collapse collapse-arrow bg-base-100">
                <summary className="collapse-title text-sm font-medium">Seed (bytes32)</summary>
                <div className="collapse-content">
                  <code className="text-xs break-all">{parsed.seed}</code>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
