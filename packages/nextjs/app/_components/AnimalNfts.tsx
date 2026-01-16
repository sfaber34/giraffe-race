"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [ownedNfts, setOwnedNfts] = useState<{ tokenId: bigint; name: string; readiness: number }[]>([]);
  const [isLoadingOwnedNfts, setIsLoadingOwnedNfts] = useState(false);
  const [isAnimalNftDeployedOnChain, setIsAnimalNftDeployedOnChain] = useState<boolean | null>(null);

  const { data: animalNftContract } = useDeployedContractInfo({
    contractName: "AnimalNFT",
  });

  useEffect(() => {
    const run = async () => {
      if (!publicClient) {
        setIsAnimalNftDeployedOnChain(null);
        return;
      }
      const addr = animalNftContract?.address as `0x${string}` | undefined;
      if (!addr) {
        setIsAnimalNftDeployedOnChain(false);
        return;
      }
      try {
        const bytecode = await publicClient.getBytecode({ address: addr });
        setIsAnimalNftDeployedOnChain(!!bytecode && bytecode !== "0x");
      } catch {
        setIsAnimalNftDeployedOnChain(false);
      }
    };
    void run();
  }, [publicClient, animalNftContract?.address]);

  const { data: nextTokenId } = useScaffoldReadContract({
    contractName: "AnimalNFT",
    functionName: "nextTokenId",
    query: { enabled: !!animalNftContract },
  });

  const { data: ownedTokenIdsData } = useScaffoldReadContract({
    contractName: "AnimalNFT",
    functionName: "tokensOfOwner",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress && !!animalNftContract },
  });

  const ownedTokenIds = useMemo(() => {
    const raw = (ownedTokenIdsData as readonly bigint[] | undefined) ?? [];
    return raw.map(x => BigInt(x)).filter(x => x !== 0n);
  }, [ownedTokenIdsData]);

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

      setIsLoadingOwnedNfts(true);
      try {
        if (ownedTokenIds.length === 0) {
          setOwnedNfts([]);
          return;
        }

        const calls = ownedTokenIds.flatMap(id => [
          {
            address: animalNftContract.address as `0x${string}`,
            abi: animalNftContract.abi as any,
            functionName: "nameOf",
            args: [id],
          },
          {
            address: animalNftContract.address as `0x${string}`,
            abi: animalNftContract.abi as any,
            functionName: "readinessOf",
            args: [id],
          },
        ]);

        let results:
          | { result?: unknown }[]
          | {
              status: "success" | "failure";
              result?: unknown;
            }[];

        try {
          results = (await publicClient.multicall({
            contracts: calls as any,
            allowFailure: true,
          })) as any;
        } catch {
          const settled = await Promise.allSettled(
            ownedTokenIds.flatMap(id => [
              (publicClient as any).readContract({
                address: animalNftContract.address as `0x${string}`,
                abi: animalNftContract.abi as any,
                functionName: "nameOf",
                args: [id],
              }),
              (publicClient as any).readContract({
                address: animalNftContract.address as `0x${string}`,
                abi: animalNftContract.abi as any,
                functionName: "readinessOf",
                args: [id],
              }),
            ]),
          );
          results = settled.map(r =>
            r.status === "fulfilled" ? { status: "success", result: r.value } : { status: "failure" },
          );
        }

        const clampReadiness = (n: number) => Math.max(1, Math.min(10, Math.floor(n)));

        setOwnedNfts(
          ownedTokenIds.map((tokenId, i) => {
            const nameIdx = i * 2;
            const readinessIdx = i * 2 + 1;
            const name = (((results[nameIdx] as any)?.result as string | undefined) ?? "").trim();
            const readinessRaw = (results[readinessIdx] as any)?.result;
            const readiness = clampReadiness(Number(readinessRaw ?? 10));
            return { tokenId, name, readiness };
          }),
        );
      } finally {
        setIsLoadingOwnedNfts(false);
      }
    };

    void run();
  }, [connectedAddress, publicClient, animalNftContract?.address, animalNftContract?.abi, ownedTokenIds, nextTokenId]);

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">NFTs</h1>
        <p className="text-base-content/70">Mint and view your Animal NFTs.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Mint an Animal NFT</h2>
              <div className="text-xs opacity-70">
                {isAnimalNftDeployedOnChain === null
                  ? "Checking deployment…"
                  : isAnimalNftDeployedOnChain
                    ? "AnimalNFT deployed"
                    : "Not deployed"}
              </div>
            </div>

            {isAnimalNftDeployedOnChain === false ? (
              <div className="alert alert-warning">
                <span className="text-sm">
                  AnimalNFT isn’t deployed on the connected network (or you restarted your local chain). Run `yarn
                  deploy` and refresh, or switch networks.
                </span>
              </div>
            ) : null}

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
              disabled={
                !connectedAddress ||
                !animalNftContract ||
                isAnimalNftDeployedOnChain !== true ||
                mintName.trim().length === 0
              }
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
              <div className="text-sm opacity-70">No NFTs found.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {ownedNfts.map(nft => (
                  <div key={nft.tokenId.toString()} className="rounded-xl bg-base-100 border border-base-300 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">
                        {LANE_EMOJI} {nft.name || "(unnamed)"}
                      </div>
                      <div className="text-xs opacity-70">Readiness: {nft.readiness}/10</div>
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
