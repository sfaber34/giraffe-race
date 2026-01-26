"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EnterNftCard, EntryPoolCard, PlaceBetCard, RaceOverlay, RaceStatusCard, RaceTrack } from "./race/components";
import { LANE_COUNT, TRACK_HEIGHT_PX, USDC_DECIMALS } from "./race/constants";
import {
  useMyBet,
  useRaceCamera,
  useRaceData,
  useRaceDetails,
  useRaceReplay,
  useRaceStatus,
  useViewingRace,
  useWinningClaims,
} from "./race/hooks";
import { ClaimSnapshot, PlaybackSpeed } from "./race/types";
import { parseUnits, toHex } from "viem";
import { useBlockNumber } from "wagmi";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

export const RaceDashboard = () => {
  // Core data hooks
  const raceData = useRaceData();
  const {
    publicClient,
    connectedAddress,
    blockNumber,
    giraffeRaceContract,
    giraffeNftContract,
    usdcContract,
    usdcContractName,
    treasuryContract,
    isGiraffeRaceLoading,
    ownedTokenIds,
    ownedTokenNameById,
    isOwnedTokensLoading,
    isLoadingOwnedTokenNames,
    hasAnyRace,
    latestRaceId,
    cooldownStatus,
    settledLiability,
    maxBetAmount,
    userUsdcBalance,
    userUsdcAllowance,
    treasuryBalance,
  } = raceData;

  // Viewing state
  const { viewingRaceId, isViewingLatest, setViewRaceId } = useViewingRace(latestRaceId, hasAnyRace);

  // Race details
  const raceDetails = useRaceDetails(viewingRaceId, hasAnyRace, giraffeRaceContract, giraffeNftContract);
  const {
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
  } = raceDetails;

  // My bet
  const myBet = useMyBet(viewingRaceId, connectedAddress, giraffeRaceContract, hasAnyRace);

  // Winning claims
  const { nextWinningClaim, winningClaimRemaining } = useWinningClaims(connectedAddress, giraffeRaceContract);

  // Replay hook
  const replay = useRaceReplay({
    seed: parsed?.seed,
    settled: parsed?.settled ?? false,
    laneScore,
  });

  // Conditional block watching: pause ONLY during active race playback (not when finished)
  const isRaceAnimating = replay.isPlaying && replay.raceStarted && !!replay.simulation && !replay.raceIsOver;
  const { data: liveBlockNumber } = useBlockNumber({
    watch: !isRaceAnimating, // Watch when race is NOT animating (including when finished)
  });
  // Use live block number when available, fall back to initial from useRaceData
  const activeBlockNumber = liveBlockNumber ?? blockNumber;

  // Race status (uses activeBlockNumber for accurate status during race)
  const status = useRaceStatus(
    giraffeRaceContract,
    hasAnyRace,
    parsed,
    cooldownStatus,
    activeBlockNumber,
    submissionCloseBlock,
    bettingCloseBlock,
  );

  // Camera hook
  const camera = useRaceCamera({
    simulation: replay.simulation,
    currentDistances: replay.currentDistances,
    playbackSpeed: replay.playbackSpeed,
  });

  // Local UI state
  const [isMining, setIsMining] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<bigint | null>(null);
  const [submittedTokenId, setSubmittedTokenId] = useState<bigint | null>(null);
  const [betLane, setBetLane] = useState<number | null>(null);
  const [betAmountUsdc, setBetAmountUsdc] = useState("");
  const [fundAmountUsdc, setFundAmountUsdc] = useState("");
  const [isFundingRace, setIsFundingRace] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // Finalize reveal state
  const [isFinalizeRevealActive, setIsFinalizeRevealActive] = useState(false);
  const [canShowBetCard, setCanShowBetCard] = useState(false);
  const finalizeRevealTimeoutRef = useRef<number | null>(null);

  // Claim snapshot state
  const [claimSnapshot, setClaimSnapshot] = useState<ClaimSnapshot | null>(null);
  const [syncClaimSnapshotAfterUserAction, setSyncClaimSnapshotAfterUserAction] = useState(false);
  const [jumpToNextWinningClaimAfterClaim, setJumpToNextWinningClaimAfterClaim] = useState(false);

  // Write hooks
  const { writeContractAsync: writeGiraffeRaceAsync } = useScaffoldWriteContract({ contractName: "GiraffeRace" });
  // Use dynamic USDC contract name (USDC for Base, MockUSDC for local)
  const { writeContractAsync: writeUsdcAsync } = useScaffoldWriteContract({
    contractName: usdcContractName as any,
  });

  // Reset state on race/wallet change
  useEffect(() => {
    setSubmittedTokenId(null);
  }, [connectedAddress, viewingRaceId]);

  useEffect(() => {
    setBetLane(null);
  }, [connectedAddress, viewingRaceId]);

  // Finalize reveal effect
  useEffect(() => {
    if (finalizeRevealTimeoutRef.current) window.clearTimeout(finalizeRevealTimeoutRef.current);
    finalizeRevealTimeoutRef.current = null;
    setIsFinalizeRevealActive(false);
    setCanShowBetCard(false);
  }, [viewingRaceId]);

  useEffect(() => {
    if (status === "settled" || status === "betting_closed") {
      setIsFinalizeRevealActive(false);
      setCanShowBetCard(true);
      return;
    }
    if (!lineupFinalized && status === "submissions_open") {
      setIsFinalizeRevealActive(false);
      setCanShowBetCard(false);
      return;
    }
    if (!lineupFinalized) return;

    if (finalizeRevealTimeoutRef.current) window.clearTimeout(finalizeRevealTimeoutRef.current);
    setIsFinalizeRevealActive(true);
    setCanShowBetCard(false);
    finalizeRevealTimeoutRef.current = window.setTimeout(() => {
      setIsFinalizeRevealActive(false);
      setCanShowBetCard(true);
    }, 3000);
    return () => {
      if (finalizeRevealTimeoutRef.current) window.clearTimeout(finalizeRevealTimeoutRef.current);
      finalizeRevealTimeoutRef.current = null;
    };
  }, [lineupFinalized, status]);

  // Lock bet lane to user's bet
  useEffect(() => {
    if (!myBet?.hasBet) return;
    setBetLane(myBet.lane);
  }, [myBet?.hasBet, myBet?.lane]);

  // Jump to next winning claim after claim
  useEffect(() => {
    if (!jumpToNextWinningClaimAfterClaim) return;
    if (nextWinningClaim?.hasClaim) {
      setViewRaceId(nextWinningClaim.raceId);
    }
    setJumpToNextWinningClaimAfterClaim(false);
  }, [jumpToNextWinningClaimAfterClaim, nextWinningClaim?.hasClaim, nextWinningClaim?.raceId, setViewRaceId]);

  // Claim snapshot effect
  const claimUiUnlocked = !replay.simulation || replay.raceIsOver;
  useEffect(() => {
    if (!connectedAddress) {
      setClaimSnapshot(null);
      setSyncClaimSnapshotAfterUserAction(false);
      return;
    }
    if (!claimUiUnlocked && !syncClaimSnapshotAfterUserAction) return;
    if (!nextWinningClaim || winningClaimRemaining === null) return;

    setClaimSnapshot({ nextWinningClaim, winningClaimRemaining });
    if (syncClaimSnapshotAfterUserAction) setSyncClaimSnapshotAfterUserAction(false);
  }, [connectedAddress, claimUiUnlocked, syncClaimSnapshotAfterUserAction, nextWinningClaim, winningClaimRemaining]);

  // Derived state
  const canFinalize = (status === "awaiting_finalization" || status === "betting_open") && !lineupFinalized;
  const canBet = status === "betting_open" && lineupFinalized && parsedOdds?.oddsSet === true;
  const canSettle =
    !!parsed &&
    !parsed.settled &&
    bettingCloseBlock !== null &&
    activeBlockNumber !== undefined &&
    activeBlockNumber > bettingCloseBlock;
  const canSubmit = status === "submissions_open" || status === "no_race" || status === "settled";
  const isBetLocked = !!myBet?.hasBet;
  const selectedBetLane = isBetLocked ? myBet?.lane : betLane;
  const isEnterLocked = submittedTokenId !== null && isViewingLatest;
  const activeRaceExists = status !== "no_race" && status !== "cooldown" && status !== "settled" && !parsed?.settled;
  const isInCooldown =
    status === "cooldown" || (cooldownStatus && !cooldownStatus.canCreate && cooldownStatus.blocksRemaining > 0n);

  // Show/hide cards
  const showEnterNftCard =
    (!lineupFinalized || isFinalizeRevealActive) && status !== "betting_closed" && status !== "settled";
  const isEntryPoolReady = entryPoolRaceId === viewingRaceId;
  const showEntryPoolCard =
    isEntryPoolReady &&
    (status === "submissions_open" || (status === "betting_open" && !lineupFinalized) || isFinalizeRevealActive) &&
    !canShowBetCard &&
    status !== "betting_closed" &&
    status !== "settled" &&
    status !== "no_race";
  const showPlaceBetCard = status === "settled" || status === "betting_closed" || (lineupFinalized && canShowBetCard);

  // Bet calculations
  const placeBetValue = useMemo(() => {
    const v = betAmountUsdc.trim();
    if (!v) return null;
    try {
      const usdcAmount = parseUnits(v as `${number}`, USDC_DECIMALS);
      if (usdcAmount <= 0n) return null;
      return usdcAmount;
    } catch {
      return null;
    }
  }, [betAmountUsdc]);

  const needsApproval = useMemo(() => {
    if (!placeBetValue) return true;
    if (userUsdcAllowance === undefined || userUsdcAllowance === null) return true;
    return userUsdcAllowance < placeBetValue;
  }, [placeBetValue, userUsdcAllowance]);

  const hasEnoughUsdc = useMemo(() => {
    if (!placeBetValue) return false;
    if (userUsdcBalance === undefined || userUsdcBalance === null) return true;
    return userUsdcBalance >= placeBetValue;
  }, [placeBetValue, userUsdcBalance]);

  const exceedsMaxBet = useMemo(() => {
    if (!placeBetValue) return false;
    if (maxBetAmount === null) return false;
    return placeBetValue > maxBetAmount;
  }, [placeBetValue, maxBetAmount]);

  const estimatedPayoutWei = useMemo(() => {
    if (!parsedOdds?.oddsSet) return null;
    const lane = myBet?.hasBet ? myBet.lane : betLane;
    if (lane === null || lane === undefined) return null;
    const amountWei = myBet?.hasBet ? myBet.amount : placeBetValue;
    if (!amountWei) return null;
    const oddsBps = parsedOdds.oddsBps?.[lane] ?? 0n;
    if (oddsBps <= 0n) return null;
    return (amountWei * oddsBps) / 10_000n;
  }, [parsedOdds?.oddsSet, parsedOdds?.oddsBps, placeBetValue, betLane, myBet?.hasBet, myBet?.lane, myBet?.amount]);

  // Revealed state
  const verifiedWinner = parsed?.settled ? parsed.winner : null;
  const revealedWinner = replay.raceIsOver ? verifiedWinner : null;
  const hasRevealedClaimSnapshot = claimSnapshot !== null;
  const displayedNextWinningClaim = claimUiUnlocked ? nextWinningClaim : (claimSnapshot?.nextWinningClaim ?? null);
  const displayedWinningClaimRemaining = claimUiUnlocked
    ? winningClaimRemaining
    : (claimSnapshot?.winningClaimRemaining ?? null);

  // Actions
  const mineBlocks = useCallback(
    async (count: number) => {
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
    },
    [publicClient],
  );

  const handleCreateRace = useCallback(async () => {
    await writeGiraffeRaceAsync({ functionName: "createRace" } as any);
  }, [writeGiraffeRaceAsync]);

  const handleFinalizeLineup = useCallback(async () => {
    await writeGiraffeRaceAsync({ functionName: "finalizeRaceGiraffes" } as any);
  }, [writeGiraffeRaceAsync]);

  const handleSettleRace = useCallback(async () => {
    const txHash = await writeGiraffeRaceAsync({ functionName: "settleRace" } as any);
    console.log("🏁 settleRace TX Hash:", txHash);

    if (publicClient && txHash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("⛽ TOTAL Gas Used:", receipt.gasUsed.toString());

      // GasCheckpoint event topic: keccak256("GasCheckpoint(string,uint256)")
      const gasCheckpointTopic = "0x7fd61c220461f2c47e0b5052f6e584193320f4d0cd137c3e9602fe44e5e48e17";

      console.log("\n========== GAS BREAKDOWN ==========");

      receipt.logs.forEach(log => {
        if (log.topics[0] === gasCheckpointTopic) {
          // Decode GasCheckpoint(string label, uint256 gasUsed)
          // Data layout: offset(32) + gasUsed(32) + stringLength(32) + stringData
          const data = log.data.slice(2); // remove 0x
          const gasUsed = BigInt("0x" + data.slice(64, 128));
          const stringLength = parseInt(data.slice(128, 192), 16);
          const labelHex = data.slice(192, 192 + stringLength * 2);
          const label = Buffer.from(labelHex, "hex").toString("utf8");

          console.log(`⛽ ${label.padEnd(20)}: ${gasUsed.toLocaleString()} gas`);
        }
      });

      // Find SimulationGasProfile from simulator (any address that's NOT the diamond)
      const diamondAddress = giraffeRaceContract?.address?.toLowerCase();
      const simulatorLog = receipt.logs.find(log => log.address.toLowerCase() !== diamondAddress);

      if (simulatorLog) {
        const data = simulatorLog.data.slice(2);
        const totalTicks = BigInt("0x" + data.slice(0, 64));
        const setupGas = BigInt("0x" + data.slice(64, 128));
        const mainLoopGas = BigInt("0x" + data.slice(128, 192));
        const winnerCalcGas = BigInt("0x" + data.slice(192, 256));
        const hashCount = BigInt("0x" + data.slice(256, 320));

        console.log("\n========== SIMULATION DETAILS ==========");
        console.log(`🎲 Total Ticks:        ${totalTicks}`);
        console.log(`🔑 Hashes (1/tick):    ${hashCount}`);
        console.log(`⛽ Setup:              ${setupGas.toLocaleString()} gas`);
        console.log(`⛽ Main Loop:          ${mainLoopGas.toLocaleString()} gas`);
        console.log(`⛽ Winner Calc:        ${winnerCalcGas.toLocaleString()} gas`);
      }

      console.log("=====================================\n");
    }
  }, [writeGiraffeRaceAsync, publicClient, giraffeRaceContract?.address]);

  const handleSubmitNft = useCallback(async () => {
    if (selectedTokenId === null) return;
    await writeGiraffeRaceAsync({
      functionName: "submitGiraffe",
      args: [selectedTokenId],
    } as any);
    setSubmittedTokenId(selectedTokenId);
  }, [selectedTokenId, writeGiraffeRaceAsync]);

  const handleFundTreasury = useCallback(async () => {
    if (!treasuryContract?.address) return;
    const v = fundAmountUsdc.trim();
    if (!v) return;
    let amount: bigint;
    try {
      amount = parseUnits(v as `${number}`, USDC_DECIMALS);
    } catch {
      return;
    }
    if (amount <= 0n) return;
    try {
      setIsFundingRace(true);
      await (writeUsdcAsync as any)({
        functionName: "transfer",
        args: [treasuryContract.address, amount],
      });
      setFundAmountUsdc("");
    } finally {
      setIsFundingRace(false);
    }
  }, [treasuryContract?.address, fundAmountUsdc, writeUsdcAsync]);

  const handleApprove = useCallback(async () => {
    if (!placeBetValue || !treasuryContract?.address) return;
    setIsApproving(true);
    try {
      await (writeUsdcAsync as any)({
        functionName: "approve",
        args: [treasuryContract.address, placeBetValue],
      });
    } finally {
      setIsApproving(false);
    }
  }, [placeBetValue, treasuryContract?.address, writeUsdcAsync]);

  const handlePlaceBet = useCallback(async () => {
    if (!placeBetValue) return;
    if (betLane === null) return;
    await writeGiraffeRaceAsync({
      functionName: "placeBet",
      args: [BigInt(Math.max(0, Math.min(Number(LANE_COUNT - 1), Math.floor(betLane)))), placeBetValue],
    } as any);
    setBetAmountUsdc("");
  }, [placeBetValue, betLane, writeGiraffeRaceAsync]);

  const handleClaimPayout = useCallback(async () => {
    await writeGiraffeRaceAsync({ functionName: "claimNextWinningPayout" } as any);
    setSyncClaimSnapshotAfterUserAction(true);
    setJumpToNextWinningClaimAfterClaim(true);
  }, [writeGiraffeRaceAsync]);

  return (
    <div className="flex flex-col w-full">
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
                <div className="join">
                  {([1, 2, 3] as PlaybackSpeed[]).map(speed => (
                    <button
                      key={speed}
                      className={`btn btn-sm join-item ${replay.playbackSpeed === speed ? "btn-active" : ""}`}
                      onClick={() => replay.setPlaybackSpeed(speed)}
                      disabled={!replay.simulation}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
                <button className="btn btn-sm" onClick={replay.reset} disabled={!replay.simulation}>
                  Reset
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => replay.stepBy(-1)}
                  disabled={!replay.simulation || replay.frame === 0}
                >
                  ◀︎ Tick
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => replay.stepBy(1)}
                  disabled={!replay.simulation || replay.frame >= replay.lastFrameIndex}
                >
                  Tick ▶︎
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => replay.setIsPlaying(p => !p)}
                  disabled={!replay.simulation}
                >
                  {replay.isPlaying ? "Pause" : "Play"}
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
                  <span className="text-sm">
                    Race isn&apos;t settled yet, so the seed is unknown. Settle it to replay.
                  </span>
                </div>
              ) : !replay.simulation ? (
                <div className="alert alert-warning">
                  <span className="text-sm">Missing/invalid seed. Try settling the race again.</span>
                </div>
              ) : null}

              {replay.simulation ? (
                <div className="flex justify-between text-sm opacity-70">
                  <span>
                    Tick: <span className="font-semibold opacity-100">{replay.frame}</span> / {replay.lastFrameIndex}
                  </span>
                </div>
              ) : null}

              <div
                ref={camera.viewportRefCb}
                className="relative w-full rounded-2xl bg-base-100 border border-base-300 overflow-hidden"
                style={{ height: `${TRACK_HEIGHT_PX}px` }}
              >
                {/* Center overlay */}
                <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                  <RaceOverlay
                    status={status}
                    simulation={replay.simulation}
                    raceIsOver={replay.raceIsOver}
                    isPlaying={replay.isPlaying}
                    raceStarted={replay.raceStarted}
                    frame={replay.frame}
                    startDelayRemainingMs={replay.startDelayRemainingMs}
                    goPhase={replay.goPhase}
                    viewingRaceId={viewingRaceId}
                    parsed={parsed}
                    parsedSchedule={parsedSchedule}
                    cooldownStatus={cooldownStatus}
                    laneTokenIds={laneTokenIds}
                    myBet={myBet}
                    estimatedPayoutWei={estimatedPayoutWei}
                    blockNumber={activeBlockNumber}
                    submissionCloseBlock={submissionCloseBlock}
                    bettingCloseBlock={bettingCloseBlock}
                    startBlock={startBlock}
                    submittedTokenId={submittedTokenId}
                    ownedTokenNameById={ownedTokenNameById}
                    onCreateRace={handleCreateRace}
                  />
                </div>

                <RaceTrack
                  cameraScrollRefCb={camera.cameraScrollRefCb}
                  simulation={replay.simulation}
                  lineupFinalized={lineupFinalized}
                  parsedGiraffes={parsedGiraffes}
                  currentDistances={replay.currentDistances}
                  prevDistances={replay.prevDistances}
                  isPlaying={replay.isPlaying}
                  raceStarted={replay.raceStarted}
                  frame={replay.frame}
                  lastFrameIndex={replay.lastFrameIndex}
                  playbackSpeed={replay.playbackSpeed}
                  svgResetNonce={replay.svgResetNonce}
                  revealedWinner={revealedWinner}
                  myBet={myBet}
                />
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
          <RaceStatusCard
            isGiraffeRaceLoading={isGiraffeRaceLoading}
            giraffeRaceContract={giraffeRaceContract}
            treasuryContract={treasuryContract}
            usdcContract={usdcContract}
            status={status}
            viewingRaceId={viewingRaceId}
            latestRaceId={latestRaceId}
            isViewingLatest={isViewingLatest}
            parsed={parsed}
            parsedSchedule={parsedSchedule}
            lineupFinalized={lineupFinalized}
            blockNumber={activeBlockNumber}
            submissionCloseBlock={submissionCloseBlock}
            bettingCloseBlock={bettingCloseBlock}
            startBlock={startBlock}
            cooldownStatus={cooldownStatus}
            treasuryBalance={treasuryBalance}
            settledLiability={settledLiability}
            userUsdcBalance={userUsdcBalance}
            connectedAddress={connectedAddress}
            claimUiUnlocked={claimUiUnlocked}
            hasRevealedClaimSnapshot={hasRevealedClaimSnapshot}
            displayedNextWinningClaim={displayedNextWinningClaim}
            displayedWinningClaimRemaining={displayedWinningClaimRemaining}
            fundAmountUsdc={fundAmountUsdc}
            setFundAmountUsdc={setFundAmountUsdc}
            isFundingRace={isFundingRace}
            onCreateRace={handleCreateRace}
            onFinalizeLineup={handleFinalizeLineup}
            onSettleRace={handleSettleRace}
            onMineBlocks={mineBlocks}
            onFundTreasury={handleFundTreasury}
            onClaimPayout={handleClaimPayout}
            activeRaceExists={activeRaceExists}
            isInCooldown={!!isInCooldown}
            canFinalize={canFinalize}
            canSettle={canSettle}
            isMining={isMining}
          />

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
                  <EnterNftCard
                    connectedAddress={connectedAddress}
                    ownedTokenIds={ownedTokenIds}
                    ownedTokenNameById={ownedTokenNameById}
                    isOwnedTokensLoading={isOwnedTokensLoading}
                    isLoadingOwnedTokenNames={isLoadingOwnedTokenNames}
                    selectedTokenId={selectedTokenId}
                    setSelectedTokenId={setSelectedTokenId}
                    submittedTokenId={submittedTokenId}
                    viewingRaceId={viewingRaceId}
                    isEnterLocked={isEnterLocked}
                    canSubmit={canSubmit}
                    isViewingLatest={isViewingLatest}
                    giraffeRaceContract={giraffeRaceContract}
                    onSubmitNft={handleSubmitNft}
                  />
                ) : null}

                {showEntryPoolCard ? (
                  <EntryPoolCard
                    entryPoolTokenIds={entryPoolTokenIds}
                    selectedLineupTokenIdSet={selectedLineupTokenIdSet}
                    isFinalizeRevealActive={isFinalizeRevealActive}
                    viewingRaceId={viewingRaceId}
                  />
                ) : null}

                {showPlaceBetCard ? (
                  <PlaceBetCard
                    viewingRaceId={viewingRaceId}
                    lineupFinalized={lineupFinalized}
                    laneTokenIds={laneTokenIds}
                    laneStats={laneStats}
                    parsedGiraffes={parsedGiraffes}
                    parsedOdds={parsedOdds}
                    betLane={betLane}
                    setBetLane={setBetLane}
                    betAmountUsdc={betAmountUsdc}
                    setBetAmountUsdc={setBetAmountUsdc}
                    placeBetValue={placeBetValue}
                    estimatedPayoutWei={estimatedPayoutWei}
                    connectedAddress={connectedAddress}
                    userUsdcBalance={userUsdcBalance}
                    maxBetAmount={maxBetAmount}
                    myBet={myBet}
                    selectedBetLane={selectedBetLane}
                    canBet={canBet}
                    isBetLocked={isBetLocked}
                    isViewingLatest={isViewingLatest}
                    giraffeRaceContract={giraffeRaceContract}
                    needsApproval={needsApproval}
                    hasEnoughUsdc={hasEnoughUsdc}
                    exceedsMaxBet={exceedsMaxBet}
                    isApproving={isApproving}
                    onApprove={handleApprove}
                    onPlaceBet={handlePlaceBet}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
