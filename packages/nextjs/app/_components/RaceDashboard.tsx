"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Address, EtherInput } from "@scaffold-ui/components";
import { Hex, formatEther, isHex, parseEther, toHex } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";
import { simulateRaceFromSeed } from "~~/utils/race/simulateRace";

const LANE_COUNT = 4 as const;
const LANE_EMOJI = "🦒";

// Keep in sync with `AnimalRace.sol`
const SUBMISSION_CLOSE_OFFSET_BLOCKS = 10n;
const BETTING_CLOSE_OFFSET_BLOCKS = 20n;
const SPEED_RANGE = 10;
const TRACK_LENGTH = 1000;
const MAX_TICKS = 500;

type RaceStatus = "no_race" | "submissions_open" | "betting_open" | "betting_closed" | "settled";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const BlockCountdownBar = ({
  label,
  current,
  start,
  end,
}: {
  label: string;
  current?: bigint;
  start?: bigint;
  end?: bigint;
}) => {
  const progress = useMemo(() => {
    if (current === undefined || start === undefined || end === undefined) return null;
    if (end <= start) return null;
    const p = Number(current - start) / Number(end - start);
    return clamp01(p);
  }, [current, start, end]);

  const remaining = useMemo(() => {
    if (current === undefined || end === undefined) return null;
    if (current >= end) return 0n;
    return end - current;
  }, [current, end]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="opacity-70">{label}</span>
        <span className="font-mono opacity-80">{remaining === null ? "-" : `${remaining.toString()} blocks`}</span>
      </div>
      <progress className="progress progress-primary w-full" value={progress === null ? 0 : progress * 100} max={100} />
    </div>
  );
};

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

export const RaceDashboard = () => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { address: connectedAddress } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const [isMining, setIsMining] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<bigint | null>(null);
  const [betLane, setBetLane] = useState<0 | 1 | 2 | 3>(0);
  const [betAmountEth, setBetAmountEth] = useState("");
  const [ownedTokenNameById, setOwnedTokenNameById] = useState<Record<string, string>>({});
  const [isLoadingOwnedTokenNames, setIsLoadingOwnedTokenNames] = useState(false);

  // Replay controls
  const [isPlaying, setIsPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 3>(1);
  const [raceStarted, setRaceStarted] = useState(false);
  const [startDelayRemainingMs, setStartDelayRemainingMs] = useState(3000);
  const startDelayEndAtRef = useRef<number | null>(null);
  const startDelayTimeoutRef = useRef<number | null>(null);
  const [svgResetNonce, setSvgResetNonce] = useState(0);

  const { data: animalRaceContract, isLoading: isAnimalRaceLoading } = useDeployedContractInfo({
    contractName: "AnimalRace",
  });
  const { data: animalNftContract } = useDeployedContractInfo({ contractName: "AnimalNFT" });

  const { data: ownedTokenIdsData, isLoading: isOwnedTokensLoading } = useScaffoldReadContract({
    contractName: "AnimalNFT",
    functionName: "tokensOfOwner",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress },
  });

  const ownedTokenIds = useMemo(() => {
    const raw = (ownedTokenIdsData as readonly bigint[] | undefined) ?? [];
    return raw.map(x => BigInt(x)).filter(x => x !== 0n);
  }, [ownedTokenIdsData]);

  useEffect(() => {
    const run = async () => {
      if (!publicClient) return;
      if (!animalNftContract?.address || !animalNftContract?.abi) return;
      if (ownedTokenIds.length === 0) {
        setOwnedTokenNameById({});
        return;
      }

      setIsLoadingOwnedTokenNames(true);
      try {
        const calls = ownedTokenIds.map(tokenId => ({
          address: animalNftContract.address as `0x${string}`,
          abi: animalNftContract.abi as any,
          functionName: "nameOf",
          args: [tokenId],
        }));

        const res = (await publicClient.multicall({ contracts: calls as any, allowFailure: true })) as any[];

        const next: Record<string, string> = {};
        ownedTokenIds.forEach((tokenId, i) => {
          next[tokenId.toString()] = (((res[i] as any)?.result as string | undefined) ?? "").trim();
        });
        setOwnedTokenNameById(next);
      } finally {
        setIsLoadingOwnedTokenNames(false);
      }
    };

    void run();
  }, [publicClient, animalNftContract?.address, animalNftContract?.abi, ownedTokenIds]);

  const { data: nextRaceIdData } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "nextRaceId",
    query: { enabled: !!animalRaceContract },
  });
  const nextRaceId = (nextRaceIdData as bigint | undefined) ?? 0n;
  const hasAnyRace = !!animalRaceContract && nextRaceId > 0n;
  const latestRaceId = hasAnyRace ? nextRaceId - 1n : null;

  const { data: raceData } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getRace",
    query: { enabled: hasAnyRace },
  });

  const { data: raceAnimalsData } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getRaceAnimals",
    query: { enabled: hasAnyRace },
  });

  const { data: houseAddress } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "house",
    query: { enabled: !!animalRaceContract },
  });

  const parsed = useMemo(() => {
    if (!raceData) return null;
    const [closeBlock, settled, winner, seed, totalPot, totalOnAnimal] = raceData;
    return {
      closeBlock: closeBlock as bigint,
      settled: settled as boolean,
      winner: Number(winner as any) as 0 | 1 | 2 | 3,
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

  const submissionCloseBlock = useMemo(() => {
    if (!parsed) return null;
    if (parsed.closeBlock < SUBMISSION_CLOSE_OFFSET_BLOCKS) return null;
    return parsed.closeBlock - SUBMISSION_CLOSE_OFFSET_BLOCKS;
  }, [parsed]);

  const startBlock = useMemo(() => {
    if (!parsed) return null;
    if (parsed.closeBlock < BETTING_CLOSE_OFFSET_BLOCKS) return null;
    return parsed.closeBlock - BETTING_CLOSE_OFFSET_BLOCKS;
  }, [parsed]);

  const status: RaceStatus = useMemo(() => {
    if (!animalRaceContract) return "no_race";
    if (!hasAnyRace || !parsed) return "no_race";
    if (parsed.settled) return "settled";
    if (blockNumber === undefined) return "betting_closed";
    if (submissionCloseBlock !== null && blockNumber < submissionCloseBlock) return "submissions_open";
    if (blockNumber < parsed.closeBlock) return "betting_open";
    return "betting_closed";
  }, [animalRaceContract, hasAnyRace, parsed, blockNumber, submissionCloseBlock]);

  const lineupFinalized = (parsedAnimals?.assignedCount ?? 0) === 4;
  const canFinalize = status === "betting_open" && !lineupFinalized;
  const canBet = status === "betting_open" && lineupFinalized;
  const canSettle = !!parsed && !parsed.settled && blockNumber !== undefined && blockNumber > parsed.closeBlock;
  const canSubmit =
    status === "submissions_open" ||
    status === "no_race" || // will auto-create a race
    status === "settled"; // will auto-create the next race

  const placeBetValue = useMemo(() => {
    const v = betAmountEth.trim();
    if (!v) return null;
    try {
      const wei = parseEther(v as `${number}`);
      if (wei <= 0n) return null;
      return wei;
    } catch {
      return null;
    }
  }, [betAmountEth]);

  const { data: myBetData } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getBet",
    args: [connectedAddress],
    query: { enabled: !!animalRaceContract && !!connectedAddress && hasAnyRace },
  });

  const myBet = useMemo(() => {
    if (!myBetData) return null;
    const [amount, animal, claimed] = myBetData;
    const amt = BigInt(amount as any);
    return {
      amount: amt,
      animal: Number(animal as any) as 0 | 1 | 2 | 3,
      claimed: claimed as boolean,
      hasBet: amt !== 0n,
    };
  }, [myBetData]);

  const { data: nextClaimData } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getNextClaim",
    args: [connectedAddress],
    query: { enabled: !!animalRaceContract && !!connectedAddress },
  });

  const nextClaim = useMemo(() => {
    if (!nextClaimData) return null;
    // `getNextClaim` returns a struct (tuple)
    const out = nextClaimData as any;
    return {
      hasClaim: Boolean(out?.hasClaim),
      raceId: BigInt(out?.raceId ?? 0),
      status: Number(out?.status ?? 0) as 0 | 1 | 2 | 3,
      betAnimal: Number(out?.betAnimal ?? 0) as 0 | 1 | 2 | 3,
      betAmount: BigInt(out?.betAmount ?? 0),
      winner: Number(out?.winner ?? 0) as 0 | 1 | 2 | 3,
      payout: BigInt(out?.payout ?? 0),
      closeBlock: BigInt(out?.closeBlock ?? 0),
    };
  }, [nextClaimData]);

  const canClaimNow = useMemo(() => {
    if (!nextClaim?.hasClaim) return false;
    // status 1 = claim will settle first; 2/3 = already settled
    return nextClaim.status === 1 || nextClaim.status === 2 || nextClaim.status === 3;
  }, [nextClaim]);

  const { writeContractAsync: writeAnimalRaceAsync } = useScaffoldWriteContract({ contractName: "AnimalRace" });

  const mineBlocks = async (count: number) => {
    if (!publicClient) return;
    setIsMining(true);
    try {
      const hexCount = toHex(count);
      try {
        await publicClient.request({ method: "anvil_mine" as any, params: [hexCount] as any });
        return;
      } catch {
        try {
          await publicClient.request({ method: "hardhat_mine" as any, params: [hexCount] as any });
          return;
        } catch {
          for (let i = 0; i < count; i++) {
            await publicClient.request({ method: "evm_mine" as any, params: [] as any });
          }
        }
      }
    } finally {
      setIsMining(false);
    }
  };

  // ---- Replay / simulation ----
  const canSimulate = useMemo(() => {
    if (!parsed?.settled) return false;
    if (!parsed.seed) return false;
    return isHex(parsed.seed) && parsed.seed !== "0x" + "0".repeat(64);
  }, [parsed]);

  const simulation = useMemo(() => {
    if (!parsed || !canSimulate) return null;
    return simulateRaceFromSeed({
      seed: parsed.seed,
      animalCount: LANE_COUNT,
      maxTicks: MAX_TICKS,
      speedRange: SPEED_RANGE,
      trackLength: TRACK_LENGTH,
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

  // Start-delay logic (3s hold at start line)
  useEffect(() => {
    if (!simulation) return;
    if (!isPlaying) return;
    if (raceStarted) return;
    if (frame !== 0) return;

    if (startDelayTimeoutRef.current) {
      window.clearTimeout(startDelayTimeoutRef.current);
      startDelayTimeoutRef.current = null;
    }

    const remaining = Math.max(0, Math.floor(startDelayRemainingMs));
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
  }, [simulation, isPlaying, raceStarted, frame, startDelayRemainingMs]);

  useEffect(() => {
    if (frame > 0 && !raceStarted) {
      setRaceStarted(true);
      setStartDelayRemainingMs(0);
    }
  }, [frame, raceStarted]);

  useEffect(() => {
    if (!isPlaying) return;
    if (!simulation) return;
    if (!raceStarted) return;

    const id = window.setInterval(
      () => setFrame(prev => (prev >= lastFrameIndex ? lastFrameIndex : prev + 1)),
      Math.floor(120 / playbackSpeed),
    );
    return () => window.clearInterval(id);
  }, [isPlaying, simulation, raceStarted, lastFrameIndex, playbackSpeed]);

  const currentDistances = useMemo(() => frames[frame] ?? [0, 0, 0, 0], [frames, frame]);
  const prevDistances = useMemo(() => frames[Math.max(0, frame - 1)] ?? [0, 0, 0, 0], [frames, frame]);

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

  const verifiedWinner = parsed?.settled ? parsed.winner : null;
  const simulatedWinner = simulation ? simulation.winner : null;
  const winnersMatch = verifiedWinner !== null && simulatedWinner !== null && verifiedWinner === simulatedWinner;

  // Track geometry (simplified: no camera follow; fits most screens well enough for now)
  const laneHeightPx = 86;
  const laneGapPx = 10;
  const worldPaddingLeftPx = 80;
  const worldPaddingRightPx = 140;
  const pxPerUnit = 3;
  const giraffeSizePx = 78;
  const trackLengthPx = TRACK_LENGTH * pxPerUnit;
  const worldWidthPx = worldPaddingLeftPx + trackLengthPx + worldPaddingRightPx;
  const trackHeightPx = LANE_COUNT * (laneHeightPx + laneGapPx) - laneGapPx;

  const activeRaceExists = status !== "no_race" && !parsed?.settled;

  return (
    <div className="flex flex-col w-full">
      <div className="sticky top-0 z-50 bg-base-100/80 backdrop-blur border-b border-base-200">
        <div className="mx-auto w-full max-w-6xl px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col">
              <div className="text-sm font-medium">Mine blocks (local)</div>
              <div className="text-xs opacity-70">Keep these for fast state transitions.</div>
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
          </div>
        </div>
      </div>

      <div className="mx-auto flex flex-col gap-8 w-full max-w-6xl px-6 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold">Giraffe Race</h1>
          <p className="text-base-content/70">
            Single on-demand flow: start race (or submit), wait for submissions to close, finalize lineup, bet, settle,
            replay, claim.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card bg-base-200 shadow lg:col-span-1">
            <div className="card-body gap-3">
              <div className="flex items-center justify-between">
                <h2 className="card-title">Race status</h2>
                <div className="text-xs opacity-70">
                  {isAnimalRaceLoading
                    ? "Checking contract…"
                    : animalRaceContract
                      ? "AnimalRace deployed"
                      : "Not deployed"}
                </div>
              </div>

              {!animalRaceContract ? (
                <div className="alert alert-info">
                  <span className="text-sm">Deploy the contracts first (`yarn chain` + `yarn deploy`).</span>
                </div>
              ) : status === "no_race" ? (
                <div className="alert alert-info">
                  <span className="text-sm">No active race. Start one, or submit an NFT (which will auto-start).</span>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span className="opacity-70">Race ID</span>
                    <span className="font-mono">{latestRaceId?.toString() ?? "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">Status</span>
                    <span className="font-semibold">
                      {status === "submissions_open"
                        ? "Submissions open"
                        : status === "betting_open"
                          ? "Betting open"
                          : status === "betting_closed"
                            ? "Betting closed"
                            : "Settled"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">Current block</span>
                    <span className="font-mono">{blockNumber !== undefined ? blockNumber.toString() : "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">Submissions close</span>
                    <span className="font-mono">{submissionCloseBlock?.toString() ?? "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">Betting closes</span>
                    <span className="font-mono">{parsed?.closeBlock?.toString() ?? "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">Lineup</span>
                    <span className="font-semibold">{lineupFinalized ? "Finalized" : "Not finalized"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">Pot</span>
                    <span>{parsed ? `${formatEther(parsed.totalPot)} ETH` : "-"}</span>
                  </div>
                </div>
              )}

              <div className="divider my-1" />

              <div className="flex flex-col gap-3">
                <BlockCountdownBar
                  label="Until submissions close"
                  current={blockNumber}
                  start={startBlock ?? undefined}
                  end={submissionCloseBlock ?? undefined}
                />
                <BlockCountdownBar
                  label="Until betting closes"
                  current={blockNumber}
                  start={submissionCloseBlock ?? undefined}
                  end={parsed?.closeBlock ?? undefined}
                />
                <BlockCountdownBar
                  label="Until settlement available"
                  current={blockNumber}
                  start={parsed?.closeBlock ?? undefined}
                  end={parsed ? parsed.closeBlock + 1n : undefined}
                />
              </div>

              <div className="divider my-1" />

              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium">Race controls</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={!animalRaceContract || activeRaceExists}
                    onClick={async () => {
                      await writeAnimalRaceAsync({ functionName: "createRace" } as any);
                    }}
                  >
                    Start race (no entries)
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    disabled={!animalRaceContract || !canFinalize}
                    onClick={async () => {
                      await writeAnimalRaceAsync({ functionName: "finalizeRaceAnimals" } as any);
                    }}
                  >
                    Finalize lineup
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    disabled={!animalRaceContract || !canSettle}
                    onClick={async () => {
                      await writeAnimalRaceAsync({ functionName: "settleRace" } as any);
                    }}
                  >
                    Settle race
                  </button>
                </div>
                <div className="text-xs opacity-70">
                  Anyone can start/finalize/settle. Finalize becomes available after submissions close; settle becomes
                  available after betting closes.
                </div>
              </div>

              <div className="divider my-1" />

              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium">Claim</div>
                {!connectedAddress ? (
                  <div className="text-xs opacity-70">Connect wallet to see your next claim.</div>
                ) : !nextClaim ? (
                  <div className="text-xs opacity-70">Loading claim status…</div>
                ) : !nextClaim.hasClaim ? (
                  <div className="text-xs opacity-70">No claimable bets.</div>
                ) : (
                  <div className="text-xs">
                    <div className="flex justify-between">
                      <span className="opacity-70">Next claim race</span>
                      <span className="font-mono">{nextClaim.raceId.toString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-70">Your bet</span>
                      <span className="font-semibold">
                        Lane {nextClaim.betAnimal} · {formatEther(nextClaim.betAmount)} ETH
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-70">Outcome</span>
                      <span className="font-semibold">
                        {nextClaim.status === 0
                          ? "Not claimable yet"
                          : nextClaim.status === 1
                            ? "Will settle then resolve"
                            : nextClaim.status === 2
                              ? `Lost (winner lane ${nextClaim.winner})`
                              : `Won (winner lane ${nextClaim.winner})`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-70">Estimated payout</span>
                      <span className="font-mono">{formatEther(nextClaim.payout)} ETH</span>
                    </div>
                  </div>
                )}
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!animalRaceContract || !connectedAddress || !nextClaim?.hasClaim || !canClaimNow}
                  onClick={async () => {
                    await writeAnimalRaceAsync({ functionName: "claim" } as any);
                  }}
                >
                  Claim next result
                </button>
                <div className="text-xs opacity-70">
                  {nextClaim?.hasClaim && nextClaim.status === 1
                    ? "Note: this claim will also settle the race (higher gas)."
                    : "Claim is enabled only when it won't revert."}
                </div>
              </div>
            </div>
          </div>

          <div className="card bg-base-200 shadow lg:col-span-2">
            <div className="card-body gap-4">
              <div className="flex items-center justify-between">
                <h2 className="card-title">Play</h2>
                <div className="text-xs opacity-70">
                  {status === "no_race"
                    ? "No race yet"
                    : parsed?.settled
                      ? "Settled (replay available)"
                      : "Not settled"}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card bg-base-100 border border-base-300">
                  <div className="card-body gap-3">
                    <h3 className="font-semibold">Enter an NFT</h3>
                    <p className="text-sm opacity-70">
                      Submitting starts a race if none is active. Submissions are open until the submissions-close
                      block.
                    </p>

                    <label className="form-control w-full">
                      <div className="label">
                        <span className="label-text">Your NFTs</span>
                      </div>
                      {!connectedAddress ? (
                        <div className="text-sm opacity-70">Connect your wallet to see your NFTs.</div>
                      ) : isOwnedTokensLoading ? (
                        <div className="text-sm opacity-70">Loading your NFTs…</div>
                      ) : ownedTokenIds.length === 0 ? (
                        <div className="text-sm opacity-70">You don’t own any AnimalNFTs yet.</div>
                      ) : (
                        <select
                          className="select select-bordered w-full"
                          value={selectedTokenId?.toString() ?? ""}
                          onChange={e => setSelectedTokenId(e.target.value ? BigInt(e.target.value) : null)}
                        >
                          <option value="" disabled>
                            Select an NFT…
                          </option>
                          {ownedTokenIds.map(tokenId => (
                            <option key={tokenId.toString()} value={tokenId.toString()}>
                              {LANE_EMOJI}{" "}
                              {(ownedTokenNameById[tokenId.toString()] || "").trim()
                                ? ownedTokenNameById[tokenId.toString()]
                                : isLoadingOwnedTokenNames
                                  ? "Loading…"
                                  : "(unnamed)"}{" "}
                              (#{tokenId.toString()})
                            </option>
                          ))}
                        </select>
                      )}
                    </label>

                    <button
                      className="btn btn-primary"
                      disabled={!animalRaceContract || !connectedAddress || selectedTokenId === null || !canSubmit}
                      onClick={async () => {
                        if (selectedTokenId === null) return;
                        await writeAnimalRaceAsync({ functionName: "submitAnimal", args: [selectedTokenId] } as any);
                        setSelectedTokenId(null);
                      }}
                    >
                      Submit NFT
                    </button>

                    {!canSubmit ? (
                      <div className="text-xs opacity-70">
                        Submissions are only available during the submissions window.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="card bg-base-100 border border-base-300">
                  <div className="card-body gap-3">
                    <h3 className="font-semibold">Place a bet</h3>
                    <p className="text-sm opacity-70">
                      Betting opens after submissions close and the lineup is finalized.
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: LANE_COUNT }).map((_, lane) => (
                        <button
                          key={lane}
                          className={`btn btn-sm ${betLane === lane ? "btn-primary" : "btn-outline"}`}
                          onClick={() => setBetLane(lane as 0 | 1 | 2 | 3)}
                          disabled={!canBet}
                          type="button"
                        >
                          {lineupFinalized && parsedAnimals?.tokenIds?.[lane] && parsedAnimals.tokenIds[lane] !== 0n ? (
                            <>
                              {LANE_EMOJI} <LaneName tokenId={parsedAnimals.tokenIds[lane]} fallback={`Lane ${lane}`} />
                            </>
                          ) : (
                            <>
                              Lane {lane} {LANE_EMOJI}
                            </>
                          )}
                        </button>
                      ))}
                    </div>

                    <div className={!canBet ? "opacity-50 pointer-events-none" : ""}>
                      <EtherInput
                        placeholder="Bet amount (ETH)"
                        onValueChange={({ valueInEth }) => {
                          if (!canBet) return;
                          setBetAmountEth(valueInEth);
                        }}
                        style={{ width: "100%" }}
                      />
                    </div>

                    <button
                      className="btn btn-primary"
                      disabled={
                        !animalRaceContract || !connectedAddress || !canBet || !placeBetValue || !!myBet?.hasBet
                      }
                      onClick={async () => {
                        if (!placeBetValue) return;
                        await writeAnimalRaceAsync({
                          functionName: "placeBet",
                          args: [betLane],
                          value: placeBetValue,
                        } as any);
                        setBetAmountEth("");
                      }}
                    >
                      Place bet
                    </button>

                    {!canBet ? (
                      <div className="text-xs opacity-70">
                        {status !== "betting_open"
                          ? "Betting is only available during the betting window."
                          : !lineupFinalized
                            ? "Finalize the lineup to reveal which NFTs are racing."
                            : "—"}
                      </div>
                    ) : myBet?.hasBet ? (
                      <div className="text-xs opacity-70">You already placed a bet for this race.</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="divider my-1" />

              <div className="text-sm">
                <div className="flex justify-between">
                  <span className="opacity-70">Lane NFTs</span>
                  <span>{parsedAnimals ? `${parsedAnimals.assignedCount}/4 assigned` : "-"}</span>
                </div>

                {parsedAnimals ? (
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {Array.from({ length: LANE_COUNT }).map((_, lane) => {
                      const tokenId = parsedAnimals.tokenIds[lane] ?? 0n;
                      const owner = parsedAnimals.originalOwners[lane];
                      const isHouse =
                        !!houseAddress && owner?.toLowerCase?.() === (houseAddress as string).toLowerCase();

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
                          {tokenId !== 0n ? (
                            <div className="mt-1 flex justify-between items-center text-xs">
                              <span className="opacity-70">Owner</span>
                              <span className="text-right">
                                <Address address={owner} chain={targetNetwork} />
                              </span>
                            </div>
                          ) : (
                            <div className="text-xs opacity-70 mt-1">No NFT assigned yet.</div>
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

              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Race replay</h3>
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
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setIsPlaying(p => !p)}
                    disabled={!simulation}
                  >
                    {isPlaying ? "Pause" : "Play"}
                  </button>
                </div>
              </div>

              {!parsed ? (
                <div className="alert alert-info">
                  <span className="text-sm">Start a race to see status and replay.</span>
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
                      Finish: <span className="font-semibold opacity-100">{TRACK_LENGTH}</span>
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
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

                  {verifiedWinner !== null && simulatedWinner !== null ? (
                    <div className={`alert ${winnersMatch ? "alert-success" : "alert-warning"}`}>
                      <span className="text-sm">
                        {winnersMatch
                          ? "Verified: simulation matches on-chain winner."
                          : "Mismatch: check seed/constants."}
                      </span>
                    </div>
                  ) : null}

                  <div className="relative w-full rounded-2xl bg-base-100 border border-base-300 overflow-x-auto">
                    <div className="relative" style={{ width: `${worldWidthPx}px`, height: `${trackHeightPx}px` }}>
                      <div
                        className="absolute inset-0 opacity-30"
                        style={{
                          background:
                            "repeating-linear-gradient(90deg, transparent, transparent 29px, rgba(0,0,0,0.10) 30px)",
                        }}
                      />
                      <div
                        className="absolute top-3 bottom-3 w-[3px] bg-base-300"
                        style={{ left: `${worldPaddingLeftPx}px` }}
                      />
                      <div
                        className="absolute top-3 bottom-3 w-[3px] bg-base-300"
                        style={{ left: `${worldPaddingLeftPx + trackLengthPx}px` }}
                      />

                      {Array.from({ length: LANE_COUNT }).map((_, i) => {
                        const top = i * (laneHeightPx + laneGapPx);
                        return (
                          <div
                            key={i}
                            className="absolute left-0 right-0 rounded-xl"
                            style={{
                              top: `${top}px`,
                              height: `${laneHeightPx}px`,
                              background: [
                                "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.10))",
                                "linear-gradient(90deg, rgba(168,118,72,0.20), rgba(168,118,72,0.12))",
                              ].join(", "),
                              border: "1px solid rgba(0,0,0,0.06)",
                            }}
                          />
                        );
                      })}

                      {Array.from({ length: LANE_COUNT }).map((_, i) => {
                        const d = Number(currentDistances[i] ?? 0);
                        const prev = Number(prevDistances[i] ?? 0);
                        const delta = Math.max(0, d - prev);
                        const isWinner = verifiedWinner === i;

                        const MIN_ANIMATION_SPEED_FACTOR = 2.0;
                        const MAX_ANIMATION_SPEED_FACTOR = 5.0;
                        const minDelta = 1;
                        const maxDelta = SPEED_RANGE;
                        const t = Math.max(0, Math.min(1, (delta - minDelta) / (maxDelta - minDelta)));
                        const speedFactor =
                          MIN_ANIMATION_SPEED_FACTOR + t * (MAX_ANIMATION_SPEED_FACTOR - MIN_ANIMATION_SPEED_FACTOR);

                        const x =
                          worldPaddingLeftPx + (Math.min(TRACK_LENGTH, Math.max(0, d)) / TRACK_LENGTH) * trackLengthPx;
                        const y = i * (laneHeightPx + laneGapPx) + laneHeightPx / 2;

                        return (
                          <div
                            key={i}
                            className="absolute left-0 top-0"
                            style={{
                              transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`,
                              transition: `transform ${Math.floor(120 / playbackSpeed)}ms linear`,
                              willChange: "transform",
                              filter: isWinner ? "drop-shadow(0 6px 10px rgba(0,0,0,0.25))" : undefined,
                            }}
                          >
                            <GiraffeAnimated
                              idPrefix={`lane-${i}`}
                              playbackRate={speedFactor}
                              resetNonce={svgResetNonce}
                              playing={isPlaying && raceStarted && frame < lastFrameIndex}
                              sizePx={giraffeSizePx}
                            />
                          </div>
                        );
                      })}
                    </div>
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
      </div>
    </div>
  );
};
