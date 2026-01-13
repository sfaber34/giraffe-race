"use client";

import { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { useAccount, usePublicClient } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";

const LANE_EMOJI = "🦒";

export const AnimalNfts = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });

  const [mintName, setMintName] = useState("");
  const [ownedNfts, setOwnedNfts] = useState<{ tokenId: bigint; name: string }[]>([]);
  const [isLoadingOwnedNfts, setIsLoadingOwnedNfts] = useState(false);

  const { data: animalNftContract } = useDeployedContractInfo({
    contractName: "AnimalNFT",
  });

  const { data: nextTokenId } = useScaffoldReadContract({
    contractName: "AnimalNFT",
    functionName: "nextTokenId",
    query: { enabled: !!animalNftContract },
  });

  const { writeContractAsync: writeAnimalNftAsync } = useScaffoldWriteContract({
    contractName: "AnimalNFT",
  });

  useEffect(() => {
    const run = async () => {
      if (!connectedAddress) {
        setOwnedNfts([]);
        return;
      }
      if (!publicClient) return;
      if (!animalNftContract?.address) return;

      const max = nextTokenId ? BigInt(nextTokenId as any) : 1n;
      const lastMinted = max > 0n ? max - 1n : 0n;
      if (lastMinted === 0n) {
        setOwnedNfts([]);
        return;
      }

      // Keep this bounded for UX + RPC sanity. For local dev, this is plenty.
      const MAX_SCAN = 200n;
      const start = lastMinted > MAX_SCAN ? lastMinted - MAX_SCAN + 1n : 1n;

      setIsLoadingOwnedNfts(true);
      try {
        const ids: bigint[] = [];
        for (let id = start; id <= lastMinted; id++) ids.push(id);

        const ownerCalls = ids.map(id => ({
          address: animalNftContract.address as `0x${string}`,
          abi: animalNftContract.abi as any,
          functionName: "ownerOf",
          args: [id],
        }));

        // Some local chains (Foundry) don't have Multicall3 configured in the chain definition.
        // Fall back to individual reads in that case.
        let owners:
          | { result?: `0x${string}` }[]
          | {
              status: "success" | "failure";
              result?: `0x${string}`;
            }[];

        try {
          owners = (await publicClient.multicall({
            contracts: ownerCalls as any,
            allowFailure: true,
          })) as any;
        } catch {
          const results = await Promise.allSettled(
            ids.map(id =>
              (publicClient as any).readContract({
                address: animalNftContract.address as `0x${string}`,
                abi: animalNftContract.abi as any,
                functionName: "ownerOf",
                args: [id],
              }),
            ),
          );
          owners = results.map(r =>
            r.status === "fulfilled" ? { status: "success", result: r.value } : { status: "failure" },
          );
        }

        const mine: bigint[] = [];
        owners.forEach((res, i) => {
          const owner = (res as any)?.result as `0x${string}` | undefined;
          if (owner && owner.toLowerCase() === connectedAddress.toLowerCase()) {
            mine.push(ids[i] as bigint);
          }
        });

        if (mine.length === 0) {
          setOwnedNfts([]);
          return;
        }

        const nameCalls = mine.map(id => ({
          address: animalNftContract.address as `0x${string}`,
          abi: animalNftContract.abi as any,
          functionName: "nameOf",
          args: [id],
        }));

        let names:
          | { result?: string }[]
          | {
              status: "success" | "failure";
              result?: string;
            }[];

        try {
          names = (await publicClient.multicall({
            contracts: nameCalls as any,
            allowFailure: true,
          })) as any;
        } catch {
          const results = await Promise.allSettled(
            mine.map(id =>
              (publicClient as any).readContract({
                address: animalNftContract.address as `0x${string}`,
                abi: animalNftContract.abi as any,
                functionName: "nameOf",
                args: [id],
              }),
            ),
          );
          names = results.map(r =>
            r.status === "fulfilled" ? { status: "success", result: r.value } : { status: "failure" },
          );
        }

        setOwnedNfts(
          mine.map((tokenId, i) => ({
            tokenId,
            name: (((names[i] as any)?.result as string | undefined) ?? "").trim(),
          })),
        );
      } finally {
        setIsLoadingOwnedNfts(false);
      }
    };

    void run();
  }, [connectedAddress, publicClient, animalNftContract?.address, animalNftContract?.abi, nextTokenId]);

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">NFTs</h1>
        <p className="text-base-content/70">Mint and view your Animal NFTs.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Mint an Animal NFT</h2>
              <div className="text-xs opacity-70">{animalNftContract ? "AnimalNFT deployed" : "Not deployed"}</div>
            </div>

            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">Name</span>
              </div>
              <input
                className="input input-bordered w-full"
                value={mintName}
                onChange={e => setMintName(e.target.value)}
                placeholder="e.g. speedy-bob"
              />
            </label>

            <button
              className="btn btn-primary"
              disabled={!connectedAddress || !animalNftContract || mintName.trim().length === 0}
              onClick={async () => {
                const name = mintName.trim();
                // `mint` is overloaded; cast to avoid TS confusion and let viem pick the correct overload at runtime.
                await (writeAnimalNftAsync as any)({ functionName: "mint", args: [name] });
                setMintName("");
              }}
            >
              Mint
            </button>

            <div className="text-xs opacity-70">
              {connectedAddress ? (
                <>
                  Minting as <Address address={connectedAddress} chain={targetNetwork} />
                </>
              ) : (
                "Connect a wallet to mint."
              )}
            </div>
          </div>
        </div>

        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Your NFTs</h2>
              <div className="text-xs opacity-70">{isLoadingOwnedNfts ? "Loading…" : `${ownedNfts.length} found`}</div>
            </div>

            {!connectedAddress ? (
              <div className="alert alert-info">
                <span className="text-sm">Connect a wallet to see your NFTs.</span>
              </div>
            ) : ownedNfts.length === 0 ? (
              <div className="text-sm opacity-70">No NFTs found (scans the last ~200 tokenIds).</div>
            ) : (
              <div className="flex flex-col gap-2">
                {ownedNfts.map(nft => (
                  <div key={nft.tokenId.toString()} className="rounded-xl bg-base-100 border border-base-300 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">
                        {LANE_EMOJI} {nft.name || "(unnamed)"}
                      </div>
                      <div className="text-xs opacity-70 font-mono">#{nft.tokenId.toString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
