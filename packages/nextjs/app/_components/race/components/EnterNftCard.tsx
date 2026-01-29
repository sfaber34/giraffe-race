"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANE_COUNT } from "../constants";
import { LaneStats, QueueEntry } from "../types";
import { LaneName } from "./LaneName";
import { Address } from "@scaffold-ui/components";
import { usePublicClient } from "wagmi";
import { RaffeAnimated } from "~~/components/assets/RaffeAnimated";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

/* ─────────────────────────────────────────────────────────────────────────────
 * NftDropdown - Custom dropdown with NFT previews
 * ───────────────────────────────────────────────────────────────────────────── */

interface NftDropdownProps {
  ownedTokenIds: bigint[];
  ownedTokenNameById: Record<string, string>;
  ownedTokenStats: Record<string, LaneStats>;
  isLoadingOwnedTokenNames: boolean;
  selectedTokenId: bigint | null;
  setSelectedTokenId: (id: bigint | null) => void;
}

const NftDropdown = ({
  ownedTokenIds,
  ownedTokenNameById,
  ownedTokenStats,
  isLoadingOwnedTokenNames,
  selectedTokenId,
  setSelectedTokenId,
}: NftDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getName = (tokenId: bigint) => {
    const name = ownedTokenNameById[tokenId.toString()] || "";
    if (name.trim()) return name;
    if (isLoadingOwnedTokenNames) return "Loading…";
    return "Unnamed";
  };

  const getStats = (tokenId: bigint) => {
    return ownedTokenStats[tokenId.toString()] ?? { zip: 10, moxie: 10, hustle: 10 };
  };

  const handleSelect = (tokenId: bigint) => {
    setSelectedTokenId(tokenId);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative w-full">
      {/* Trigger button */}
      <div
        className="select select-bordered w-full flex items-center justify-between text-left cursor-pointer"
        onMouseDown={e => {
          e.preventDefault();
          setIsOpen(!isOpen);
        }}
      >
        {selectedTokenId !== null ? (
          <span className="flex items-center gap-2">
            <span className="pointer-events-none">
              <RaffeAnimated
                idPrefix={`dropdown-selected-${selectedTokenId.toString()}`}
                tokenId={selectedTokenId}
                playbackRate={1}
                playing={false}
                sizePx={24}
              />
            </span>
            <span className="truncate">{getName(selectedTokenId)}</span>
          </span>
        ) : (
          <span className="opacity-50">Select a Raffe…</span>
        )}
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg bg-base-100 border border-base-300 shadow-lg">
          {ownedTokenIds.map(tokenId => {
            const stats = getStats(tokenId);
            return (
              <li
                key={tokenId.toString()}
                className={`flex items-center gap-2 px-3 py-2 hover:bg-base-200 cursor-pointer ${
                  selectedTokenId === tokenId ? "bg-primary/10" : ""
                }`}
                onMouseDown={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelect(tokenId);
                }}
              >
                <span className="pointer-events-none flex-shrink-0">
                  <RaffeAnimated
                    idPrefix={`dropdown-option-${tokenId.toString()}`}
                    tokenId={tokenId}
                    playbackRate={1}
                    playing={false}
                    sizePx={36}
                  />
                </span>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate font-medium">{getName(tokenId)}</span>
                  <span className="text-xs opacity-60">
                    Z:{stats.zip} M:{stats.moxie} H:{stats.hustle}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * EnterNftCard
 * ───────────────────────────────────────────────────────────────────────────── */

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

  // Fetch stats for owned tokens - using same pattern as RaffeNfts.tsx
  const [ownedTokenStats, setOwnedTokenStats] = useState<Record<string, LaneStats>>({});

  useEffect(() => {
    const fetchOwnedStats = async () => {
      if (!publicClient || !raffeNftContract?.address || !raffeNftContract?.abi || ownedTokenIds.length === 0) {
        setOwnedTokenStats({});
        return;
      }

      const calls = ownedTokenIds.map(tokenId => ({
        address: raffeNftContract.address as `0x${string}`,
        abi: raffeNftContract.abi as any,
        functionName: "statsOf",
        args: [tokenId],
      }));

      let results: { result?: unknown }[];

      try {
        results = (await publicClient.multicall({ contracts: calls as any, allowFailure: true })) as any;
      } catch {
        // Fallback to individual reads if multicall fails
        const settled = await Promise.allSettled(
          ownedTokenIds.map(tokenId =>
            (publicClient as any).readContract({
              address: raffeNftContract.address,
              abi: raffeNftContract.abi,
              functionName: "statsOf",
              args: [tokenId],
            }),
          ),
        );
        results = settled.map(r => (r.status === "fulfilled" ? { result: r.value } : {}));
      }

      const clampStat = (n: number) => Math.max(1, Math.min(10, Math.floor(n)));
      const statsMap: Record<string, LaneStats> = {};

      ownedTokenIds.forEach((tokenId, i) => {
        const statsRaw = (results[i] as any)?.result;
        const tuple = (Array.isArray(statsRaw) ? statsRaw : []) as any[];
        statsMap[tokenId.toString()] = {
          zip: clampStat(Number(tuple[0] ?? 10)),
          moxie: clampStat(Number(tuple[1] ?? 10)),
          hustle: clampStat(Number(tuple[2] ?? 10)),
        };
      });

      setOwnedTokenStats(statsMap);
    };

    void fetchOwnedStats();
  }, [publicClient, raffeNftContract?.address, raffeNftContract?.abi, ownedTokenIds]);

  // Fetch stats for all queue entries - using same pattern as RaffeNfts.tsx
  const [queueStats, setQueueStats] = useState<Record<string, LaneStats>>({});

  useEffect(() => {
    const fetchStats = async () => {
      if (!publicClient || !raffeNftContract?.address || !raffeNftContract?.abi || queueEntries.length === 0) {
        setQueueStats({});
        return;
      }

      const calls = queueEntries.map(entry => ({
        address: raffeNftContract.address as `0x${string}`,
        abi: raffeNftContract.abi as any,
        functionName: "statsOf",
        args: [entry.tokenId],
      }));

      let results: { result?: unknown }[];

      try {
        results = (await publicClient.multicall({ contracts: calls as any, allowFailure: true })) as any;
      } catch {
        // Fallback to individual reads if multicall fails
        const settled = await Promise.allSettled(
          queueEntries.map(entry =>
            (publicClient as any).readContract({
              address: raffeNftContract.address,
              abi: raffeNftContract.abi,
              functionName: "statsOf",
              args: [entry.tokenId],
            }),
          ),
        );
        results = settled.map(r => (r.status === "fulfilled" ? { result: r.value } : {}));
      }

      const clampStat = (n: number) => Math.max(1, Math.min(10, Math.floor(n)));
      const statsMap: Record<string, LaneStats> = {};

      queueEntries.forEach((entry, i) => {
        const statsRaw = (results[i] as any)?.result;
        const tuple = (Array.isArray(statsRaw) ? statsRaw : []) as any[];
        statsMap[entry.tokenId.toString()] = {
          zip: clampStat(Number(tuple[0] ?? 10)),
          moxie: clampStat(Number(tuple[1] ?? 10)),
          hustle: clampStat(Number(tuple[2] ?? 10)),
        };
      });

      setQueueStats(statsMap);
    };

    void fetchStats();
  }, [publicClient, raffeNftContract?.address, raffeNftContract?.abi, queueEntries]);

  // Determine which entries are "Up Next" (first LANE_COUNT entries)
  const upNextTokenIds = useMemo(() => {
    return new Set(queueEntries.slice(0, LANE_COUNT).map(e => e.tokenId.toString()));
  }, [queueEntries]);

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h3 className="font-semibold">Enter the Race Queue</h3>

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
              {!connectedAddress ? (
                <div className="text-sm opacity-70">Connect your wallet to see your Raffes.</div>
              ) : isOwnedTokensLoading ? (
                <div className="text-sm opacity-70">Loading your Raffes...</div>
              ) : ownedTokenIds.length === 0 ? (
                <div className="text-sm opacity-70">You don&apos;t own any Raffes yet.</div>
              ) : (
                <NftDropdown
                  ownedTokenIds={ownedTokenIds}
                  ownedTokenNameById={ownedTokenNameById}
                  ownedTokenStats={ownedTokenStats}
                  isLoadingOwnedTokenNames={isLoadingOwnedTokenNames}
                  selectedTokenId={selectedTokenId}
                  setSelectedTokenId={setSelectedTokenId}
                />
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
          You can have one raffe in the queue at a time. Once entered, your raffe is committed until it races. First
          come, first served
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
