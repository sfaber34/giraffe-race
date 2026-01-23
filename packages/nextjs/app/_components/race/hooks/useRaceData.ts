"use client";

import { useEffect, useMemo, useState } from "react";
import { LANE_COUNT, SUBMISSION_WINDOW_BLOCKS } from "../constants";
import {
  CooldownStatus,
  LaneStats,
  MyBet,
  NextWinningClaim,
  ParsedGiraffes,
  ParsedOdds,
  ParsedRace,
  ParsedSchedule,
  RaceStatus,
} from "../types";
import { clampStat, parseStats } from "../utils";
import { Hex } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldEventHistory,
  useScaffoldReadContract,
  useTargetNetwork,
  useUsdcContract,
} from "~~/hooks/scaffold-eth";

export const useRaceData = () => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { address: connectedAddress } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const [ownedTokenNameById, setOwnedTokenNameById] = useState<Record<string, string>>({});
  const [isLoadingOwnedTokenNames, setIsLoadingOwnedTokenNames] = useState(false);

  // Contract info
  const { data: giraffeRaceContract, isLoading: isGiraffeRaceLoading } = useDeployedContractInfo({
    contractName: "GiraffeRace",
  });
  const { data: giraffeNftContract } = useDeployedContractInfo({ contractName: "GiraffeNFT" });
  const { data: usdcContract, contractName: usdcContractName } = useUsdcContract();
  const { data: treasuryContract } = useDeployedContractInfo({ contractName: "HouseTreasury" as any });

  // Owned tokens
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

  // Fetch names for owned tokens
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

        let res: { result?: string }[] | { status: "success" | "failure"; result?: string }[];

        try {
          res = (await publicClient.multicall({ contracts: calls as any, allowFailure: true })) as any;
        } catch {
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

  // Race IDs
  const { data: nextRaceIdData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "nextRaceId",
    query: { enabled: !!giraffeRaceContract },
  });
  const nextRaceId = (nextRaceIdData as bigint | undefined) ?? 0n;
  const hasAnyRace = !!giraffeRaceContract && nextRaceId > 0n;
  const latestRaceId = hasAnyRace ? nextRaceId - 1n : null;

  // Cooldown status
  const { data: cooldownData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getCreateRaceCooldown" as any,
    query: { enabled: !!giraffeRaceContract },
  } as any);

  const cooldownStatus = useMemo<CooldownStatus | null>(() => {
    if (!cooldownData) return null;
    const [canCreate, blocksRemaining, cooldownEndsAtBlock] = cooldownData as unknown as [boolean, bigint, bigint];
    return { canCreate, blocksRemaining, cooldownEndsAtBlock };
  }, [cooldownData]);

  // Settled liability
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

  // Max bet amount
  const { data: maxBetAmountData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "maxBetAmount" as any,
    query: { enabled: !!giraffeRaceContract },
  } as any);

  const maxBetAmount = useMemo(() => {
    try {
      return maxBetAmountData === undefined || maxBetAmountData === null ? null : BigInt(maxBetAmountData as any);
    } catch {
      return null;
    }
  }, [maxBetAmountData]);

  // USDC balances - use the dynamic contract name (USDC for Base, MockUSDC for local)
  const { data: userUsdcBalance } = useScaffoldReadContract({
    contractName: usdcContractName as any,
    functionName: "balanceOf" as any,
    args: [connectedAddress],
    query: { enabled: !!usdcContract && !!usdcContractName && !!connectedAddress },
  } as any);

  const { data: userUsdcAllowance } = useScaffoldReadContract({
    contractName: usdcContractName as any,
    functionName: "allowance" as any,
    args: [connectedAddress, treasuryContract?.address],
    query: { enabled: !!usdcContract && !!usdcContractName && !!treasuryContract && !!connectedAddress },
  } as any);

  const { data: treasuryBalance } = useScaffoldReadContract({
    contractName: "HouseTreasury" as any,
    functionName: "balance" as any,
    query: { enabled: !!treasuryContract },
  } as any);

  return {
    // Network & account
    targetNetwork,
    publicClient,
    connectedAddress: connectedAddress as `0x${string}` | undefined,
    blockNumber,

    // Contracts
    giraffeRaceContract,
    giraffeNftContract,
    usdcContract,
    usdcContractName,
    treasuryContract,
    isGiraffeRaceLoading,

    // Owned tokens
    ownedTokenIds,
    ownedTokenNameById,
    isOwnedTokensLoading,
    isLoadingOwnedTokenNames,

    // Race IDs
    nextRaceId,
    hasAnyRace,
    latestRaceId,

    // Treasury & betting limits
    cooldownStatus,
    settledLiability,
    maxBetAmount,
    userUsdcBalance: userUsdcBalance as unknown as bigint | undefined,
    userUsdcAllowance: userUsdcAllowance as unknown as bigint | undefined,
    treasuryBalance: treasuryBalance as unknown as bigint | undefined,
  };
};

export const useViewingRace = (latestRaceId: bigint | null, hasAnyRace: boolean) => {
  const [, setViewRaceId] = useState<bigint | null>(null);
  const [delayedViewingRaceId, setDelayedViewingRaceId] = useState<bigint | null>(null);
  const raceTransitionTimeoutRef = useState<{ current: number | null }>({ current: null })[0];
  const prevLatestRaceIdRef = useState<{ current: bigint | null }>({ current: null })[0];

  useEffect(() => {
    if (latestRaceId === null) return;
    setViewRaceId(prev => {
      if (prev === null) return latestRaceId;
      if (prev > latestRaceId) return latestRaceId;
      return prev;
    });
  }, [latestRaceId]);

  useEffect(() => {
    // Initialize on first load
    if (delayedViewingRaceId === null && latestRaceId !== null) {
      setDelayedViewingRaceId(latestRaceId);
      prevLatestRaceIdRef.current = latestRaceId;
      return;
    }

    // Detect when a new race is created (latestRaceId increases)
    const prevLatest = prevLatestRaceIdRef.current;
    prevLatestRaceIdRef.current = latestRaceId;

    if (latestRaceId === null) return;
    if (prevLatest === null) {
      setDelayedViewingRaceId(latestRaceId);
      return;
    }
    if (latestRaceId <= prevLatest) return;

    // New race detected! Keep showing previous race for 5 seconds.
    if (raceTransitionTimeoutRef.current) {
      window.clearTimeout(raceTransitionTimeoutRef.current);
    }

    raceTransitionTimeoutRef.current = window.setTimeout(() => {
      raceTransitionTimeoutRef.current = null;
      setDelayedViewingRaceId(latestRaceId);
    }, 5000);

    return () => {
      if (raceTransitionTimeoutRef.current) {
        window.clearTimeout(raceTransitionTimeoutRef.current);
        raceTransitionTimeoutRef.current = null;
      }
    };
  }, [latestRaceId, delayedViewingRaceId, prevLatestRaceIdRef, raceTransitionTimeoutRef]);

  const viewingRaceId = delayedViewingRaceId ?? latestRaceId;
  const isViewingLatest =
    !hasAnyRace || viewingRaceId === null || latestRaceId === null || viewingRaceId === latestRaceId;

  return { viewingRaceId, isViewingLatest, setViewRaceId };
};

export const useRaceDetails = (
  viewingRaceId: bigint | null,
  hasAnyRace: boolean,
  giraffeRaceContract: any,
  giraffeNftContract: any,
) => {
  // Race data
  const { data: raceData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceById",
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
  });

  const { data: raceScheduleData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceScheduleById" as any,
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
  } as any);

  const { data: raceGiraffesData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceGiraffesById",
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
  });

  const { data: raceScoreData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
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

  // Entry pool events
  const { data: submittedEvents } = useScaffoldEventHistory({
    contractName: "GiraffeRace",
    eventName: "GiraffeSubmitted",
    filters: viewingRaceId !== null ? ({ raceId: viewingRaceId } as any) : undefined,
    watch: true,
    enabled: hasAnyRace && viewingRaceId !== null,
  });

  // Parse race data
  const parsed = useMemo<ParsedRace | null>(() => {
    if (!raceData) return null;
    const [bettingCloseBlock, settled, winner, seed, totalPot, totalOnLane] = raceData;
    return {
      bettingCloseBlock: bettingCloseBlock as bigint,
      settled: settled as boolean,
      winner: Number(winner as any),
      seed: seed as Hex,
      totalPot: totalPot as bigint,
      totalOnLane: (totalOnLane as readonly bigint[]).map(x => BigInt(x)),
    };
  }, [raceData]);

  const parsedSchedule = useMemo<ParsedSchedule | null>(() => {
    if (!raceScheduleData) return null;
    const [bettingCloseBlock, submissionCloseBlock, settledAtBlock] = raceScheduleData as unknown as [
      bigint,
      bigint,
      bigint,
    ];
    return { bettingCloseBlock, submissionCloseBlock, settledAtBlock };
  }, [raceScheduleData]);

  const parsedGiraffes = useMemo<ParsedGiraffes | null>(() => {
    if (!raceGiraffesData) return null;
    const [assignedCount, tokenIds, originalOwners] = raceGiraffesData;
    return {
      assignedCount: Number(assignedCount as any),
      tokenIds: (tokenIds as readonly bigint[]).map(x => BigInt(x)),
      originalOwners: originalOwners as readonly `0x${string}`[],
    };
  }, [raceGiraffesData]);

  const parsedOdds = useMemo<ParsedOdds | null>(() => {
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
    return Array.from({ length: LANE_COUNT }, (_, i) => clampStat(Number(arr[i] ?? 10)));
  }, [raceScoreData]);

  const laneTokenIds = useMemo(() => {
    if (!parsedGiraffes?.tokenIds) return Array.from({ length: LANE_COUNT }, () => 0n);
    const arr = parsedGiraffes.tokenIds ?? [];
    return Array.from({ length: LANE_COUNT }, (_, i) => BigInt(arr[i] ?? 0n));
  }, [parsedGiraffes?.tokenIds]);

  // Entry pool
  const [entryPoolRaceId, setEntryPoolRaceId] = useState<bigint | null>(null);

  useEffect(() => {
    setEntryPoolRaceId(viewingRaceId);
  }, [viewingRaceId]);

  const entryPoolTokenIds = useMemo(() => {
    if (entryPoolRaceId !== viewingRaceId) return [];
    const evs = (submittedEvents as any[] | undefined) ?? [];
    const out: bigint[] = [];
    const seen = new Set<string>();
    for (const e of evs) {
      const eventRaceId = BigInt((e as any)?.args?.raceId ?? 0);
      if (viewingRaceId !== null && eventRaceId !== viewingRaceId) continue;
      const tokenId = BigInt((e as any)?.args?.tokenId ?? 0);
      if (tokenId === 0n) continue;
      const k = tokenId.toString();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(tokenId);
    }
    return out;
  }, [submittedEvents, viewingRaceId, entryPoolRaceId]);

  const selectedLineupTokenIdSet = useMemo(() => {
    const set = new Set<string>();
    const ids = parsedGiraffes?.tokenIds ?? [];
    for (const id of ids) {
      const tokenId = BigInt(id ?? 0);
      if (tokenId === 0n) continue;
      set.add(tokenId.toString());
    }
    return set;
  }, [parsedGiraffes?.tokenIds]);

  // Submission/betting blocks
  const submissionCloseBlock = parsedSchedule?.submissionCloseBlock ?? null;

  const bettingCloseBlock = useMemo(() => {
    const fromSchedule = parsedSchedule?.bettingCloseBlock;
    const fromRace = parsed?.bettingCloseBlock;
    const value = fromSchedule ?? fromRace ?? null;
    return value && value > 0n ? value : null;
  }, [parsedSchedule, parsed]);

  const startBlock = useMemo(() => {
    if (!submissionCloseBlock) return null;
    if (submissionCloseBlock < SUBMISSION_WINDOW_BLOCKS) return null;
    return submissionCloseBlock - SUBMISSION_WINDOW_BLOCKS;
  }, [submissionCloseBlock]);

  // Lane stats (individual reads)
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

  const laneStats = useMemo<LaneStats[]>(() => {
    return [
      parseStats(lane0StatsData),
      parseStats(lane1StatsData),
      parseStats(lane2StatsData),
      parseStats(lane3StatsData),
      parseStats(lane4StatsData),
      parseStats(lane5StatsData),
    ];
  }, [lane0StatsData, lane1StatsData, lane2StatsData, lane3StatsData, lane4StatsData, lane5StatsData]);

  const lineupFinalized = (parsedGiraffes?.assignedCount ?? 0) === Number(LANE_COUNT);

  return {
    parsed,
    parsedSchedule,
    parsedGiraffes,
    parsedOdds,
    laneScore,
    laneTokenIds,
    laneStats,
    entryPoolTokenIds,
    selectedLineupTokenIdSet,
    submissionCloseBlock,
    bettingCloseBlock,
    startBlock,
    lineupFinalized,
    entryPoolRaceId,
  };
};

export const useRaceStatus = (
  giraffeRaceContract: any,
  hasAnyRace: boolean,
  parsed: ParsedRace | null,
  cooldownStatus: CooldownStatus | null,
  blockNumber: bigint | undefined,
  submissionCloseBlock: bigint | null,
  bettingCloseBlock: bigint | null,
): RaceStatus => {
  return useMemo(() => {
    if (!giraffeRaceContract) return "no_race";
    if (!hasAnyRace || !parsed) return "no_race";

    if (parsed.settled) {
      if (cooldownStatus && !cooldownStatus.canCreate && cooldownStatus.blocksRemaining > 0n) {
        return "cooldown";
      }
      return "settled";
    }

    if (blockNumber === undefined) return "betting_closed";

    if (submissionCloseBlock !== null && blockNumber < submissionCloseBlock) {
      return "submissions_open";
    }

    if (!bettingCloseBlock) {
      return "awaiting_finalization";
    }

    if (blockNumber < bettingCloseBlock) {
      return "betting_open";
    }

    return "betting_closed";
  }, [giraffeRaceContract, hasAnyRace, parsed, blockNumber, submissionCloseBlock, bettingCloseBlock, cooldownStatus]);
};

export const useMyBet = (
  viewingRaceId: bigint | null,
  connectedAddress: `0x${string}` | undefined,
  giraffeRaceContract: any,
  hasAnyRace: boolean,
) => {
  const { data: myBetData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getBetById",
    args: [viewingRaceId ?? 0n, connectedAddress],
    query: { enabled: !!giraffeRaceContract && !!connectedAddress && hasAnyRace && viewingRaceId !== null },
  });

  return useMemo<MyBet | null>(() => {
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
};

export const useWinningClaims = (connectedAddress: `0x${string}` | undefined, giraffeRaceContract: any) => {
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

  const nextWinningClaim = useMemo<NextWinningClaim | null>(() => {
    if (!nextWinningClaimData) return null;
    const out = nextWinningClaimData as any;
    return {
      hasClaim: Boolean(out?.hasClaim),
      raceId: BigInt(out?.raceId ?? 0),
      status: Number(out?.status ?? 0),
      betLane: Number(out?.betLane ?? 0),
      betTokenId: BigInt(out?.betTokenId ?? 0),
      betAmount: BigInt(out?.betAmount ?? 0),
      winner: Number(out?.winner ?? 0),
      payout: BigInt(out?.payout ?? 0),
      bettingCloseBlock: BigInt(out?.bettingCloseBlock ?? 0),
    };
  }, [nextWinningClaimData]);

  return { nextWinningClaim, winningClaimRemaining };
};
