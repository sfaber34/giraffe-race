"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { Hex, formatEther, isHex, toHex } from "viem";
import { usePublicClient } from "wagmi";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { simulateRaceFromSeed } from "~~/utils/race/simulateRace";

const LANE_COUNT = 4 as const;
const LANE_EMOJI = "🦒";

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
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 3>(2);
  const [scaleFactor, setScaleFactor] = useState(1);

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
      speedRange: 10,
      trackLength: 1000,
    });
  }, [parsed, canSimulate]);

  const frames = simulation?.frames ?? [];
  const lastFrameIndex = Math.max(0, frames.length - 1);

  useEffect(() => {
    setFrame(0);
  }, [parsed?.seed]);

  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const viewportRefCb = useCallback((el: HTMLDivElement | null) => {
    setViewportEl(el);
  }, []);
  const [viewportWidthPx, setViewportWidthPx] = useState(0);

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

    const id = window.setInterval(
      () => {
        setFrame(prev => (prev >= lastFrameIndex ? lastFrameIndex : prev + 1));
      },
      Math.floor(120 / playbackSpeed),
    );

    return () => window.clearInterval(id);
  }, [isPlaying, simulation, lastFrameIndex, playbackSpeed]);

  const currentDistances = frames[frame] ?? [0, 0, 0, 0];
  const trackLength = 1000;
  const prevDistances = frames[Math.max(0, frame - 1)] ?? [0, 0, 0, 0];

  const verifiedWinner = parsed?.settled ? parsed.winner : null;
  const simulatedWinner = simulation ? simulation.winner : null;
  const winnersMatch = verifiedWinner !== null && simulatedWinner !== null && verifiedWinner === simulatedWinner;

  const stepBy = (delta: -1 | 1) => {
    setIsPlaying(false);
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
    <div className="flex flex-col gap-8 w-full max-w-4xl px-6 py-10">
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
              <button className="btn btn-sm" onClick={() => setFrame(0)} disabled={!simulation}>
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
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs opacity-70">Scale</div>
                  <input
                    className="range range-xs w-56"
                    type="range"
                    min={0.6}
                    max={1.8}
                    step={0.05}
                    value={scaleFactor}
                    onChange={e => setScaleFactor(Number(e.target.value))}
                  />
                  <div className="text-xs tabular-nums opacity-70 w-12 text-right">{scaleFactor.toFixed(2)}x</div>
                </div>

                {/* Shared track: all lanes update on the same frame/tick (must match on-chain sim) */}
                {(() => {
                  const laneHeightPx = 86;
                  const laneGapPx = 10;
                  const worldPaddingLeftPx = 80;
                  const worldPaddingRightPx = 140;
                  const pxPerUnit = 3;
                  const giraffeSizePx = 78;
                  const trackLengthPx = trackLength * pxPerUnit;
                  const worldWidthPx = worldPaddingLeftPx + trackLengthPx + worldPaddingRightPx;
                  const transitionMs = Math.floor(120 / playbackSpeed);

                  const leader = Math.max(...currentDistances.map(x => Number(x ?? 0)));
                  const leaderX = worldPaddingLeftPx + (leader / trackLength) * trackLengthPx;
                  const viewportWorldWidth = viewportWidthPx > 0 ? viewportWidthPx / Math.max(0.25, scaleFactor) : 0;

                  const finishLineX = worldPaddingLeftPx + trackLengthPx;

                  // Keep the leader fully visible (account for sprite width), not just the leader point.
                  const spriteHalf = giraffeSizePx / 2;
                  const spritePad = 12; // extra safety padding so it doesn't kiss the edge
                  const minLeaderScreenX = spriteHalf + spritePad;
                  const maxLeaderScreenX = Math.max(minLeaderScreenX, viewportWorldWidth - (spriteHalf + spritePad));
                  const maxCameraX = Math.max(0, worldWidthPx - viewportWorldWidth);

                  // Camera behavior:
                  // 1) Start: no camera movement (cameraX=0).
                  // 2) Mid-race: follow leader, keeping them toward the right side.
                  // 3) Finish approach: stop slewing once the finish line is visible on the right side.
                  const followStartThresholdScreenX = viewportWorldWidth * 0.84;
                  const followStartX = Math.max(minLeaderScreenX, followStartThresholdScreenX);

                  const targetLeaderScreenX = viewportWorldWidth * 0.8; // keep leader near the right
                  const desiredLeaderScreenX = Math.min(
                    maxLeaderScreenX,
                    Math.max(minLeaderScreenX, targetLeaderScreenX),
                  );

                  // Camera position that keeps the finish line visible on the right with a small inset.
                  const finishInset = 18;
                  const freezeX = Math.min(maxCameraX, Math.max(0, finishLineX - (viewportWorldWidth - finishInset)));

                  // If we haven't reached the follow threshold yet, stay in state (1).
                  const followXUnclamped = leaderX - desiredLeaderScreenX;
                  const followX = Math.min(maxCameraX, Math.max(0, followXUnclamped));

                  const cameraX = viewportWorldWidth <= 0 ? 0 : leaderX < followStartX ? 0 : Math.min(followX, freezeX);

                  return (
                    <div
                      ref={viewportRefCb}
                      className="relative w-full rounded-2xl bg-base-100 border border-base-300 overflow-hidden"
                      style={{ height: `${LANE_COUNT * (laneHeightPx + laneGapPx) - laneGapPx}px` }}
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
                      <div
                        className="absolute inset-0"
                        style={{
                          transform: `scale(${scaleFactor})`,
                          transformOrigin: "top left",
                        }}
                      >
                        <div
                          className="absolute inset-0"
                          style={{
                            width: `${worldWidthPx}px`,
                            transform: `translateX(${-cameraX}px)`,
                            transition: `transform ${transitionMs}ms linear`,
                          }}
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
                                    background:
                                      "linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.02)), repeating-linear-gradient(90deg, rgba(0,0,0,0.00), rgba(0,0,0,0.00) 10px, rgba(0,0,0,0.05) 11px)",
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
                            const speedFactor = Math.min(3, Math.max(0.6, delta / 4));
                            const durationMs = 2000 / speedFactor;

                            const x =
                              worldPaddingLeftPx +
                              (Math.min(trackLength, Math.max(0, d)) / trackLength) * trackLengthPx;
                            const y = i * (laneHeightPx + laneGapPx) + laneHeightPx / 2;

                            return (
                              <div
                                key={i}
                                className="absolute"
                                style={{
                                  left: `${x}px`,
                                  top: `${y}px`,
                                  transform: "translate(-50%, -50%)",
                                  transition: `left ${transitionMs}ms linear`,
                                  filter: isWinner ? "drop-shadow(0 6px 10px rgba(0,0,0,0.25))" : undefined,
                                }}
                              >
                                <GiraffeAnimated
                                  idPrefix={`lane-${i}`}
                                  durationMs={durationMs}
                                  playing={isPlaying}
                                  sizePx={giraffeSizePx}
                                />
                              </div>
                            );
                          })}
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
