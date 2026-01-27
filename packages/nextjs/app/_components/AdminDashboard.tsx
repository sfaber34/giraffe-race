"use client";

import { useCallback, useState } from "react";
import { AdminStatusCard } from "./race/components";
import { useRaceData, useRaceDetails, useRaceStatus, useViewingRace } from "./race/hooks";
import { parseUnits, toHex } from "viem";
import { useBlockNumber } from "wagmi";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const USDC_DECIMALS = 6;

export const AdminDashboard = () => {
  // Core data hooks
  const raceData = useRaceData();
  const {
    publicClient,
    connectedAddress,
    blockNumber,
    giraffeRaceContract,
    usdcContract,
    usdcContractName,
    treasuryContract,
    isGiraffeRaceLoading,
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
  const raceDetails = useRaceDetails(viewingRaceId, hasAnyRace, giraffeRaceContract, null);
  const { parsed, parsedSchedule, bettingCloseBlock } = raceDetails;

  // Race status
  const status = useRaceStatus(giraffeRaceContract, hasAnyRace, parsed, parsedSchedule, cooldownStatus, blockNumber);

  // Live block number
  const { data: liveBlockNumber } = useBlockNumber({ watch: true });
  const activeBlockNumber = liveBlockNumber ?? blockNumber;

  // Local UI state
  const [isMining, setIsMining] = useState(false);
  const [fundAmountUsdc, setFundAmountUsdc] = useState("");
  const [isFundingRace, setIsFundingRace] = useState(false);

  // Write hooks
  const { writeContractAsync: writeGiraffeRaceAsync } = useScaffoldWriteContract({ contractName: "GiraffeRace" });
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
    const txHash = await writeGiraffeRaceAsync({ functionName: "createRace" } as any);
    console.log("🏁 createRace TX Hash:", txHash);

    if (publicClient && txHash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("⛽ TOTAL Gas Used:", receipt.gasUsed.toString());
    }
  }, [writeGiraffeRaceAsync, publicClient]);

  const handleSettleRace = useCallback(async () => {
    const txHash = await writeGiraffeRaceAsync({ functionName: "settleRace" } as any);
    console.log("🏁 settleRace TX Hash:", txHash);

    if (publicClient && txHash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("⛽ TOTAL Gas Used:", receipt.gasUsed.toString());
    }
  }, [writeGiraffeRaceAsync, publicClient]);

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
      </div>
    </div>
  );
};
