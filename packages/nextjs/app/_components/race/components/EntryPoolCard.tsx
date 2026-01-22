"use client";

import { LaneName } from "./LaneName";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";

interface EntryPoolCardProps {
  entryPoolTokenIds: bigint[];
  selectedLineupTokenIdSet: Set<string>;
  isFinalizeRevealActive: boolean;
  viewingRaceId: bigint | null;
}

export const EntryPoolCard = ({
  entryPoolTokenIds,
  selectedLineupTokenIdSet,
  isFinalizeRevealActive,
  viewingRaceId,
}: EntryPoolCardProps) => {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Entry pool</h3>
          <div className="text-xs opacity-70">{entryPoolTokenIds.length} submitted</div>
        </div>

        {entryPoolTokenIds.length === 0 ? (
          <div className="text-sm opacity-70">No NFTs have been submitted yet.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {entryPoolTokenIds.map(tokenId => {
              const isSelected = isFinalizeRevealActive && selectedLineupTokenIdSet.has(tokenId.toString());
              return (
                <div
                  key={tokenId.toString()}
                  className={`relative rounded-xl border border-base-300 bg-base-200/40 p-2 ${
                    isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100" : ""
                  }`}
                >
                  <GiraffeAnimated
                    idPrefix={`pool-${(viewingRaceId ?? 0n).toString()}-${tokenId.toString()}`}
                    tokenId={tokenId}
                    playbackRate={1}
                    playing={false}
                    sizePx={84}
                    className="mx-auto block"
                  />
                  <div className="mt-1 text-[11px] text-center opacity-70 truncate max-w-[84px] mx-auto">
                    <LaneName tokenId={tokenId} fallback={`#${tokenId.toString()}`} />
                  </div>
                  {isSelected ? (
                    <div className="absolute top-2 right-2 badge badge-primary badge-sm">Selected</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {isFinalizeRevealActive ? (
          <div className="text-xs opacity-70">Lineup finalized — selected entrants are highlighted.</div>
        ) : (
          <div className="text-xs opacity-70">
            These are the NFTs submitted for the current race (before lineup finalization).
          </div>
        )}
      </div>
    </div>
  );
};
