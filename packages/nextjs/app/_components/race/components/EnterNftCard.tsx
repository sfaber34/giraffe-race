"use client";

import { QueueEntry } from "../types";
import { LaneName } from "./LaneName";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";

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
  giraffeRaceContract: any;

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
  giraffeRaceContract,
  onEnterQueue,
}: EnterNftCardProps) => {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h3 className="font-semibold">Enter the Race Queue</h3>
        <p className="text-sm opacity-70">
          Join the queue to have your giraffe compete in future races. First come, first served — races start
          automatically when 6 giraffes are ready.
        </p>

        {userInQueue && userQueuedToken ? (
          // User is already in queue - show their queued giraffe
          <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <GiraffeAnimated
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
            <div className="text-xs text-success">✓ Your giraffe is committed to race!</div>
          </div>
        ) : (
          // User is not in queue - show entry form
          <>
            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">Select a Giraffe</span>
              </div>
              {!connectedAddress ? (
                <div className="text-sm opacity-70">Connect your wallet to see your NFTs.</div>
              ) : isOwnedTokensLoading ? (
                <div className="text-sm opacity-70">Loading your NFTs…</div>
              ) : ownedTokenIds.length === 0 ? (
                <div className="text-sm opacity-70">You don&apos;t own any GiraffeNFTs yet.</div>
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
              disabled={!giraffeRaceContract || !connectedAddress || selectedTokenId === null}
              onClick={onEnterQueue}
            >
              Join Queue
            </button>
          </>
        )}

        <div className="text-xs opacity-70">
          You can have one giraffe in the queue at a time. Once entered, your giraffe is committed until it races.
        </div>

        {/* Queue Display */}
        <div className="divider my-2"></div>
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm">Race Queue</h4>
          <div className="text-xs opacity-70">
            {activeQueueLength} giraffe{activeQueueLength !== 1 ? "s" : ""} waiting
          </div>
        </div>

        {queueEntries.length === 0 ? (
          <div className="text-sm opacity-70">No giraffes in the queue yet. Be the first to join!</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {queueEntries.map((entry, idx) => {
              const isUserGiraffe = userInQueue && userQueuedToken !== null && entry.tokenId === userQueuedToken;
              return (
                <div
                  key={entry.tokenId.toString()}
                  className={`relative rounded-xl border border-base-300 bg-base-200/40 p-2 ${
                    isUserGiraffe ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100" : ""
                  }`}
                >
                  <div className="absolute top-1 left-1 badge badge-sm badge-ghost">{idx + 1}</div>
                  <GiraffeAnimated
                    idPrefix={`queue-${entry.tokenId.toString()}`}
                    tokenId={entry.tokenId}
                    playbackRate={1}
                    playing={false}
                    sizePx={84}
                    className="mx-auto block"
                  />
                  <div className="mt-1 text-[11px] text-center opacity-70 truncate max-w-[84px] mx-auto">
                    <LaneName tokenId={entry.tokenId} fallback={`#${entry.tokenId.toString()}`} />
                  </div>
                  {isUserGiraffe ? (
                    <div className="absolute top-1 right-1 badge badge-primary badge-sm">You</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
