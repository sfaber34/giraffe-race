"use client";

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
  submittedTokenId: bigint | null;
  viewingRaceId: bigint | null;

  // Flags
  isEnterLocked: boolean;
  canSubmit: boolean;
  isViewingLatest: boolean;
  giraffeRaceContract: any;

  // Actions
  onSubmitNft: () => Promise<void>;
}

export const EnterNftCard = ({
  connectedAddress,
  ownedTokenIds,
  ownedTokenNameById,
  isOwnedTokensLoading,
  isLoadingOwnedTokenNames,
  selectedTokenId,
  setSelectedTokenId,
  submittedTokenId,
  viewingRaceId,
  isEnterLocked,
  canSubmit,
  isViewingLatest,
  giraffeRaceContract,
  onSubmitNft,
}: EnterNftCardProps) => {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h3 className="font-semibold">Enter an NFT</h3>
        <p className="text-sm opacity-70">
          Submitting starts a race if none is active. Submissions are open until the submissions-close block.
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
            <div className="text-sm opacity-70">You don&apos;t own any GiraffeNFTs yet.</div>
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
          onClick={onSubmitNft}
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
            . You can&apos;t change entries after submitting.
          </div>
        ) : null}

        {!canSubmit ? (
          <div className="text-xs opacity-70">Submissions are only available during the submissions window.</div>
        ) : null}
      </div>
    </div>
  );
};
