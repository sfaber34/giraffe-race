"use client";

import { useEffect, useMemo, useState } from "react";
import { Address, Balance } from "@scaffold-ui/components";
import { Hex, formatEther, isHex, toHex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { simulateRaceFromSeed } from "~~/utils/race/simulateRace";

const ANIMALS = [
  { name: "Giraffe", emoji: "🦒" },
  { name: "Cheetah", emoji: "🐆" },
  { name: "Turtle", emoji: "🐢" },
  { name: "Elephant", emoji: "🐘" },
] as const;

export const AnimalRaceHome = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });

  const [raceId, setRaceId] = useState<bigint>(0n);
  const [isPlaying, setIsPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [isMining, setIsMining] = useState(false);

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
      animalCount: 4,
      tickCount: 40,
      speedRange: 6,
    });
  }, [parsed, canSimulate]);

  const frames = simulation?.frames ?? [];
  const lastFrameIndex = Math.max(0, frames.length - 1);

  useEffect(() => {
    setFrame(0);
  }, [parsed?.seed]);

  useEffect(() => {
    if (!isPlaying) return;
    if (!simulation) return;

    const id = window.setInterval(() => {
      setFrame(prev => (prev >= lastFrameIndex ? lastFrameIndex : prev + 1));
    }, 120);

    return () => window.clearInterval(id);
  }, [isPlaying, simulation, lastFrameIndex]);

  const currentDistances = frames[frame] ?? [0, 0, 0, 0];
  const finishDistance = Math.max(...(frames[lastFrameIndex] ?? [0]), 1);

  const verifiedWinner = parsed?.settled ? parsed.winner : null;
  const simulatedWinner = simulation ? simulation.winner : null;
  const winnersMatch = verifiedWinner !== null && simulatedWinner !== null && verifiedWinner === simulatedWinner;

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
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">Giraffe Race</h1>
        <p className="text-base-content/70">
          On-chain deterministic outcome, with a tick-by-tick replay animation from the same seed.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Wallet</h2>
              <div className="text-xs opacity-70">{targetNetwork.name}</div>
            </div>
            <div className="flex flex-col gap-2">
              <Address address={connectedAddress} chain={targetNetwork} />
              {connectedAddress ? <Balance address={connectedAddress} /> : null}
            </div>
          </div>
        </div>

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
              {isMining ? <span className="text-xs opacity-70 self-center">Mining…</span> : null}
            </div>

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
              <div className="flex justify-between items-center">
                <span className="opacity-70">Verified winner (on-chain)</span>
                <span className="font-semibold">
                  {verifiedWinner === null
                    ? "-"
                    : ANIMALS[verifiedWinner]
                      ? `${ANIMALS[verifiedWinner].emoji} ${ANIMALS[verifiedWinner].name}`
                      : verifiedWinner}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="opacity-70">Simulated winner (TS replay)</span>
                <span className="font-semibold">
                  {simulatedWinner === null
                    ? "-"
                    : ANIMALS[simulatedWinner]
                      ? `${ANIMALS[simulatedWinner].emoji} ${ANIMALS[simulatedWinner].name}`
                      : simulatedWinner}
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
              <button className="btn btn-sm" onClick={() => setFrame(0)} disabled={!simulation}>
                Reset
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
                  Max distance:{" "}
                  <span className="font-semibold opacity-100">{Math.max(...(frames[lastFrameIndex] ?? [0]))}</span>
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {ANIMALS.map((animal, i) => {
                  const d = currentDistances[i] ?? 0;
                  const pct = Math.min(100, Math.max(0, Math.round((d / finishDistance) * 100)));
                  const isWinner = verifiedWinner === i;
                  return (
                    <div key={animal.name} className="flex flex-col gap-1">
                      <div className="flex justify-between text-sm">
                        <span className={`font-semibold ${isWinner ? "text-success" : ""}`}>
                          {animal.emoji} {animal.name} {isWinner ? "(winner)" : ""}
                        </span>
                        <span className="opacity-70">{d}</span>
                      </div>
                      <div className="relative w-full h-10 rounded-xl bg-base-100 border border-base-300 overflow-hidden">
                        {/* Start line */}
                        <div className="absolute left-2 top-1 bottom-1 w-[2px] bg-base-300" />
                        {/* Finish line */}
                        <div className="absolute right-2 top-1 bottom-1 w-[2px] bg-base-300" />

                        {/* Track */}
                        <div className="absolute inset-0 opacity-30 [background:repeating-linear-gradient(90deg,transparent,transparent_14px,rgba(0,0,0,0.08)_15px)]" />

                        {/* Runner */}
                        <div
                          className={`absolute top-1/2 text-2xl ${isWinner ? "drop-shadow" : ""}`}
                          style={{
                            left: `calc(${pct}% * 0.96 + 2%)`,
                            transform: "translate(-50%, -50%)",
                          }}
                          aria-label={animal.name}
                        >
                          {animal.emoji}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
