"use client";

import { useMemo, useState } from "react";
import { EtherInput } from "@scaffold-ui/components";
import { formatEther, parseEther } from "viem";
import { useAccount, useBlockNumber } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const LANE_COUNT = 4 as const;
const LANE_EMOJI = "🦒";

type RaceStatus = "no_race" | "open" | "not_open" | "settled";

export const HomeRacePrototype = () => {
  const { address: connectedAddress } = useAccount();

  const [tokenIdInput, setTokenIdInput] = useState("");
  const [betLane, setBetLane] = useState<0 | 1 | 2 | 3>(0);
  const [betAmountEth, setBetAmountEth] = useState("");

  const { data: animalRaceContract } = useDeployedContractInfo({ contractName: "AnimalRace" });

  const { data: nextRaceIdData } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "nextRaceId",
    query: { enabled: !!animalRaceContract },
  });

  const nextRaceId = (nextRaceIdData as bigint | undefined) ?? undefined;
  const latestRaceId = useMemo(() => {
    if (nextRaceId === undefined) return undefined;
    if (nextRaceId === 0n) return undefined;
    return nextRaceId - 1n;
  }, [nextRaceId]);

  const { data: blockNumber } = useBlockNumber({
    watch: true,
    query: { enabled: !!animalRaceContract },
  });

  const readEnabled = !!animalRaceContract && latestRaceId !== undefined;

  const { data: raceData, isLoading: isRaceLoading } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getRace",
    args: [readEnabled ? latestRaceId : undefined],
    query: { enabled: readEnabled },
  });

  const parsed = useMemo(() => {
    if (!raceData) return null;
    // getRace returns: (closeBlock, settled, winner, seed, totalPot, totalOnAnimal)
    // We intentionally skip `seed` on the Home page (visualization lives in /race-view).
    const [closeBlock, settled, winner, , totalPot, totalOnAnimal] = raceData;
    return {
      closeBlock: closeBlock as bigint,
      settled: settled as boolean,
      winner: Number(winner as any) as 0 | 1 | 2 | 3,
      totalPot: totalPot as bigint,
      totalOnAnimal: (totalOnAnimal as readonly bigint[]).map(x => BigInt(x)),
    };
  }, [raceData]);

  const status: RaceStatus = useMemo(() => {
    if (!animalRaceContract) return "no_race";
    if (latestRaceId === undefined) return "no_race";
    if (!parsed) return "not_open";
    if (parsed.settled) return "settled";
    if (blockNumber !== undefined && parsed.closeBlock !== 0n && blockNumber >= parsed.closeBlock) return "not_open";
    return "open";
  }, [animalRaceContract, latestRaceId, parsed, blockNumber]);

  const blocksRemaining =
    parsed && blockNumber !== undefined && blockNumber < parsed.closeBlock
      ? Number(parsed.closeBlock - blockNumber)
      : 0;

  const { data: myBetData } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getBet",
    args: [readEnabled ? latestRaceId : undefined, readEnabled ? connectedAddress : undefined],
    query: { enabled: readEnabled && !!connectedAddress },
  });

  const myBet = useMemo(() => {
    if (!myBetData) return null;
    const [amount, animal, claimed] = myBetData;
    const amt = BigInt(amount as any);
    return {
      amount: amt,
      animal: Number(animal as any) as 0 | 1 | 2 | 3,
      claimed: claimed as boolean,
      hasBet: amt !== 0n,
    };
  }, [myBetData]);

  const { writeContractAsync: writeAnimalRaceAsync } = useScaffoldWriteContract({ contractName: "AnimalRace" });

  const canInteract = status === "open";

  const submitTokenId = useMemo(() => {
    const v = tokenIdInput.trim();
    if (!v) return null;
    try {
      const id = BigInt(v);
      if (id <= 0n) return null;
      return id;
    } catch {
      return null;
    }
  }, [tokenIdInput]);

  const placeBetValue = useMemo(() => {
    const v = betAmountEth.trim();
    if (!v) return null;
    try {
      const wei = parseEther(v as `${number}`);
      if (wei <= 0n) return null;
      return wei;
    } catch {
      return null;
    }
  }, [betAmountEth]);

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">Giraffe Race</h1>
        <p className="text-base-content/70">
          Player home (prototype): submit an NFT, place a bet, then watch the replay in{" "}
          <a className="link" href="/race-view">
            Race View
          </a>
          .
        </p>
      </div>

      <div className="card bg-base-200 shadow">
        <div className="card-body gap-3">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Latest Race</h2>
            <div className="text-xs opacity-70">{animalRaceContract ? "AnimalRace deployed" : "Not deployed"}</div>
          </div>

          {!animalRaceContract ? (
            <div className="alert alert-info">
              <span className="text-sm">Deploy the contracts first (`yarn chain` + `yarn deploy`).</span>
            </div>
          ) : latestRaceId === undefined ? (
            <div className="alert alert-info">
              <span className="text-sm">
                No races created yet. Ask the owner to create a race in{" "}
                <a className="link" href="/debug">
                  Debug
                </a>
                .
              </span>
            </div>
          ) : isRaceLoading || !parsed ? (
            <div className="text-sm opacity-70">Loading latest race…</div>
          ) : (
            <>
              <div className="text-sm">
                <div className="flex justify-between">
                  <span className="opacity-70">Race ID</span>
                  <span className="font-mono">{latestRaceId.toString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Status</span>
                  <span className="font-semibold">
                    {status === "open" ? "Open" : status === "settled" ? "Settled" : "Not open"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Current block</span>
                  <span>{blockNumber !== undefined ? blockNumber.toString() : "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Close block</span>
                  <span>{parsed.closeBlock.toString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Blocks remaining</span>
                  <span>{status === "open" ? blocksRemaining.toString() : "0"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Total pot</span>
                  <span>{`${formatEther(parsed.totalPot)} ETH`}</span>
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Array.from({ length: LANE_COUNT }).map((_, lane) => (
                    <div key={lane} className="rounded-xl bg-base-100 border border-base-300 px-3 py-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">
                          Lane {lane} {LANE_EMOJI}
                          {status === "settled" && parsed.winner === lane ? " (winner)" : ""}
                        </span>
                        <span className="font-mono text-xs opacity-70">
                          {formatEther(parsed.totalOnAnimal[lane] ?? 0n)} ETH
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="divider my-1" />

              <div className="text-sm">
                <div className="flex justify-between items-center">
                  <span className="opacity-70">Your bet (this race)</span>
                  {!connectedAddress ? (
                    <span className="text-xs opacity-70">Connect wallet</span>
                  ) : myBet?.hasBet ? (
                    <span className="font-semibold">
                      Lane {myBet.animal} · {formatEther(myBet.amount)} ETH {myBet.claimed ? "(claimed)" : ""}
                    </span>
                  ) : (
                    <span className="text-xs opacity-70">No bet yet</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <h2 className="card-title">Enter an NFT</h2>
            <p className="text-sm opacity-70">
              Submit one AnimalNFT you own into the entrant pool (non-custodial). Lanes are assigned at settlement.
            </p>

            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">Token ID</span>
              </div>
              <input
                className="input input-bordered w-full"
                value={tokenIdInput}
                onChange={e => setTokenIdInput(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 12"
              />
            </label>

            <button
              className="btn btn-primary"
              disabled={
                !animalRaceContract || !connectedAddress || !canInteract || !submitTokenId || latestRaceId === undefined
              }
              onClick={async () => {
                if (latestRaceId === undefined) return;
                if (!submitTokenId) return;
                await writeAnimalRaceAsync({
                  functionName: "submitAnimal",
                  args: [latestRaceId, submitTokenId],
                });
                setTokenIdInput("");
              }}
            >
              Submit NFT to race
            </button>

            {!canInteract ? (
              <div className="text-xs opacity-70">Submissions are only available while the race is open.</div>
            ) : null}
          </div>
        </div>

        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <h2 className="card-title">Place a bet</h2>
            <p className="text-sm opacity-70">One bet per address per race.</p>

            <div className="flex flex-wrap gap-2">
              {Array.from({ length: LANE_COUNT }).map((_, lane) => (
                <button
                  key={lane}
                  className={`btn btn-sm ${betLane === lane ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setBetLane(lane as 0 | 1 | 2 | 3)}
                  type="button"
                >
                  Lane {lane} {LANE_EMOJI}
                </button>
              ))}
            </div>

            <EtherInput
              placeholder="Bet amount (ETH)"
              onValueChange={({ valueInEth }) => setBetAmountEth(valueInEth)}
              style={{ width: "100%" }}
            />

            <button
              className="btn btn-primary"
              disabled={
                !animalRaceContract ||
                !connectedAddress ||
                !canInteract ||
                latestRaceId === undefined ||
                !placeBetValue ||
                !!myBet?.hasBet
              }
              onClick={async () => {
                if (latestRaceId === undefined) return;
                if (!placeBetValue) return;
                await writeAnimalRaceAsync({
                  functionName: "placeBet",
                  args: [latestRaceId, betLane],
                  value: placeBetValue,
                });
                setBetAmountEth("");
              }}
            >
              Place bet
            </button>

            {!canInteract ? (
              <div className="text-xs opacity-70">Betting is only available while the race is open.</div>
            ) : myBet?.hasBet ? (
              <div className="text-xs opacity-70">You already placed a bet for this race.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="alert alert-info">
        <span className="text-sm">
          Owner actions (create/settle) are intentionally kept in{" "}
          <a className="link" href="/debug">
            Debug
          </a>
          .
        </span>
      </div>
    </div>
  );
};
