"use client";

import { useCallback, useState } from "react";
import { AdminStatusCard } from "./race/components";
import { useRaceData, useRaceDetails, useRaceStatus, useViewingRace } from "./race/hooks";
import { Address } from "@scaffold-ui/components";
import { formatUnits, isAddress, parseUnits, toHex } from "viem";
import { useBlockNumber } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const USDC_DECIMALS = 6;
const MAX_HOUSE_EDGE_BPS = 3000; // 30%

export const AdminDashboard = () => {
  // Core data hooks
  const raceData = useRaceData();
  const {
    publicClient,
    connectedAddress,
    blockNumber,
    raffeRaceContract,
    usdcContract,
    usdcContractName,
    treasuryContract,
    isRaffeRaceLoading,
    hasAnyRace,
    latestRaceId,
    cooldownStatus,
    settledLiability,
    userUsdcBalance,
    treasuryBalance,
  } = raceData;

  // Viewing state
  const { viewingRaceId, isViewingLatest, setViewRaceId } = useViewingRace(latestRaceId, hasAnyRace);

  // Race details
  const raceDetails = useRaceDetails(viewingRaceId, hasAnyRace, raffeRaceContract, null);
  const { parsed, parsedSchedule, bettingCloseBlock } = raceDetails;

  // Race status
  const status = useRaceStatus(raffeRaceContract, hasAnyRace, parsed, parsedSchedule, cooldownStatus, blockNumber);

  // Live block number
  const { data: liveBlockNumber } = useBlockNumber({ watch: true });
  const activeBlockNumber = liveBlockNumber ?? blockNumber;

  // Local UI state
  const [isMining, setIsMining] = useState(false);
  const [fundAmountUsdc, setFundAmountUsdc] = useState("");
  const [isFundingRace, setIsFundingRace] = useState(false);

  // Admin settings state
  const [newHouseEdgeBps, setNewHouseEdgeBps] = useState("");
  const [newMaxBetUsdc, setNewMaxBetUsdc] = useState("");
  const [newRaceBot, setNewRaceBot] = useState("");
  const [cancelRaceId, setCancelRaceId] = useState("");
  const [isUpdatingHouseEdge, setIsUpdatingHouseEdge] = useState(false);
  const [isUpdatingMaxBet, setIsUpdatingMaxBet] = useState(false);
  const [isUpdatingRaceBot, setIsUpdatingRaceBot] = useState(false);
  const [isCancellingRace, setIsCancellingRace] = useState(false);

  // Read current admin settings
  const { data: currentHouseEdgeBps } = useScaffoldReadContract({
    contractName: "RaffeRace",
    functionName: "houseEdgeBps",
  });

  const { data: currentMaxBetAmount } = useScaffoldReadContract({
    contractName: "RaffeRace",
    functionName: "maxBetAmount",
  });

  const { data: currentRaceBot } = useScaffoldReadContract({
    contractName: "RaffeRace",
    functionName: "raceBot",
  });

  const { data: treasuryOwner } = useScaffoldReadContract({
    contractName: "HouseTreasury",
    functionName: "owner",
  });

  // Check if connected address is treasury owner
  const isTreasuryOwner =
    connectedAddress && treasuryOwner && connectedAddress.toLowerCase() === treasuryOwner.toLowerCase();

  // Write hooks
  const { writeContractAsync: writeRaffeRaceAsync } = useScaffoldWriteContract({ contractName: "RaffeRace" });
  const { writeContractAsync: writeUsdcAsync } = useScaffoldWriteContract({
    contractName: usdcContractName as any,
  });

  // Derived state
  const canSettle =
    !!parsed &&
    !parsed.settled &&
    bettingCloseBlock !== null &&
    activeBlockNumber !== undefined &&
    activeBlockNumber > bettingCloseBlock;
  const activeRaceExists = status !== "no_race" && status !== "cooldown" && status !== "settled" && !parsed?.settled;
  const isInCooldown =
    status === "cooldown" || (cooldownStatus && !cooldownStatus.canCreate && cooldownStatus.blocksRemaining > 0n);

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
    const txHash = await writeRaffeRaceAsync({ functionName: "createRace" } as any);
    console.log("🏁 createRace TX Hash:", txHash);

    if (publicClient && txHash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("⛽ TOTAL Gas Used:", receipt.gasUsed.toString());
    }
  }, [writeRaffeRaceAsync, publicClient]);

  const handleSettleRace = useCallback(async () => {
    const txHash = await writeRaffeRaceAsync({ functionName: "settleRace" } as any);
    console.log("🏁 settleRace TX Hash:", txHash);

    if (publicClient && txHash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("⛽ TOTAL Gas Used:", receipt.gasUsed.toString());
    }
  }, [writeRaffeRaceAsync, publicClient]);

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

  // Admin settings handlers
  const handleSetHouseEdge = useCallback(async () => {
    const v = newHouseEdgeBps.trim();
    if (!v) return;
    const bps = parseInt(v, 10);
    if (isNaN(bps) || bps < 0 || bps > MAX_HOUSE_EDGE_BPS) return;
    try {
      setIsUpdatingHouseEdge(true);
      await writeRaffeRaceAsync({
        functionName: "setHouseEdgeBps",
        args: [bps],
      } as any);
      setNewHouseEdgeBps("");
    } finally {
      setIsUpdatingHouseEdge(false);
    }
  }, [newHouseEdgeBps, writeRaffeRaceAsync]);

  const handleSetMaxBet = useCallback(async () => {
    const v = newMaxBetUsdc.trim();
    if (!v) return;
    let amount: bigint;
    try {
      amount = parseUnits(v as `${number}`, USDC_DECIMALS);
    } catch {
      return;
    }
    if (amount <= 0n) return;
    try {
      setIsUpdatingMaxBet(true);
      await writeRaffeRaceAsync({
        functionName: "setMaxBetAmount",
        args: [amount],
      } as any);
      setNewMaxBetUsdc("");
    } finally {
      setIsUpdatingMaxBet(false);
    }
  }, [newMaxBetUsdc, writeRaffeRaceAsync]);

  const handleSetRaceBot = useCallback(async () => {
    const addr = newRaceBot.trim();
    if (!addr || !isAddress(addr)) return;
    try {
      setIsUpdatingRaceBot(true);
      await writeRaffeRaceAsync({
        functionName: "setRaceBot",
        args: [addr],
      } as any);
      setNewRaceBot("");
    } finally {
      setIsUpdatingRaceBot(false);
    }
  }, [newRaceBot, writeRaffeRaceAsync]);

  const handleAdminCancelRace = useCallback(async () => {
    const v = cancelRaceId.trim();
    if (!v) return;
    const raceId = parseInt(v, 10);
    if (isNaN(raceId) || raceId < 1) return;
    try {
      setIsCancellingRace(true);
      await writeRaffeRaceAsync({
        functionName: "adminCancelRace",
        args: [BigInt(raceId)],
      } as any);
      setCancelRaceId("");
    } finally {
      setIsCancellingRace(false);
    }
  }, [cancelRaceId, writeRaffeRaceAsync]);

  return (
    <div className="flex flex-col w-full">
      <div className="flex flex-col gap-8 w-full max-w-4xl mx-auto px-[30px] py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold">Admin Panel</h1>
          <p className="text-base-content/70">Manage races, treasury, and contract controls.</p>
        </div>

        {/* Race history navigation */}
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <h2 className="card-title">Race History</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="btn btn-sm btn-outline"
                disabled={!viewingRaceId || viewingRaceId <= 1n}
                onClick={() => viewingRaceId && setViewRaceId(viewingRaceId - 1n)}
              >
                ← Previous
              </button>
              <span className="text-sm font-mono px-2">
                Race {viewingRaceId?.toString() ?? "-"} / {latestRaceId?.toString() ?? "-"}
              </span>
              <button
                className="btn btn-sm btn-outline"
                disabled={!viewingRaceId || !latestRaceId || viewingRaceId >= latestRaceId}
                onClick={() => viewingRaceId && setViewRaceId(viewingRaceId + 1n)}
              >
                Next →
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={isViewingLatest}
                onClick={() => latestRaceId && setViewRaceId(latestRaceId)}
              >
                Go to Latest
              </button>
            </div>
          </div>
        </div>

        {/* Admin Status Card */}
        <AdminStatusCard
          isRaffeRaceLoading={isRaffeRaceLoading}
          raffeRaceContract={raffeRaceContract}
          treasuryContract={treasuryContract}
          usdcContract={usdcContract}
          status={status}
          viewingRaceId={viewingRaceId}
          latestRaceId={latestRaceId}
          isViewingLatest={isViewingLatest}
          parsed={parsed}
          parsedSchedule={parsedSchedule}
          blockNumber={activeBlockNumber}
          bettingCloseBlock={bettingCloseBlock}
          cooldownStatus={cooldownStatus}
          treasuryBalance={treasuryBalance}
          settledLiability={settledLiability}
          userUsdcBalance={userUsdcBalance}
          connectedAddress={connectedAddress}
          fundAmountUsdc={fundAmountUsdc}
          setFundAmountUsdc={setFundAmountUsdc}
          isFundingRace={isFundingRace}
          onCreateRace={handleCreateRace}
          onSettleRace={handleSettleRace}
          onMineBlocks={mineBlocks}
          onFundTreasury={handleFundTreasury}
          activeRaceExists={activeRaceExists}
          isInCooldown={!!isInCooldown}
          canSettle={canSettle}
          isMining={isMining}
        />

        {/* Treasury Owner Settings */}
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-4">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Treasury Owner Settings</h2>
              {isTreasuryOwner ? (
                <div className="badge badge-success badge-sm">Owner</div>
              ) : (
                <div className="badge badge-warning badge-sm">Not Owner</div>
              )}
            </div>

            {treasuryOwner && (
              <div className="text-xs">
                <div className="flex justify-between items-center">
                  <span className="opacity-70">Treasury Owner</span>
                  <Address address={treasuryOwner as `0x${string}`} />
                </div>
              </div>
            )}

            {!isTreasuryOwner && (
              <div className="alert alert-warning">
                <span className="text-sm">
                  Only the treasury owner can modify these settings. Connect with the owner wallet.
                </span>
              </div>
            )}

            <div className="divider my-1" />

            {/* House Edge Setting */}
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">House Edge</div>
              <div className="text-xs">
                <div className="flex justify-between">
                  <span className="opacity-70">Current value</span>
                  <span className="font-mono">
                    {currentHouseEdgeBps !== undefined
                      ? `${(Number(currentHouseEdgeBps) / 100).toFixed(2)}% (${currentHouseEdgeBps} bps)`
                      : "Loading..."}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Max allowed</span>
                  <span className="font-mono">30% ({MAX_HOUSE_EDGE_BPS} bps)</span>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max={MAX_HOUSE_EDGE_BPS}
                    className="input input-bordered input-sm w-full pr-12"
                    placeholder="e.g. 500"
                    value={newHouseEdgeBps}
                    onChange={e => setNewHouseEdgeBps(e.target.value)}
                    disabled={!isTreasuryOwner}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-70">bps</span>
                </div>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={!isTreasuryOwner || isUpdatingHouseEdge || !newHouseEdgeBps.trim()}
                  onClick={handleSetHouseEdge}
                >
                  {isUpdatingHouseEdge ? <span className="loading loading-spinner loading-xs" /> : "Set"}
                </button>
              </div>
              <div className="text-xs opacity-70">1 bps = 0.01%. Enter 500 for 5% house edge.</div>
            </div>

            <div className="divider my-1" />

            {/* Max Bet Setting */}
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">Max Bet Amount</div>
              <div className="text-xs">
                <div className="flex justify-between">
                  <span className="opacity-70">Current value</span>
                  <span className="font-mono">
                    {currentMaxBetAmount !== undefined
                      ? `${formatUnits(currentMaxBetAmount as bigint, USDC_DECIMALS)} USDC`
                      : "Loading..."}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input input-bordered input-sm w-full pr-16"
                    placeholder="e.g. 100"
                    value={newMaxBetUsdc}
                    onChange={e => setNewMaxBetUsdc(e.target.value)}
                    disabled={!isTreasuryOwner}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-70">USDC</span>
                </div>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={!isTreasuryOwner || isUpdatingMaxBet || !newMaxBetUsdc.trim()}
                  onClick={handleSetMaxBet}
                >
                  {isUpdatingMaxBet ? <span className="loading loading-spinner loading-xs" /> : "Set"}
                </button>
              </div>
              <div className="text-xs opacity-70">Maximum amount a user can bet on a single race.</div>
            </div>

            <div className="divider my-1" />

            {/* Race Bot Setting */}
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">Race Bot Address</div>
              <div className="text-xs">
                <div className="flex justify-between items-center">
                  <span className="opacity-70">Current bot</span>
                  {currentRaceBot ? (
                    <Address address={currentRaceBot as `0x${string}`} />
                  ) : (
                    <span className="font-mono">Loading...</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input input-bordered input-sm flex-1 font-mono text-xs"
                  placeholder="0x..."
                  value={newRaceBot}
                  onChange={e => setNewRaceBot(e.target.value)}
                  disabled={!isTreasuryOwner}
                />
                <button
                  className="btn btn-sm btn-outline"
                  disabled={
                    !isTreasuryOwner || isUpdatingRaceBot || !newRaceBot.trim() || !isAddress(newRaceBot.trim())
                  }
                  onClick={handleSetRaceBot}
                >
                  {isUpdatingRaceBot ? <span className="loading loading-spinner loading-xs" /> : "Set"}
                </button>
              </div>
              <div className="text-xs opacity-70">
                The bot address that can call setProbabilities() to set race odds.
              </div>
            </div>

            <div className="divider my-1" />

            {/* Cancel Race */}
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-error">Cancel Race (Emergency)</div>
              <div className="text-xs opacity-70">
                Cancel a stuck race to enable refunds for all bettors. Use only if a race cannot be settled normally.
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    className="input input-bordered input-sm w-full"
                    placeholder="Race ID to cancel"
                    value={cancelRaceId}
                    onChange={e => setCancelRaceId(e.target.value)}
                    disabled={!isTreasuryOwner}
                  />
                </div>
                <button
                  className="btn btn-sm btn-error btn-outline"
                  disabled={!isTreasuryOwner || isCancellingRace || !cancelRaceId.trim()}
                  onClick={handleAdminCancelRace}
                >
                  {isCancellingRace ? <span className="loading loading-spinner loading-xs" /> : "Cancel Race"}
                </button>
              </div>
              <div className="text-xs text-error/70">
                ⚠️ This action cannot be undone. Bettors will be able to claim refunds.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
