"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Balance, EtherInput } from "@scaffold-ui/components";
import { Hex, formatEther, isHex, parseEther, toHex } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
  useTransactor,
} from "~~/hooks/scaffold-eth";
import { simulateRaceFromSeed } from "~~/utils/race/simulateRace";

const LANE_COUNT = 6 as const;
// Keep in sync with `GiraffeRace.sol`
const SUBMISSION_CLOSE_OFFSET_BLOCKS = 10n;
const BETTING_CLOSE_OFFSET_BLOCKS = 20n;
const SPEED_RANGE = 10;
const TRACK_LENGTH = 1000;
const MAX_TICKS = 500;

type RaceStatus = "no_race" | "submissions_open" | "betting_open" | "betting_closed" | "settled";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Replay speed baseline multiplier:
// - "1x" should feel faster than real-time UI defaults
// - higher speeds scale proportionally (2x/3x still work the same, just faster)
const BASE_REPLAY_SPEED_MULTIPLIER = 1.5;

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
    contractName: "GiraffeNFT",
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
  const [submittedTokenId, setSubmittedTokenId] = useState<bigint | null>(null);
  const [betLane, setBetLane] = useState<number>(0);
  const [betAmountEth, setBetAmountEth] = useState("");
  const [fundAmountEth, setFundAmountEth] = useState("");
  const [isFundingRace, setIsFundingRace] = useState(false);
  const [ownedTokenNameById, setOwnedTokenNameById] = useState<Record<string, string>>({});
  const [isLoadingOwnedTokenNames, setIsLoadingOwnedTokenNames] = useState(false);

  // Replay controls
  const [isPlaying, setIsPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 3>(1);
  const [raceStarted, setRaceStarted] = useState(false);
  const [startDelayRemainingMs, setStartDelayRemainingMs] = useState(3000);
  const startDelayEndAtRef = useRef<number | null>(null);
  const startDelayTimeoutRef = useRef<number | null>(null);
  const [goPhase, setGoPhase] = useState<null | "solid" | "fade">(null);
  const goPhaseTimeoutRef = useRef<number | null>(null);
  const goHideTimeoutRef = useRef<number | null>(null);
  const prevRaceStartedRef = useRef(false);
  const [svgResetNonce, setSvgResetNonce] = useState(0);

  const { data: giraffeRaceContract, isLoading: isGiraffeRaceLoading } = useDeployedContractInfo({
    contractName: "GiraffeRace",
  });
  const { data: giraffeNftContract } = useDeployedContractInfo({ contractName: "GiraffeNFT" });

  const tx = useTransactor();

  const { data: ownedTokenIdsData, isLoading: isOwnedTokensLoading } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
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
      if (!giraffeNftContract?.address || !giraffeNftContract?.abi) return;
      if (ownedTokenIds.length === 0) {
        setOwnedTokenNameById({});
        return;
      }

      setIsLoadingOwnedTokenNames(true);
      try {
        const calls = ownedTokenIds.map(tokenId => ({
          address: giraffeNftContract.address as `0x${string}`,
          abi: giraffeNftContract.abi as any,
          functionName: "nameOf",
          args: [tokenId],
        }));

        let res:
          | { result?: string }[]
          | {
              status: "success" | "failure";
              result?: string;
            }[];

        try {
          res = (await publicClient.multicall({ contracts: calls as any, allowFailure: true })) as any;
        } catch {
          // Fallback: individual reads (more reliable across clients).
          const results = await Promise.allSettled(
            ownedTokenIds.map(tokenId =>
              (publicClient as any).readContract({
                address: giraffeNftContract.address as `0x${string}`,
                abi: giraffeNftContract.abi as any,
                functionName: "nameOf",
                args: [tokenId],
              }),
            ),
          );
          res = results.map(r =>
            r.status === "fulfilled" ? { status: "success", result: r.value } : { status: "failure" },
          );
        }

        const next: Record<string, string> = {};
        ownedTokenIds.forEach((tokenId, i) => {
          const row: any = res[i];
          const name =
            (row?.status === "success" ? (row?.result as string | undefined) : (row?.result as string | undefined)) ??
            "";
          next[tokenId.toString()] = String(name).trim();
        });
        setOwnedTokenNameById(next);
      } finally {
        setIsLoadingOwnedTokenNames(false);
      }
    };

    void run();
  }, [publicClient, giraffeNftContract?.address, giraffeNftContract?.abi, ownedTokenIds]);

  const { data: nextRaceIdData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "nextRaceId",
    query: { enabled: !!giraffeRaceContract },
  });
  const nextRaceId = (nextRaceIdData as bigint | undefined) ?? 0n;
  const hasAnyRace = !!giraffeRaceContract && nextRaceId > 0n;
  const latestRaceId = hasAnyRace ? nextRaceId - 1n : null;

  const { data: settledLiabilityData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "settledLiability",
    query: { enabled: !!giraffeRaceContract },
  });
  const settledLiability = useMemo(() => {
    try {
      return settledLiabilityData === undefined || settledLiabilityData === null
        ? null
        : BigInt(settledLiabilityData as any);
    } catch {
      return null;
    }
  }, [settledLiabilityData]);

  const [viewRaceId, setViewRaceId] = useState<bigint | null>(null);

  useEffect(() => {
    if (latestRaceId === null) return;
    setViewRaceId(prev => {
      if (prev === null) return latestRaceId;
      if (prev > latestRaceId) return latestRaceId;
      return prev;
    });
  }, [latestRaceId]);

  const viewingRaceId = viewRaceId ?? latestRaceId;
  // Treat "no race yet" (and the brief initial-load null state) as "viewing latest" so core actions
  // like "Create race" / "Submit NFT" aren't incorrectly disabled on a fresh chain.
  const isViewingLatest =
    !hasAnyRace || viewingRaceId === null || latestRaceId === null || viewingRaceId === latestRaceId;

  const { data: raceData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceById",
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
  });

  const { data: raceGiraffesData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceGiraffesById",
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
  });

  const { data: raceScoreData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    // Added in score snapshot upgrade; cast to avoid ABI typing mismatch until contracts are regenerated.
    functionName: "getRaceScoreById" as any,
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
  } as any);

  const { data: raceOddsData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceOddsById" as any,
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
  } as any);

  const parsed = useMemo(() => {
    if (!raceData) return null;
    const [closeBlock, settled, winner, seed, totalPot, totalOnLane] = raceData;
    return {
      closeBlock: closeBlock as bigint,
      settled: settled as boolean,
      winner: Number(winner as any),
      seed: seed as Hex,
      totalPot: totalPot as bigint,
      totalOnLane: (totalOnLane as readonly bigint[]).map(x => BigInt(x)),
    };
  }, [raceData]);

  const parsedGiraffes = useMemo(() => {
    if (!raceGiraffesData) return null;
    const [assignedCount, tokenIds, originalOwners] = raceGiraffesData;
    return {
      assignedCount: Number(assignedCount as any),
      tokenIds: (tokenIds as readonly bigint[]).map(x => BigInt(x)),
      originalOwners: originalOwners as readonly `0x${string}`[],
    };
  }, [raceGiraffesData]);

  const parsedOdds = useMemo(() => {
    if (!raceOddsData) return null;
    const [oddsSet, oddsBps] = raceOddsData as any;
    const arr = (Array.isArray(oddsBps) ? oddsBps : []) as any[];
    return {
      oddsSet: Boolean(oddsSet),
      oddsBps: Array.from({ length: LANE_COUNT }, (_, i) => BigInt(arr[i] ?? 0)) as bigint[],
    };
  }, [raceOddsData]);

  const laneScore = useMemo(() => {
    if (!raceScoreData) return Array.from({ length: LANE_COUNT }, () => 10);
    const raw = raceScoreData as any;
    const arr = (Array.isArray(raw) ? raw : []) as any[];
    const clamp = (n: number) => Math.max(1, Math.min(10, Math.floor(n)));
    return Array.from({ length: LANE_COUNT }, (_, i) => clamp(Number(arr[i] ?? 10)));
  }, [raceScoreData]);

  const laneTokenIds = useMemo(() => {
    if (!parsedGiraffes?.tokenIds) return Array.from({ length: LANE_COUNT }, () => 0n);
    const arr = parsedGiraffes.tokenIds ?? [];
    return Array.from({ length: LANE_COUNT }, (_, i) => BigInt(arr[i] ?? 0n));
  }, [parsedGiraffes?.tokenIds]);

  const { data: lane0StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[0]],
    query: { enabled: !!giraffeNftContract && laneTokenIds[0] !== 0n },
  } as any);
  const { data: lane1StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[1]],
    query: { enabled: !!giraffeNftContract && laneTokenIds[1] !== 0n },
  } as any);
  const { data: lane2StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[2]],
    query: { enabled: !!giraffeNftContract && laneTokenIds[2] !== 0n },
  } as any);
  const { data: lane3StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[3]],
    query: { enabled: !!giraffeNftContract && laneTokenIds[3] !== 0n },
  } as any);
  const { data: lane4StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[4] ?? 0n],
    query: { enabled: !!giraffeNftContract && (laneTokenIds[4] ?? 0n) !== 0n },
  } as any);
  const { data: lane5StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[5] ?? 0n],
    query: { enabled: !!giraffeNftContract && (laneTokenIds[5] ?? 0n) !== 0n },
  } as any);

  const laneStats = useMemo(() => {
    const clamp = (n: number) => Math.max(1, Math.min(10, Math.floor(n)));
    const parse = (raw: unknown) => {
      const t = (Array.isArray(raw) ? raw : []) as any[];
      return {
        readiness: clamp(Number(t[0] ?? 10)),
        conditioning: clamp(Number(t[1] ?? 10)),
        speed: clamp(Number(t[2] ?? 10)),
      };
    };
    return [
      parse(lane0StatsData),
      parse(lane1StatsData),
      parse(lane2StatsData),
      parse(lane3StatsData),
      parse(lane4StatsData),
      parse(lane5StatsData),
    ];
  }, [lane0StatsData, lane1StatsData, lane2StatsData, lane3StatsData, lane4StatsData, lane5StatsData]);

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
    if (!giraffeRaceContract) return "no_race";
    if (!hasAnyRace || !parsed) return "no_race";
    if (parsed.settled) return "settled";
    if (blockNumber === undefined) return "betting_closed";
    if (submissionCloseBlock !== null && blockNumber < submissionCloseBlock) return "submissions_open";
    if (blockNumber < parsed.closeBlock) return "betting_open";
    return "betting_closed";
  }, [giraffeRaceContract, hasAnyRace, parsed, blockNumber, submissionCloseBlock]);

  // Reset the local "submitted token" lock when we change race or wallet.
  useEffect(() => {
    setSubmittedTokenId(null);
  }, [connectedAddress, viewingRaceId]);

  const lineupFinalized = (parsedGiraffes?.assignedCount ?? 0) === Number(LANE_COUNT);
  const canFinalize = status === "betting_open" && !lineupFinalized;
  // Contract requires oddsSet (auto-derived at finalization), so avoid enabling bets until odds are loaded+set.
  const canBet = status === "betting_open" && lineupFinalized && parsedOdds?.oddsSet === true;
  const canSettle = !!parsed && !parsed.settled && blockNumber !== undefined && blockNumber > parsed.closeBlock;
  const canSubmit =
    status === "submissions_open" ||
    status === "no_race" || // will auto-create a race
    status === "settled"; // will auto-create the next race

  const showEnterNftCard = !lineupFinalized;
  const showPlaceBetCard = lineupFinalized || status === "settled";
  const isEnterLocked = submittedTokenId !== null && isViewingLatest;

  const oddsLabelForLane = (lane: number) => {
    if (!parsedOdds?.oddsSet) return "Odds —";
    const bps = Number(parsedOdds.oddsBps[lane] ?? 0n);
    if (!Number.isFinite(bps) || bps <= 0) return "Odds —";
    return `${(bps / 10_000).toFixed(2)}x`;
  };

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
    contractName: "GiraffeRace",
    functionName: "getBetById",
    args: [viewingRaceId ?? 0n, connectedAddress],
    query: { enabled: !!giraffeRaceContract && !!connectedAddress && hasAnyRace && viewingRaceId !== null },
  });

  const myBet = useMemo(() => {
    if (!myBetData) return null;
    const [amount, lane, claimed] = myBetData;
    const amt = BigInt(amount as any);
    return {
      amount: amt,
      lane: Number(lane as any),
      claimed: claimed as boolean,
      hasBet: amt !== 0n,
    };
  }, [myBetData]);

  const isBetLocked = !!myBet?.hasBet;
  const selectedBetLane = isBetLocked ? myBet?.lane : betLane;

  const estimatedPayoutWei = useMemo(() => {
    if (!parsedOdds?.oddsSet) return null;
    const lane = myBet?.hasBet ? myBet.lane : betLane;
    const amountWei = myBet?.hasBet ? myBet.amount : placeBetValue;
    if (!amountWei) return null;
    const oddsBps = parsedOdds.oddsBps?.[lane] ?? 0n;
    if (oddsBps <= 0n) return null;
    return (amountWei * oddsBps) / 10_000n;
  }, [parsedOdds?.oddsSet, parsedOdds?.oddsBps, placeBetValue, betLane, myBet?.hasBet, myBet?.lane, myBet?.amount]);

  // If the user has already bet, lock the lane highlight to their bet.
  useEffect(() => {
    if (!myBet?.hasBet) return;
    setBetLane(myBet.lane);
  }, [myBet?.hasBet, myBet?.lane]);

  const { data: nextWinningClaimData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getNextWinningClaim",
    args: [connectedAddress],
    query: { enabled: !!giraffeRaceContract && !!connectedAddress },
  });

  const { data: winningClaimRemainingData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getWinningClaimRemaining",
    args: [connectedAddress],
    query: { enabled: !!giraffeRaceContract && !!connectedAddress },
  });

  const winningClaimRemaining = useMemo(() => {
    if (winningClaimRemainingData === undefined || winningClaimRemainingData === null) return null;
    try {
      return BigInt(winningClaimRemainingData as any);
    } catch {
      return null;
    }
  }, [winningClaimRemainingData]);

  const nextWinningClaim = useMemo(() => {
    if (!nextWinningClaimData) return null;
    // `getNextWinningClaim` returns a struct (tuple)
    const out = nextWinningClaimData as any;
    return {
      hasClaim: Boolean(out?.hasClaim),
      raceId: BigInt(out?.raceId ?? 0),
      // Always 3 for a settled win; included for compatibility with the shared struct.
      status: Number(out?.status ?? 0),
      betLane: Number(out?.betLane ?? 0),
      betTokenId: BigInt(out?.betTokenId ?? 0),
      betAmount: BigInt(out?.betAmount ?? 0),
      winner: Number(out?.winner ?? 0),
      payout: BigInt(out?.payout ?? 0),
      closeBlock: BigInt(out?.closeBlock ?? 0),
    };
  }, [nextWinningClaimData]);

  const [jumpToNextWinningClaimAfterClaim, setJumpToNextWinningClaimAfterClaim] = useState(false);

  useEffect(() => {
    if (!jumpToNextWinningClaimAfterClaim) return;
    // After a successful claim, jump to the next winning claim race (if any).
    if (nextWinningClaim?.hasClaim) {
      setViewRaceId(nextWinningClaim.raceId);
    }
    setJumpToNextWinningClaimAfterClaim(false);
  }, [jumpToNextWinningClaimAfterClaim, nextWinningClaim?.hasClaim, nextWinningClaim?.raceId]);

  const { writeContractAsync: writeGiraffeRaceAsync } = useScaffoldWriteContract({ contractName: "GiraffeRace" });

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
      laneCount: LANE_COUNT,
      maxTicks: MAX_TICKS,
      speedRange: SPEED_RANGE,
      trackLength: TRACK_LENGTH,
      score: laneScore,
    });
  }, [parsed, canSimulate, laneScore]);

  const frames = useMemo(() => simulation?.frames ?? [], [simulation]);
  const lastFrameIndex = Math.max(0, frames.length - 1);

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

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

  // While the start-delay is active, tick remaining ms so the UI can show 3..2..1 smoothly.
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

  // "GO!" overlay: show for 1s, then fade out over 250ms, then hide.
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

    // If the race is reset/stopped, hide GO.
    if (!raceStarted) {
      clearGoTimers();
      setGoPhase(null);
      return;
    }

    // Only trigger for the initial start (end of the 3s hold), not for manual tick scrubbing.
    if (!prev && raceStarted && frameRef.current === 0) {
      clearGoTimers();
      setGoPhase("solid");
      goPhaseTimeoutRef.current = window.setTimeout(() => setGoPhase("fade"), 500);
      goHideTimeoutRef.current = window.setTimeout(() => setGoPhase(null), 750);
    }
  }, [raceStarted, simulation]);

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

    const effectivePlaybackSpeed = playbackSpeed * BASE_REPLAY_SPEED_MULTIPLIER;
    const id = window.setInterval(
      () => setFrame(prev => (prev >= lastFrameIndex ? lastFrameIndex : prev + 1)),
      Math.floor(120 / effectivePlaybackSpeed),
    );
    return () => window.clearInterval(id);
  }, [isPlaying, simulation, raceStarted, lastFrameIndex, playbackSpeed]);

  const currentDistances = useMemo(() => frames[frame] ?? Array.from({ length: LANE_COUNT }, () => 0), [frames, frame]);
  const prevDistances = useMemo(
    () => frames[Math.max(0, frame - 1)] ?? Array.from({ length: LANE_COUNT }, () => 0),
    [frames, frame],
  );

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
  const raceIsOver = !!simulation && frame >= lastFrameIndex;
  const revealOutcome = raceIsOver;
  const revealedWinner = revealOutcome ? verifiedWinner : null;

  // ---- Track + camera geometry (restored camera-follow viewport) ----
  const laneHeightPx = 86;
  const laneGapPx = 10;
  const worldPaddingLeftPx = 80;
  const worldPaddingRightPx = 140;
  const pxPerUnit = 3;
  const giraffeSizePx = 78;
  const trackLengthPx = TRACK_LENGTH * pxPerUnit;
  const finishLineX = worldPaddingLeftPx + trackLengthPx;
  const worldWidthPx = worldPaddingLeftPx + trackLengthPx + worldPaddingRightPx;
  const trackHeightPx = LANE_COUNT * (laneHeightPx + laneGapPx) - laneGapPx;

  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const viewportRefCb = useMemo(() => (el: HTMLDivElement | null) => setViewportEl(el), []);
  const [viewportWidthPx, setViewportWidthPx] = useState(0);

  const [cameraScrollEl, setCameraScrollEl] = useState<HTMLDivElement | null>(null);
  const cameraScrollRefCb = useMemo(() => (el: HTMLDivElement | null) => setCameraScrollEl(el), []);

  const [cameraX, setCameraX] = useState(0);
  const cameraTargetXRef = useRef(0);
  const cameraSmoothRafRef = useRef<number | null>(null);
  const cameraSmoothLastTsRef = useRef<number | null>(null);
  const playbackSpeedRef = useRef(playbackSpeed);
  const cameraSpringXRef = useRef<number | null>(null);
  const cameraSpringVRef = useRef(0);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

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

  // Compute cameraX from the simulation state and viewport size.
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
    const maxRunnerX = worldPaddingLeftPx + (maxDist / TRACK_LENGTH) * trackLengthPx;

    // Use the average position of all runners as the camera focal point.
    const avgDist = distances.length ? distances.reduce((sum, d) => sum + d, 0) / distances.length : 0;
    const focalX = worldPaddingLeftPx + (avgDist / TRACK_LENGTH) * trackLengthPx;

    // Keep the leader fully visible (account for sprite width), not just the leader point.
    const spriteHalf = giraffeSizePx / 2;
    const spritePad = 12;
    const minLeaderScreenX = spriteHalf + spritePad;
    const maxLeaderScreenX = Math.max(minLeaderScreenX, viewportWorldWidth - (spriteHalf + spritePad));

    // Start: no camera movement; Mid-race: follow; Finish approach: freeze once finish is visible.
    const followStartThresholdScreenX = viewportWorldWidth * 0.5;
    const followStartX = Math.max(minLeaderScreenX, followStartThresholdScreenX);

    const targetFocalScreenX = viewportWorldWidth * 0.5;
    const desiredFocalScreenX = Math.min(maxLeaderScreenX, Math.max(minLeaderScreenX, targetFocalScreenX));

    const maxCameraX = Math.max(0, worldWidthPx - viewportWorldWidth);

    const finishInset = 150;
    const freezeX = Math.min(maxCameraX, Math.max(0, finishLineX - (viewportWorldWidth - finishInset)));

    const followFocalX = Math.min(maxCameraX, Math.max(0, focalX - desiredFocalScreenX));
    const keepMaxVisibleX = Math.min(maxCameraX, Math.max(0, maxRunnerX - maxLeaderScreenX));
    const followX = Math.max(followFocalX, keepMaxVisibleX);

    const nextCameraX = maxRunnerX < followStartX ? 0 : Math.min(followX, freezeX);
    setCameraX(nextCameraX);
  }, [
    simulation,
    currentDistances,
    viewportWidthPx,
    worldWidthPx,
    worldPaddingLeftPx,
    trackLengthPx,
    finishLineX,
    giraffeSizePx,
  ]);

  useEffect(() => {
    cameraTargetXRef.current = Math.max(0, cameraX);
  }, [cameraX]);

  // Drive camera via scrollLeft with spring smoothing (Unity-style SmoothDamp).
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

  const activeRaceExists = status !== "no_race" && !parsed?.settled;

  return (
    <div className="flex flex-col w-full">
      {/* Mine controls: stay at top of page content (non-sticky) */}
      <div className="bg-base-100/80 backdrop-blur border-b border-base-200">
        <div className="w-full max-w-none px-[30px] py-3">
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

      <div className="flex flex-col gap-8 w-full max-w-none px-[30px] py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold">Giraffe Race</h1>
          <p className="text-base-content/70">
            Single on-demand flow: create race (or submit), wait for submissions to close, finalize lineup, bet, settle,
            replay, claim.
          </p>
        </div>

        {/* Replay is the hero element */}
        <div className="card bg-base-200 shadow w-full">
          <div className="card-body gap-4 px-0">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Race replay</h2>
              <div className="flex items-center gap-2">
                <div className="hidden md:flex items-center gap-2">
                  <span className="text-xs opacity-70">Viewing</span>
                  <span className="text-xs font-mono">{viewingRaceId?.toString() ?? "-"}</span>
                  <span className="text-xs opacity-70">/ Latest</span>
                  <span className="text-xs font-mono">{latestRaceId?.toString() ?? "-"}</span>
                </div>
                <div className="join">
                  <button
                    className="btn btn-sm join-item"
                    disabled={!hasAnyRace || viewingRaceId === null || viewingRaceId === 0n}
                    onClick={() => setViewRaceId(id => (id === null ? id : id > 0n ? id - 1n : 0n))}
                  >
                    Prev
                  </button>
                  <button
                    className="btn btn-sm join-item"
                    disabled={
                      !hasAnyRace || viewingRaceId === null || latestRaceId === null || viewingRaceId >= latestRaceId
                    }
                    onClick={() => setViewRaceId(id => (id === null ? id : id + 1n))}
                  >
                    Next
                  </button>
                  <button
                    className="btn btn-sm join-item"
                    disabled={!hasAnyRace || latestRaceId === null || viewingRaceId === latestRaceId}
                    onClick={() => setViewRaceId(latestRaceId)}
                  >
                    Latest
                  </button>
                </div>
                {/* Claim UX is handled in the Claim panel; keep replay controls focused on replay */}
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

            <div className="flex flex-col gap-3">
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
              ) : null}

              {simulation ? (
                <div className="flex justify-between text-sm opacity-70">
                  <span>
                    Tick: <span className="font-semibold opacity-100">{frame}</span> / {lastFrameIndex}
                  </span>
                </div>
              ) : null}

              <div
                ref={viewportRefCb}
                className="relative w-full rounded-2xl bg-base-100 border border-base-300 overflow-hidden"
                style={{ height: `${trackHeightPx}px` }}
              >
                {/* Center countdown overlay */}
                {simulation ? (
                  <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                    {goPhase ? (
                      <div
                        className={`text-6xl font-black text-primary drop-shadow transition-opacity duration-[250ms] ${
                          goPhase === "solid" ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        GO!
                      </div>
                    ) : isPlaying && !raceStarted && frame === 0 ? (
                      <div className="text-6xl font-black text-primary drop-shadow">
                        {Math.max(1, Math.ceil(startDelayRemainingMs / 1000))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Fixed lane labels */}
                <div className="absolute left-3 top-3 bottom-3 z-10 flex flex-col justify-between pointer-events-none">
                  {Array.from({ length: LANE_COUNT }).map((_, i) => {
                    const d = Number(currentDistances[i] ?? 0);
                    const isWinner = revealedWinner === i;
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
                          {parsedGiraffes ? (
                            <LaneName tokenId={parsedGiraffes.tokenIds[i] ?? 0n} fallback={`Lane ${i}`} />
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Camera viewport */}
                <div className="absolute inset-0">
                  <div ref={cameraScrollRefCb} className="absolute inset-0 overflow-hidden">
                    <div className="relative" style={{ width: `${worldWidthPx}px`, height: `${trackHeightPx}px` }}>
                      {/* Track background */}
                      <div className="absolute inset-0">
                        <div
                          className="absolute top-0 bottom-0 w-[3px] bg-base-300"
                          style={{ left: `${worldPaddingLeftPx}px` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-[3px] bg-base-300"
                          style={{ left: `${worldPaddingLeftPx + trackLengthPx}px` }}
                        />
                        {/* Distance markers: thin vertical lines every 100 units */}
                        {Array.from({ length: Math.floor(TRACK_LENGTH / 100) - 1 }).map((_, idx) => {
                          const dist = (idx + 1) * 100; // 100..900
                          const x = worldPaddingLeftPx + (dist / TRACK_LENGTH) * trackLengthPx;
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
                            background:
                              "repeating-linear-gradient(90deg, transparent, transparent 29px, rgba(0,0,0,0.10) 30px)",
                          }}
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

                      {/* Giraffes (only once simulation is available) */}
                      {simulation
                        ? Array.from({ length: LANE_COUNT }).map((_, i) => {
                            const d = Number(currentDistances[i] ?? 0);
                            const prev = Number(prevDistances[i] ?? 0);
                            const delta = Math.max(0, d - prev);
                            const isWinner = revealedWinner === i;
                            const isUserBetLane = !!myBet?.hasBet && myBet.lane === i;

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
                              (Math.min(TRACK_LENGTH, Math.max(0, d)) / TRACK_LENGTH) * trackLengthPx;
                            const y = i * (laneHeightPx + laneGapPx) + laneHeightPx / 2;

                            return (
                              <div
                                key={i}
                                className="absolute left-0 top-0"
                                style={{
                                  transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`,
                                  transition: `transform ${Math.floor(120 / (playbackSpeed * BASE_REPLAY_SPEED_MULTIPLIER))}ms linear`,
                                  willChange: "transform",
                                  filter: isWinner ? "drop-shadow(0 6px 10px rgba(0,0,0,0.25))" : undefined,
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
                                    playing={isPlaying && raceStarted && frame < lastFrameIndex}
                                    sizePx={giraffeSizePx}
                                  />
                                </div>
                              </div>
                            );
                          })
                        : null}
                    </div>
                  </div>
                </div>
              </div>

              {parsed?.settled ? (
                <details className="collapse collapse-arrow bg-base-100">
                  <summary className="collapse-title text-sm font-medium">Seed (bytes32)</summary>
                  <div className="collapse-content">
                    <code className="text-xs break-all">{parsed.seed}</code>
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card bg-base-200 shadow lg:col-span-1">
            <div className="card-body gap-3">
              <div className="flex items-center justify-between">
                <h2 className="card-title">Race status</h2>
                <div className="text-xs opacity-70">
                  {isGiraffeRaceLoading
                    ? "Checking contract…"
                    : giraffeRaceContract
                      ? "GiraffeRace deployed"
                      : "Not deployed"}
                </div>
              </div>

              {!giraffeRaceContract ? (
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
                    <span className="opacity-70">Viewing Race ID</span>
                    <span className="font-mono">{viewingRaceId?.toString() ?? "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-70">Latest Race ID</span>
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
                {!isViewingLatest ? (
                  <div className="text-xs opacity-70">
                    You’re viewing a past race. Switch to <span className="font-semibold">Latest</span> to manage the
                    active race.
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={!giraffeRaceContract || activeRaceExists || !isViewingLatest}
                    onClick={async () => {
                      await writeGiraffeRaceAsync({ functionName: "createRace" } as any);
                    }}
                  >
                    Create race
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    disabled={!giraffeRaceContract || !canFinalize || !isViewingLatest}
                    onClick={async () => {
                      await writeGiraffeRaceAsync({ functionName: "finalizeRaceGiraffes" } as any);
                    }}
                  >
                    Finalize lineup
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    disabled={!giraffeRaceContract || !canSettle || !isViewingLatest}
                    onClick={async () => {
                      await writeGiraffeRaceAsync({ functionName: "settleRace" } as any);
                    }}
                  >
                    Settle race
                  </button>
                </div>
                <div className="text-xs opacity-70">
                  Anyone can create/finalize/settle. Odds are auto-quoted on-chain at lineup finalization based on the
                  locked effective score snapshot (avg of readiness/conditioning/speed).
                </div>
              </div>

              <div className="divider my-1" />

              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium">Fund bankroll</div>
                {!giraffeRaceContract ? (
                  <div className="text-xs opacity-70">Deploy the contracts first to get the GiraffeRace address.</div>
                ) : (
                  <>
                    <div className="text-xs">
                      <div className="flex justify-between">
                        <span className="opacity-70">GiraffeRace balance</span>
                        <span className="font-mono">
                          <Balance address={giraffeRaceContract.address as `0x${string}`} />
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-70">Unpaid liability</span>
                        <span className="font-mono">
                          {settledLiability === null ? "-" : `${formatEther(settledLiability)} ETH`}
                        </span>
                      </div>
                    </div>
                    <EtherInput
                      placeholder="Amount to send (ETH)"
                      onValueChange={({ valueInEth }) => setFundAmountEth(valueInEth)}
                      style={{ width: "100%" }}
                    />
                    <button
                      className="btn btn-sm btn-outline"
                      disabled={
                        !connectedAddress || !giraffeRaceContract?.address || isFundingRace || !fundAmountEth.trim()
                      }
                      onClick={async () => {
                        if (!giraffeRaceContract?.address) return;
                        const v = fundAmountEth.trim();
                        if (!v) return;
                        let value: bigint;
                        try {
                          value = parseEther(v as `${number}`);
                        } catch {
                          return;
                        }
                        if (value <= 0n) return;
                        try {
                          setIsFundingRace(true);
                          await tx({ to: giraffeRaceContract.address as `0x${string}`, value });
                        } finally {
                          setIsFundingRace(false);
                        }
                      }}
                    >
                      {isFundingRace ? <span className="loading loading-spinner loading-xs" /> : null}
                      <span>{isFundingRace ? "Funding…" : "Send ETH to GiraffeRace"}</span>
                    </button>
                    <div className="text-xs opacity-70">
                      This is just a plain ETH transfer to the contract (used to cover fixed-odds payouts).
                    </div>
                  </>
                )}
              </div>

              <div className="divider my-1" />

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Claim payout</div>
                  {connectedAddress && winningClaimRemaining !== null && winningClaimRemaining > 0n ? (
                    <div className="badge badge-outline">
                      {winningClaimRemaining.toString()}
                      <span className="ml-1 opacity-70">pending</span>
                    </div>
                  ) : null}
                </div>
                {!connectedAddress ? (
                  <div className="text-xs opacity-70">Connect wallet to see your next claim.</div>
                ) : !nextWinningClaim ? (
                  <div className="text-xs opacity-70">Loading claim status…</div>
                ) : !nextWinningClaim.hasClaim ? (
                  <div className="text-xs opacity-70">No claimable payouts.</div>
                ) : (
                  <div className="text-xs">
                    <div className="flex justify-between">
                      <span className="opacity-70">Next payout race</span>
                      <span className="font-mono">{nextWinningClaim.raceId.toString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-70">Your bet</span>
                      <span className="font-semibold text-right">
                        <GiraffeAnimated
                          idPrefix={`claim-${nextWinningClaim.raceId.toString()}-${nextWinningClaim.betLane}-${nextWinningClaim.betTokenId.toString()}`}
                          tokenId={nextWinningClaim.betTokenId}
                          playbackRate={1}
                          playing={true}
                          sizePx={48}
                          className="inline-block align-middle"
                        />{" "}
                        {nextWinningClaim.betTokenId !== 0n ? (
                          <LaneName
                            tokenId={nextWinningClaim.betTokenId}
                            fallback={`Lane ${nextWinningClaim.betLane}`}
                          />
                        ) : (
                          `Lane ${nextWinningClaim.betLane}`
                        )}{" "}
                        · {formatEther(nextWinningClaim.betAmount)} ETH
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-70">Outcome</span>
                      <span className="font-semibold">Won</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-70">Estimated payout</span>
                      <span className="font-mono">{formatEther(nextWinningClaim.payout)} ETH</span>
                    </div>
                  </div>
                )}
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!giraffeRaceContract || !connectedAddress || !nextWinningClaim?.hasClaim}
                  onClick={async () => {
                    await writeGiraffeRaceAsync({ functionName: "claimNextWinningPayout" } as any);
                    setJumpToNextWinningClaimAfterClaim(true);
                  }}
                >
                  Claim payout
                </button>
                <div className="text-xs opacity-70">Claim is enabled only when you have a payout to claim.</div>
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

              <div className="grid grid-cols-1 gap-4">
                {showEnterNftCard ? (
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
                          <div className="text-sm opacity-70">You don’t own any GiraffeNFTs yet.</div>
                        ) : (
                          <select
                            className="select select-bordered w-full"
                            value={selectedTokenId?.toString() ?? ""}
                            disabled={isEnterLocked}
                            onChange={e => {
                              if (isEnterLocked) return;
                              setSelectedTokenId(e.target.value ? BigInt(e.target.value) : null);
                            }}
                          >
                            <option value="" disabled>
                              Select an NFT…
                            </option>
                            {ownedTokenIds.map(tokenId => (
                              <option key={tokenId.toString()} value={tokenId.toString()}>
                                {(ownedTokenNameById[tokenId.toString()] || "").trim()
                                  ? ownedTokenNameById[tokenId.toString()]
                                  : isLoadingOwnedTokenNames
                                    ? "Loading…"
                                    : "Unnamed"}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>

                      <button
                        className="btn btn-primary"
                        disabled={
                          !giraffeRaceContract ||
                          !connectedAddress ||
                          selectedTokenId === null ||
                          isEnterLocked ||
                          !canSubmit ||
                          !isViewingLatest
                        }
                        onClick={async () => {
                          if (selectedTokenId === null) return;
                          await writeGiraffeRaceAsync({
                            functionName: "submitGiraffe",
                            args: [selectedTokenId],
                          } as any);
                          setSubmittedTokenId(selectedTokenId);
                        }}
                      >
                        Submit NFT
                      </button>

                      {isEnterLocked ? (
                        <div className="text-xs opacity-70">
                          Submitted{" "}
                          <span className="font-semibold">
                            <GiraffeAnimated
                              idPrefix={`submitted-${(viewingRaceId ?? 0n).toString()}-${(submittedTokenId ?? 0n).toString()}`}
                              tokenId={submittedTokenId ?? 0n}
                              playbackRate={1}
                              playing={true}
                              sizePx={40}
                              className="inline-block align-middle"
                            />{" "}
                            {(ownedTokenNameById[submittedTokenId?.toString() ?? ""] || "").trim()
                              ? ownedTokenNameById[submittedTokenId?.toString() ?? ""]
                              : `Token #${submittedTokenId?.toString()}`}
                          </span>
                          . You can’t change entries after submitting.
                        </div>
                      ) : null}

                      {!canSubmit ? (
                        <div className="text-xs opacity-70">
                          Submissions are only available during the submissions window.
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showPlaceBetCard ? (
                  <div className="card bg-base-100 border border-base-300">
                    <div className="card-body gap-3">
                      <h3 className="font-semibold">Place a bet</h3>
                      <p className="text-sm opacity-70">
                        Betting opens after submissions close and the lineup is finalized.
                      </p>

                      <>
                        {/*
                          Always render the bet UI. When betting isn't open (or the user already placed a bet),
                          it naturally appears in a disabled/locked state instead of switching to a separate
                          "you didn't bet" message block.
                        */}
                        <div className="flex flex-col gap-2 w-full">
                          {Array.from({ length: LANE_COUNT }).map((_, lane) => (
                            <button
                              key={lane}
                              className={`btn w-full justify-between h-auto py-3 min-h-[4.5rem] ${
                                selectedBetLane === lane ? "btn-primary" : "btn-outline"
                              } ${
                                isBetLocked && selectedBetLane === lane
                                  ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100 disabled:opacity-100"
                                  : ""
                              }`}
                              onClick={() => setBetLane(lane)}
                              disabled={!canBet || isBetLocked}
                              type="button"
                            >
                              <span className="flex items-center gap-2">
                                <GiraffeAnimated
                                  idPrefix={`bet-${(viewingRaceId ?? 0n).toString()}-${lane}-${(laneTokenIds[lane] ?? 0n).toString()}`}
                                  tokenId={laneTokenIds[lane] ?? 0n}
                                  playbackRate={1}
                                  playing={false}
                                  sizePx={56}
                                />
                                {lineupFinalized &&
                                parsedGiraffes?.tokenIds?.[lane] &&
                                parsedGiraffes.tokenIds[lane] !== 0n ? (
                                  <LaneName tokenId={parsedGiraffes.tokenIds[lane]} fallback={`Lane ${lane}`} />
                                ) : (
                                  <span>Lane {lane}</span>
                                )}
                              </span>
                              <span className="flex flex-col items-end text-xs opacity-80">
                                <span>Readiness {laneStats[lane]?.readiness ?? 10}/10</span>
                                <span>Conditioning {laneStats[lane]?.conditioning ?? 10}/10</span>
                                <span>Speed {laneStats[lane]?.speed ?? 10}/10</span>
                                {lineupFinalized ? (
                                  <span className="font-mono opacity-90">{oddsLabelForLane(lane)}</span>
                                ) : null}
                              </span>
                            </button>
                          ))}
                        </div>

                        {lineupFinalized ? (
                          <div className="text-xs opacity-70">
                            {"Odds are fixed and enforced on-chain (derived from the locked effective score snapshot)."}
                          </div>
                        ) : null}

                        {isBetLocked ? (
                          <EtherInput
                            placeholder="Bet amount (ETH)"
                            defaultValue={myBet?.amount ? formatEther(myBet.amount) : ""}
                            disabled
                            style={{ width: "100%" }}
                          />
                        ) : (
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
                        )}

                        <div className="text-sm">
                          <div className="flex justify-between">
                            <span className="opacity-70">Estimated payout</span>
                            <span className="font-mono">
                              {estimatedPayoutWei === null ? "—" : `${formatEther(estimatedPayoutWei)} ETH`}
                            </span>
                          </div>
                          <div className="text-xs opacity-60">
                            Includes your stake. Fixed odds are locked at bet time.
                          </div>
                        </div>

                        <button
                          className="btn btn-primary"
                          disabled={
                            !giraffeRaceContract ||
                            !connectedAddress ||
                            !canBet ||
                            !placeBetValue ||
                            !!myBet?.hasBet ||
                            !isViewingLatest
                          }
                          onClick={async () => {
                            if (!placeBetValue) return;
                            await writeGiraffeRaceAsync({
                              functionName: "placeBet",
                              args: [BigInt(Math.max(0, Math.min(Number(LANE_COUNT - 1), Math.floor(betLane))))],
                              value: placeBetValue,
                            } as any);
                            setBetAmountEth("");
                          }}
                        >
                          Place bet
                        </button>
                      </>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
