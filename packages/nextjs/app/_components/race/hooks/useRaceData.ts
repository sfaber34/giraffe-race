"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANE_COUNT } from "../constants";
import {
  CooldownStatus,
  LaneStats,
  MyBet,
  NextWinningClaim,
  ParsedGiraffes,
  ParsedOdds,
  ParsedRace,
  ParsedSchedule,
  QueueEntry,
  RaceStatus,
} from "../types";
import { clampStat, parseStats } from "../utils";
import { Hex } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useTargetNetwork,
  useUsdcContract,
} from "~~/hooks/scaffold-eth";

export const useRaceData = () => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { address: connectedAddress } = useAccount();
  // Block number is fetched once here; live watching is done conditionally in RaceDashboard
  const { data: blockNumber } = useBlockNumber({ watch: false });

  const [ownedTokenNameById, setOwnedTokenNameById] = useState<Record<string, string>>({});
  const [isLoadingOwnedTokenNames, setIsLoadingOwnedTokenNames] = useState(false);

  // Contract info
  const { data: giraffeRaceContract, isLoading: isGiraffeRaceLoading } = useDeployedContractInfo({
    contractName: "GiraffeRace",
  });
  const { data: giraffeNftContract } = useDeployedContractInfo({ contractName: "GiraffeNFT" });
  const { data: usdcContract, contractName: usdcContractName } = useUsdcContract();
  const { data: treasuryContract } = useDeployedContractInfo({ contractName: "HouseTreasury" as any });

  // Owned tokens - watch to detect new NFTs (mints, transfers)
  const { data: ownedTokenIdsData, isLoading: isOwnedTokensLoading } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "tokensOfOwner",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress },
    // Watch by default to detect new NFTs
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

  // Race IDs - watch to detect new races being created
  const { data: nextRaceIdData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "nextRaceId",
    query: { enabled: !!giraffeRaceContract },
    // Watch by default to detect new race creation
  });
  const nextRaceId = (nextRaceIdData as bigint | undefined) ?? 0n;
  const hasAnyRace = !!giraffeRaceContract && nextRaceId > 0n;
  const latestRaceId = hasAnyRace ? nextRaceId - 1n : null;

  // Cooldown status - watch to detect when cooldown ends
  const { data: cooldownData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getCreateRaceCooldown" as any,
    query: { enabled: !!giraffeRaceContract },
    // Watch by default for cooldown status updates
  } as any);

  const cooldownStatus = useMemo<CooldownStatus | null>(() => {
    if (!cooldownData) return null;
    const [canCreate, blocksRemaining, cooldownEndsAtBlock] = cooldownData as unknown as [boolean, bigint, bigint];
    return { canCreate, blocksRemaining, cooldownEndsAtBlock };
  }, [cooldownData]);

  // Settled liability - doesn't need block-by-block updates
  const { data: settledLiabilityData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "settledLiability",
    query: { enabled: !!giraffeRaceContract },
    watch: false,
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

  // Max bet amount - config value, never changes
  const { data: maxBetAmountData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "maxBetAmount" as any,
    query: { enabled: !!giraffeRaceContract },
    watch: false,
  } as any);

  const maxBetAmount = useMemo(() => {
    try {
      return maxBetAmountData === undefined || maxBetAmountData === null ? null : BigInt(maxBetAmountData as any);
    } catch {
      return null;
    }
  }, [maxBetAmountData]);

  // USDC balances - watch to reflect transactions
  const { data: userUsdcBalance } = useScaffoldReadContract({
    contractName: usdcContractName as any,
    functionName: "balanceOf" as any,
    args: [connectedAddress],
    query: { enabled: !!usdcContract && !!usdcContractName && !!connectedAddress },
    // Watch by default to reflect balance changes
  } as any);

  const { data: userUsdcAllowance } = useScaffoldReadContract({
    contractName: usdcContractName as any,
    functionName: "allowance" as any,
    args: [connectedAddress, treasuryContract?.address],
    query: { enabled: !!usdcContract && !!usdcContractName && !!treasuryContract && !!connectedAddress },
    // Watch by default to reflect allowance changes
  } as any);

  const { data: treasuryBalance } = useScaffoldReadContract({
    contractName: "HouseTreasury" as any,
    functionName: "balance" as any,
    query: { enabled: !!treasuryContract },
    watch: false,
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
  // Track if we've seen this race as settled (to stop watching once settled)
  const [hasSeenSettled, setHasSeenSettled] = useState(false);
  const prevRaceIdRef = useRef<bigint | null>(null);

  // Reset when race changes
  useEffect(() => {
    if (viewingRaceId !== prevRaceIdRef.current) {
      setHasSeenSettled(false);
      prevRaceIdRef.current = viewingRaceId;
    }
  }, [viewingRaceId]);

  // Race data - watch until settled to detect settlement, then stop watching
  const { data: raceData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceById",
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
    watch: !hasSeenSettled, // Stop watching once settled for smooth animation
  });

  const { data: raceScheduleData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceScheduleById" as any,
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
    watch: !hasSeenSettled, // Watch until settled for schedule updates
  } as any);

  const { data: raceGiraffesData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceGiraffesById",
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
    watch: !hasSeenSettled, // Watch until settled to detect lineup finalization
  });

  const { data: raceScoreData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceScoreById" as any,
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
    watch: !hasSeenSettled, // Watch until settled for score updates
  } as any);

  const { data: raceOddsData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getRaceOddsById" as any,
    args: [viewingRaceId ?? 0n],
    query: { enabled: hasAnyRace && viewingRaceId !== null },
    watch: !hasSeenSettled, // Watch until settled to detect odds being set
  } as any);

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

  // Once we see the race is settled, stop watching (for smooth animation)
  useEffect(() => {
    if (parsed?.settled && !hasSeenSettled) {
      setHasSeenSettled(true);
    }
  }, [parsed?.settled, hasSeenSettled]);

  const parsedSchedule = useMemo<ParsedSchedule | null>(() => {
    if (!raceScheduleData) return null;
    // New contract returns only [bettingCloseBlock, settledAtBlock]
    const [bettingCloseBlock, settledAtBlock] = raceScheduleData as unknown as [bigint, bigint];
    return { bettingCloseBlock, settledAtBlock };
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

  const bettingCloseBlock = useMemo(() => {
    const fromSchedule = parsedSchedule?.bettingCloseBlock;
    const fromRace = parsed?.bettingCloseBlock;
    const value = fromSchedule ?? fromRace ?? null;
    return value && value > 0n ? value : null;
  }, [parsedSchedule, parsed]);

  // Lane stats (individual reads) - static, no need to watch
  const { data: lane0StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[0]],
    query: { enabled: !!giraffeNftContract && laneTokenIds[0] !== 0n },
    watch: false,
  } as any);
  const { data: lane1StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[1]],
    query: { enabled: !!giraffeNftContract && laneTokenIds[1] !== 0n },
    watch: false,
  } as any);
  const { data: lane2StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[2]],
    query: { enabled: !!giraffeNftContract && laneTokenIds[2] !== 0n },
    watch: false,
  } as any);
  const { data: lane3StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[3]],
    query: { enabled: !!giraffeNftContract && laneTokenIds[3] !== 0n },
    watch: false,
  } as any);
  const { data: lane4StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[4] ?? 0n],
    query: { enabled: !!giraffeNftContract && (laneTokenIds[4] ?? 0n) !== 0n },
    watch: false,
  } as any);
  const { data: lane5StatsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "statsOf" as any,
    args: [laneTokenIds[5] ?? 0n],
    query: { enabled: !!giraffeNftContract && (laneTokenIds[5] ?? 0n) !== 0n },
    watch: false,
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

  // Lineup is always finalized immediately when race is created (no separate step)
  const lineupFinalized = (parsedGiraffes?.assignedCount ?? 0) === Number(LANE_COUNT);

  return {
    parsed,
    parsedSchedule,
    parsedGiraffes,
    parsedOdds,
    laneScore,
    laneTokenIds,
    laneStats,
    bettingCloseBlock,
    lineupFinalized,
  };
};

export const useRaceStatus = (
  giraffeRaceContract: any,
  hasAnyRace: boolean,
  parsed: ParsedRace | null,
  cooldownStatus: CooldownStatus | null,
  blockNumber: bigint | undefined,
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

    // With the new queue system, races go directly to betting_open when created
    if (!bettingCloseBlock) {
      // Race exists but no betting close block yet - shouldn't happen with new system
      return "betting_closed";
    }

    if (blockNumber < bettingCloseBlock) {
      return "betting_open";
    }

    return "betting_closed";
  }, [giraffeRaceContract, hasAnyRace, parsed, blockNumber, bettingCloseBlock, cooldownStatus]);
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
    // Watch to detect bet confirmation
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
    // Watch to detect new claimable winnings after settlement
  });

  const { data: winningClaimRemainingData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getWinningClaimRemaining",
    args: [connectedAddress],
    query: { enabled: !!giraffeRaceContract && !!connectedAddress },
    // Watch to detect claim updates
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

// Hook for the persistent race queue
export const useRaceQueue = (giraffeRaceContract: any, connectedAddress: `0x${string}` | undefined) => {
  // Active queue length
  const { data: activeQueueLengthData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getActiveQueueLength" as any,
    query: { enabled: !!giraffeRaceContract },
  } as any);

  // User's queue status
  const { data: userInQueueData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "isUserInQueue" as any,
    args: [connectedAddress],
    query: { enabled: !!giraffeRaceContract && !!connectedAddress },
  } as any);

  // User's queued token
  const { data: userQueuedTokenData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getUserQueuedToken" as any,
    args: [connectedAddress],
    query: { enabled: !!giraffeRaceContract && !!connectedAddress },
  } as any);

  // User's queue position
  const { data: userQueuePositionData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getUserQueuePosition" as any,
    args: [connectedAddress],
    query: { enabled: !!giraffeRaceContract && !!connectedAddress },
  } as any);

  // Queue entries (first 20)
  const { data: queueEntriesData } = useScaffoldReadContract({
    contractName: "GiraffeRace",
    functionName: "getQueueEntries" as any,
    args: [0n, 20n],
    query: { enabled: !!giraffeRaceContract },
  } as any);

  const activeQueueLength = useMemo(() => {
    if (activeQueueLengthData === undefined) return 0;
    try {
      return Number(BigInt(activeQueueLengthData as any));
    } catch {
      return 0;
    }
  }, [activeQueueLengthData]);

  const userInQueue = useMemo(() => {
    return Boolean(userInQueueData);
  }, [userInQueueData]);

  const userQueuedToken = useMemo(() => {
    if (!userQueuedTokenData) return null;
    try {
      const val = BigInt(userQueuedTokenData as any);
      return val === 0n ? null : val;
    } catch {
      return null;
    }
  }, [userQueuedTokenData]);

  const userQueuePosition = useMemo(() => {
    if (!userQueuePositionData) return null;
    try {
      const val = Number(BigInt(userQueuePositionData as any));
      return val === 0 ? null : val;
    } catch {
      return null;
    }
  }, [userQueuePositionData]);

  const queueEntries = useMemo<QueueEntry[]>(() => {
    if (!queueEntriesData) return [];
    const entries = queueEntriesData as unknown as any[];
    if (!Array.isArray(entries)) return [];
    return entries
      .map((e: any) => ({
        index: BigInt(e?.index ?? 0),
        tokenId: BigInt(e?.tokenId ?? 0),
        owner: (e?.owner ?? "0x0") as `0x${string}`,
        isValid: Boolean(e?.isValid),
      }))
      .filter(e => e.isValid);
  }, [queueEntriesData]);

  return {
    activeQueueLength,
    userInQueue,
    userQueuedToken,
    userQueuePosition,
    queueEntries,
  };
};
