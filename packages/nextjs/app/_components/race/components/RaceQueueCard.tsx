"use client";

import { QueueEntry } from "../types";
import { LaneName } from "./LaneName";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";

interface RaceQueueCardProps {
  queueEntries: QueueEntry[];
  activeQueueLength: number;
  userInQueue: boolean;
  userQueuedToken: bigint | null;
}

export const RaceQueueCard = ({
  queueEntries,
  activeQueueLength,
  userInQueue,
  userQueuedToken,
}: RaceQueueCardProps) => {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Race Queue</h3>
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
