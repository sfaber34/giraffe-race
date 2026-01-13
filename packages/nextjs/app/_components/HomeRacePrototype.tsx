"use client";

import { useEffect, useMemo, useState } from "react";
import { EtherInput } from "@scaffold-ui/components";
import { formatEther, parseEther, toHex } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";

const LANE_COUNT = 4 as const;
const LANE_EMOJI = "🦒";
const SUBMISSION_CLOSE_OFFSET_BLOCKS = 10n;

type RaceStatus = "no_race" | "submissions_open" | "betting_open" | "closed" | "settled";

const LaneName = ({ tokenId, fallback }: { tokenId: bigint; fallback: string }) => {
  const enabled = tokenId !== 0n;
  const { data: nameData } = useScaffoldReadContract({
    contractName: "AnimalNFT",
    functionName: "nameOf",
    args: [enabled ? tokenId : undefined],
    query: { enabled },
  });

  const name = (nameData as string | undefined) ?? "";
  return <span>{name.trim() ? name : fallback}</span>;
};

export const HomeRacePrototype = () => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { address: connectedAddress } = useAccount();

  const [selectedTokenId, setSelectedTokenId] = useState<bigint | null>(null);
  const [betLane, setBetLane] = useState<0 | 1 | 2 | 3>(0);
  const [betAmountEth, setBetAmountEth] = useState("");
  const [isMining, setIsMining] = useState(false);
  const [ownedTokenNameById, setOwnedTokenNameById] = useState<Record<string, string>>({});
  const [isLoadingOwnedTokenNames, setIsLoadingOwnedTokenNames] = useState(false);

  const { data: animalRaceContract } = useDeployedContractInfo({ contractName: "AnimalRace" });
  const { data: animalNftContract } = useDeployedContractInfo({ contractName: "AnimalNFT" });

  const { data: ownedTokenIdsData, isLoading: isOwnedTokensLoading } = useScaffoldReadContract({
    contractName: "AnimalNFT",
    functionName: "tokensOfOwner",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress },
  });

  const ownedTokenIds = useMemo(() => {
    const raw = (ownedTokenIdsData as readonly bigint[] | undefined) ?? [];
    // Ensure stable BigInt array (and drop any zeros just in case)
    return raw.map(x => BigInt(x)).filter(x => x !== 0n);
  }, [ownedTokenIdsData]);

  useEffect(() => {
    const run = async () => {
      if (!publicClient) return;
      if (!animalNftContract?.address || !animalNftContract?.abi) return;
      if (ownedTokenIds.length === 0) {
        setOwnedTokenNameById({});
        return;
      }

      setIsLoadingOwnedTokenNames(true);
      try {
        const calls = ownedTokenIds.map(tokenId => ({
          address: animalNftContract.address as `0x${string}`,
          abi: animalNftContract.abi as any,
          functionName: "nameOf",
          args: [tokenId],
        }));

        let res:
          | { result?: string }[]
          | {
              status: "success" | "failure";
              result?: string;
            }[];

        try {
          res = (await publicClient.multicall({
            contracts: calls as any,
            allowFailure: true,
          })) as any;
        } catch {
          const results = await Promise.allSettled(
            ownedTokenIds.map(tokenId =>
              (publicClient as any).readContract({
                address: animalNftContract.address as `0x${string}`,
                abi: animalNftContract.abi as any,
                functionName: "nameOf",
                args: [tokenId],
              }),
            ),
          );
          res = results.map(r =>
            r.status === "fulfilled" ? { status: "success", result: r.value } : { status: "failure" },
          );
        }

        const next: Record<string, string> = {};
        ownedTokenIds.forEach((tokenId, i) => {
          next[tokenId.toString()] = (((res[i] as any)?.result as string | undefined) ?? "").trim();
        });
        setOwnedTokenNameById(next);
      } finally {
        setIsLoadingOwnedTokenNames(false);
      }
    };

    void run();
  }, [publicClient, animalNftContract?.address, animalNftContract?.abi, ownedTokenIds]);

  const { data: ownerAddress } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "owner",
    query: { enabled: !!animalRaceContract },
  });

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

  const { data: raceAnimalsData } = useScaffoldReadContract({
    contractName: "AnimalRace",
    functionName: "getRaceAnimals",
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

  const parsedAnimals = useMemo(() => {
    if (!raceAnimalsData) return null;
    const [assignedCount, tokenIds, originalOwners] = raceAnimalsData;
    return {
      assignedCount: Number(assignedCount as any),
      tokenIds: (tokenIds as readonly bigint[]).map(x => BigInt(x)),
      originalOwners: originalOwners as readonly `0x${string}`[],
    };
  }, [raceAnimalsData]);

  const submissionCloseBlock = useMemo(() => {
    if (!parsed) return null;
    if (parsed.closeBlock < SUBMISSION_CLOSE_OFFSET_BLOCKS) return null;
    return parsed.closeBlock - SUBMISSION_CLOSE_OFFSET_BLOCKS;
  }, [parsed]);

  const status: RaceStatus = useMemo(() => {
    if (!animalRaceContract) return "no_race";
    if (latestRaceId === undefined) return "no_race";
    if (!parsed) return "closed";
    if (parsed.settled) return "settled";
    if (blockNumber === undefined) return "closed";

    if (blockNumber >= parsed.closeBlock) return "closed";
    if (submissionCloseBlock !== null && blockNumber < submissionCloseBlock) return "submissions_open";
    return "betting_open";
  }, [animalRaceContract, latestRaceId, parsed, blockNumber, submissionCloseBlock]);

  const blocksRemainingToBetClose =
    parsed && blockNumber !== undefined && blockNumber < parsed.closeBlock
      ? Number(parsed.closeBlock - blockNumber)
      : 0;

  const blocksRemainingToSubmissionClose =
    submissionCloseBlock !== null && blockNumber !== undefined && blockNumber < submissionCloseBlock
      ? Number(submissionCloseBlock - blockNumber)
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

  const canSubmit = status === "submissions_open";
  const canBet = status === "betting_open";
  const lineupFinalized = (parsedAnimals?.assignedCount ?? 0) === 4;
  const isOwner =
    !!connectedAddress && !!ownerAddress && connectedAddress.toLowerCase() === (ownerAddress as string).toLowerCase();

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

  const mineBlocks = async (count: number) => {
    if (!publicClient) return;
    setIsMining(true);
    try {
      const hexCount = toHex(count);
      // Anvil
      try {
        await publicClient.request({ method: "anvil_mine" as any, params: [hexCount] as any });
        return;
      } catch {
        // Hardhat
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
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl px-6 py-10">
      <div className="card bg-base-200 shadow">
        <div className="card-body gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Mine blocks (local)</div>
            {isMining ? <span className="text-xs opacity-70">Mining…</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm" onClick={() => mineBlocks(1)} disabled={!publicClient || isMining}>
              Mine +1
            </button>
            <button className="btn btn-sm" onClick={() => mineBlocks(10)} disabled={!publicClient || isMining}>
              Mine +10
            </button>
            <button className="btn btn-sm" onClick={() => mineBlocks(50)} disabled={!publicClient || isMining}>
              Mine +50
            </button>
          </div>
          <div className="text-xs opacity-70">
            Uses <span className="font-mono">anvil_mine</span>/<span className="font-mono">hardhat_mine</span> when
            available.
          </div>
        </div>
      </div>

      <div className="card bg-base-200 shadow">
        <div className="card-body gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Owner test helpers</div>
            <div className="text-xs opacity-70">
              {ownerAddress ? (
                <>
                  Owner: <span className="font-mono">{String(ownerAddress)}</span>
                </>
              ) : (
                "Loading owner…"
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-primary"
              disabled={!animalRaceContract || !isOwner}
              onClick={async () => {
                // Calls the helper that auto-sets closeBlock (+20 blocks in the contract).
                await writeAnimalRaceAsync({ functionName: "createRace" } as any);
              }}
            >
              Create Race
            </button>

            <button
              className="btn btn-sm btn-outline"
              disabled={!animalRaceContract || !isOwner || latestRaceId === undefined}
              onClick={async () => {
                if (latestRaceId === undefined) return;
                await writeAnimalRaceAsync({ functionName: "finalizeRaceAnimals", args: [latestRaceId] } as any);
              }}
            >
              Finalize Race Animals
            </button>

            <button
              className="btn btn-sm btn-outline"
              disabled={!animalRaceContract || !isOwner || latestRaceId === undefined}
              onClick={async () => {
                if (latestRaceId === undefined) return;
                await writeAnimalRaceAsync({ functionName: "settleRace", args: [latestRaceId] } as any);
              }}
            >
              Settle Race
            </button>
          </div>

          {!connectedAddress ? (
            <div className="text-xs opacity-70">Connect the owner wallet to use these helpers.</div>
          ) : !isOwner ? (
            <div className="text-xs opacity-70">These helpers are only enabled for the owner address.</div>
          ) : (
            <div className="text-xs opacity-70">
              Finalize/Settle automatically target <span className="font-mono">nextRaceId - 1</span>.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">Giraffe Race</h1>
        <p className="text-base-content/70">
          Player home (prototype): submit an NFT, wait for submissions to close, place a bet, then watch the replay in{" "}
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
                    {status === "submissions_open"
                      ? "Submissions open"
                      : status === "betting_open"
                        ? "Betting open"
                        : status === "settled"
                          ? "Settled"
                          : "Closed"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Current block</span>
                  <span>{blockNumber !== undefined ? blockNumber.toString() : "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Submissions close</span>
                  <span>{submissionCloseBlock !== null ? submissionCloseBlock.toString() : "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Betting closes</span>
                  <span>{parsed.closeBlock.toString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Blocks until submissions close</span>
                  <span>{status === "submissions_open" ? blocksRemainingToSubmissionClose.toString() : "0"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Blocks until betting closes</span>
                  <span>{status === "betting_open" ? blocksRemainingToBetClose.toString() : "0"}</span>
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
                      <div className="mt-1 text-xs opacity-70">
                        {parsedAnimals?.tokenIds?.[lane] && parsedAnimals.tokenIds[lane] !== 0n ? (
                          <>
                            <span className="font-medium">
                              <LaneName tokenId={parsedAnimals.tokenIds[lane]} fallback={`Lane ${lane}`} />
                            </span>{" "}
                            <span className="font-mono">#{parsedAnimals.tokenIds[lane].toString()}</span>
                          </>
                        ) : (
                          <span>Lineup not finalized yet</span>
                        )}
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
              Submit one AnimalNFT you own into the entrant pool (non-custodial). Submissions close, then the lane
              lineup is finalized and shown for betting.
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
                <div className="text-sm opacity-70">You don’t own any AnimalNFTs yet.</div>
              ) : (
                <select
                  className="select select-bordered w-full"
                  value={selectedTokenId?.toString() ?? ""}
                  onChange={e => setSelectedTokenId(e.target.value ? BigInt(e.target.value) : null)}
                >
                  <option value="" disabled>
                    Select an NFT…
                  </option>
                  {ownedTokenIds.map(tokenId => (
                    <option key={tokenId.toString()} value={tokenId.toString()}>
                      {LANE_EMOJI}{" "}
                      {(ownedTokenNameById[tokenId.toString()] || "").trim()
                        ? ownedTokenNameById[tokenId.toString()]
                        : isLoadingOwnedTokenNames
                          ? "Loading…"
                          : "(unnamed)"}{" "}
                      (#{tokenId.toString()})
                    </option>
                  ))}
                </select>
              )}
            </label>

            {selectedTokenId !== null ? (
              <div className="text-xs opacity-70">
                Selected:{" "}
                <span className="font-medium">
                  <LaneName tokenId={selectedTokenId} fallback={`#${selectedTokenId.toString()}`} />
                </span>{" "}
                <span className="font-mono">#{selectedTokenId.toString()}</span>
              </div>
            ) : null}

            <button
              className="btn btn-primary"
              disabled={
                !animalRaceContract ||
                !connectedAddress ||
                !canSubmit ||
                selectedTokenId === null ||
                latestRaceId === undefined
              }
              onClick={async () => {
                if (latestRaceId === undefined) return;
                if (selectedTokenId === null) return;
                await writeAnimalRaceAsync({
                  functionName: "submitAnimal",
                  args: [latestRaceId, selectedTokenId],
                });
                setSelectedTokenId(null);
              }}
            >
              Submit NFT to race
            </button>

            {!canSubmit ? (
              <div className="text-xs opacity-70">Submissions are only available before submissions close.</div>
            ) : null}
          </div>
        </div>

        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <h2 className="card-title">Place a bet</h2>
            <p className="text-sm opacity-70">
              One bet per address per race. Betting opens once the lane lineup is finalized.
            </p>

            {!lineupFinalized ? (
              <div className="alert alert-info">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-medium">Waiting on lane lineup</div>
                  <div className="text-xs opacity-70">
                    After submissions close, anyone can finalize the lineup. Once it’s finalized, you can bet while the
                    betting window is open.
                  </div>
                  <button
                    className="btn btn-sm btn-outline mt-2 self-start"
                    disabled={!animalRaceContract || latestRaceId === undefined || !canBet}
                    onClick={async () => {
                      if (latestRaceId === undefined) return;
                      await writeAnimalRaceAsync({
                        functionName: "finalizeRaceAnimals",
                        args: [latestRaceId],
                      } as any);
                    }}
                  >
                    Finalize lane lineup
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {Array.from({ length: LANE_COUNT }).map((_, lane) => (
                <button
                  key={lane}
                  className={`btn btn-sm ${betLane === lane ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setBetLane(lane as 0 | 1 | 2 | 3)}
                  type="button"
                >
                  {lineupFinalized && parsedAnimals?.tokenIds?.[lane] && parsedAnimals.tokenIds[lane] !== 0n ? (
                    <>
                      {LANE_EMOJI} <LaneName tokenId={parsedAnimals.tokenIds[lane]} fallback={`Lane ${lane}`} />
                    </>
                  ) : (
                    <>
                      Lane {lane} {LANE_EMOJI}
                    </>
                  )}
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
                !canBet ||
                !lineupFinalized ||
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

            {!canBet ? (
              <div className="text-xs opacity-70">
                Betting is only available after submissions close and before betting closes.
              </div>
            ) : !lineupFinalized ? (
              <div className="text-xs opacity-70">Finalize the lane lineup to reveal which NFTs are racing.</div>
            ) : myBet?.hasBet ? (
              <div className="text-xs opacity-70">You already placed a bet for this race.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
