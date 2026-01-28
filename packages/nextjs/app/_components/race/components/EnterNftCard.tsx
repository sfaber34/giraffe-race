"use client";

import { useEffect, useMemo, useState } from "react";
import { LANE_COUNT } from "../constants";
import { LaneStats, QueueEntry } from "../types";
import { parseStats } from "../utils";
import { LaneName } from "./LaneName";
import { Address } from "@scaffold-ui/components";
import { usePublicClient } from "wagmi";
import { RaffeAnimated } from "~~/components/assets/RaffeAnimated";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

interface EnterNftCardProps {
  // State
  connectedAddress: `0x${string}` | undefined;
  ownedTokenIds: bigint[];
  ownedTokenNameById: Record<string, string>;
  isOwnedTokensLoading: boolean;
  isLoadingOwnedTokenNames: boolean;
  selectedTokenId: bigint | null;
  setSelectedTokenId: (id: bigint | null) => void;

  // Queue status
  userInQueue: boolean;
  userQueuedToken: bigint | null;
  userQueuePosition: number | null;

  // Queue display
  queueEntries: QueueEntry[];
  activeQueueLength: number;

  // Contract
  raffeRaceContract: any;

  // Actions
  onEnterQueue: () => Promise<void>;
}

export const EnterNftCard = ({
  connectedAddress,
  ownedTokenIds,
  ownedTokenNameById,
  isOwnedTokensLoading,
  isLoadingOwnedTokenNames,
  selectedTokenId,
  setSelectedTokenId,
  userInQueue,
  userQueuedToken,
  userQueuePosition,
  queueEntries,
  activeQueueLength,
  raffeRaceContract,
  onEnterQueue,
}: EnterNftCardProps) => {
  const publicClient = usePublicClient();
  const { data: raffeNftContract } = useDeployedContractInfo({ contractName: "RaffeNFT" });

  // Fetch stats for all queue entries
  const [queueStats, setQueueStats] = useState<Record<string, LaneStats>>({});

  useEffect(() => {
    const fetchStats = async () => {
      if (!publicClient || !raffeNftContract?.address || !raffeNftContract?.abi || queueEntries.length === 0) {
        setQueueStats({});
        return;
      }

      try {
        const calls = queueEntries.map(entry => ({
          address: raffeNftContract.address as `0x${string}`,
          abi: raffeNftContract.abi as any,
          functionName: "statsOf",
          args: [entry.tokenId],
        }));

        const results = await publicClient.multicall({ contracts: calls as any, allowFailure: true });

        const statsMap: Record<string, LaneStats> = {};
        queueEntries.forEach((entry, i) => {
          const result = results[i];
          if (result.status === "success") {
            statsMap[entry.tokenId.toString()] = parseStats(result.result);
          } else {
            statsMap[entry.tokenId.toString()] = { zip: 10, moxie: 10, hustle: 10 };
          }
        });
        setQueueStats(statsMap);
      } catch {
        // Fallback to default stats
        const statsMap: Record<string, LaneStats> = {};
        queueEntries.forEach(entry => {
          statsMap[entry.tokenId.toString()] = { zip: 10, moxie: 10, hustle: 10 };
        });
        setQueueStats(statsMap);
      }
    };

    void fetchStats();
  }, [publicClient, raffeNftContract, queueEntries]);

  // Determine which entries are "Up Next" (first LANE_COUNT entries)
  const upNextTokenIds = useMemo(() => {
    return new Set(queueEntries.slice(0, LANE_COUNT).map(e => e.tokenId.toString()));
  }, [queueEntries]);

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h3 className="font-semibold">Enter the Race Queue</h3>
        <p className="text-sm opacity-70">
          Join the queue to have your raffe compete in future races. First come, first served — races start
          automatically when 6 raffes are ready.
        </p>

        {userInQueue && userQueuedToken ? (
          // User is already in queue - show their queued raffe
          <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <RaffeAnimated
                idPrefix={`queued-${userQueuedToken.toString()}`}
                tokenId={userQueuedToken}
                playbackRate={1}
                playing={false}
                sizePx={64}
              />
              <div className="flex flex-col">
                <span className="font-semibold">
                  <LaneName tokenId={userQueuedToken} fallback={`#${userQueuedToken.toString()}`} />
                </span>
                <span className="text-sm opacity-70">
                  {userQueuePosition !== null ? `Position ${userQueuePosition} in queue` : "In queue"}
                </span>
              </div>
            </div>
            <div className="text-xs text-success">✓ Your raffe is committed to race!</div>
          </div>
        ) : (
          // User is not in queue - show entry form
          <>
            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">Select a Raffe</span>
              </div>
              {!connectedAddress ? (
                <div className="text-sm opacity-70">Connect your wallet to see your NFTs.</div>
              ) : isOwnedTokensLoading ? (
                <div className="text-sm opacity-70">Loading your NFTs…</div>
              ) : ownedTokenIds.length === 0 ? (
                <div className="text-sm opacity-70">You don&apos;t own any RaffeNFTs yet.</div>
              ) : (
                <select
                  className="select select-bordered w-full"
                  value={selectedTokenId?.toString() ?? ""}
                  onChange={e => {
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
              disabled={!raffeRaceContract || !connectedAddress || selectedTokenId === null}
              onClick={onEnterQueue}
            >
              Join Queue
            </button>
          </>
        )}

        <div className="text-xs opacity-70">
          You can have one raffe in the queue at a time. Once entered, your raffe is committed until it races.
        </div>

        {/* Queue Display - List View */}
        <div className="divider my-2"></div>
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm">Race Queue</h4>
          <div className="text-xs opacity-70">
            {activeQueueLength} raffe{activeQueueLength !== 1 ? "s" : ""} waiting
          </div>
        </div>

        {queueEntries.length === 0 ? (
          <div className="text-sm opacity-70">No raffes in the queue yet. Be the first to join!</div>
        ) : (
          <div className="flex flex-col gap-2">
            {queueEntries.map((entry, idx) => {
              const isUserRaffe = userInQueue && userQueuedToken !== null && entry.tokenId === userQueuedToken;
              const isUpNext = upNextTokenIds.has(entry.tokenId.toString());
              const stats = queueStats[entry.tokenId.toString()] ?? { zip: 10, moxie: 10, hustle: 10 };

              return (
                <div
                  key={entry.tokenId.toString()}
                  className={`flex items-center gap-3 p-3 rounded-xl border bg-base-200/40 ${
                    isUserRaffe
                      ? "border-primary ring-1 ring-primary"
                      : isUpNext
                        ? "border-warning/50"
                        : "border-base-300"
                  }`}
                >
                  {/* Queue Position */}
                  <div className="flex-shrink-0 w-8 text-center">
                    <span className="font-mono font-bold text-lg opacity-60">#{idx + 1}</span>
                  </div>

                  {/* NFT Avatar */}
                  <div className="flex-shrink-0">
                    <RaffeAnimated
                      idPrefix={`queue-${entry.tokenId.toString()}`}
                      tokenId={entry.tokenId}
                      playbackRate={1}
                      playing={false}
                      sizePx={48}
                    />
                  </div>

                  {/* Name & Badges */}
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">
                        <LaneName tokenId={entry.tokenId} fallback={`#${entry.tokenId.toString()}`} />
                      </span>
                      {isUserRaffe && <span className="badge badge-primary badge-sm">You</span>}
                      {isUpNext && <span className="badge badge-warning badge-sm">Up Next</span>}
                    </div>
                    {/* Owner Address */}
                    <div className="text-xs opacity-70">
                      <Address address={entry.owner} size="xs" />
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex-shrink-0 text-right text-xs opacity-70 leading-tight">
                    <div>
                      <span className="opacity-60">Zip:</span> <span className="font-medium">{stats.zip}</span>
                    </div>
                    <div>
                      <span className="opacity-60">Moxie:</span> <span className="font-medium">{stats.moxie}</span>
                    </div>
                    <div>
                      <span className="opacity-60">Hustle:</span> <span className="font-medium">{stats.hustle}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
