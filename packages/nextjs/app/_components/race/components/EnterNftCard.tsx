"use client";

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

  // Contract
  giraffeRaceContract: any;

  // Actions
  onEnterQueue: () => Promise<void>;
  onLeaveQueue: () => Promise<void>;
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
  giraffeRaceContract,
  onEnterQueue,
  onLeaveQueue,
}: EnterNftCardProps) => {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h3 className="font-semibold">Enter the Race Queue</h3>
        <p className="text-sm opacity-70">
          Join the queue to have your giraffe compete in future races. First come, first served — the next 6 giraffes in
          queue race when someone creates a race.
        </p>

        {userInQueue && userQueuedToken ? (
          // User is already in queue - show their queued giraffe
          <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <GiraffeAnimated
                idPrefix={`queued-${userQueuedToken.toString()}`}
                tokenId={userQueuedToken}
                playbackRate={1}
                playing={true}
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
            <button className="btn btn-outline btn-sm" onClick={onLeaveQueue}>
              Leave Queue
            </button>
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
          You can have one giraffe in the queue at a time. Leave the queue anytime before a race picks your giraffe.
        </div>
      </div>
    </div>
  );
};
