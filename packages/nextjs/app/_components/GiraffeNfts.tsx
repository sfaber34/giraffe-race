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

export const GiraffeNfts = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });

  const [mintName, setMintName] = useState("");
  const [ownedNfts, setOwnedNfts] = useState<
    { tokenId: bigint; name: string; readiness: number; conditioning: number; speed: number }[]
  >([]);
  const [isLoadingOwnedNfts, setIsLoadingOwnedNfts] = useState(false);
  const [isGiraffeNftDeployedOnChain, setIsGiraffeNftDeployedOnChain] = useState<boolean | null>(null);

  const { data: giraffeNftContract } = useDeployedContractInfo({
    contractName: "GiraffeNFT",
  });

  useEffect(() => {
    const run = async () => {
      if (!publicClient) {
        setIsGiraffeNftDeployedOnChain(null);
        return;
      }
      const addr = giraffeNftContract?.address as `0x${string}` | undefined;
      if (!addr) {
        setIsGiraffeNftDeployedOnChain(false);
        return;
      }
      try {
        const bytecode = await publicClient.getBytecode({ address: addr });
        setIsGiraffeNftDeployedOnChain(!!bytecode && bytecode !== "0x");
      } catch {
        setIsGiraffeNftDeployedOnChain(false);
      }
    };
    void run();
  }, [publicClient, giraffeNftContract?.address]);

  const { data: nextTokenId } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "nextTokenId",
    query: { enabled: !!giraffeNftContract },
  });

  const { data: ownedTokenIdsData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "tokensOfOwner",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress && !!giraffeNftContract },
  });

  const ownedTokenIds = useMemo(() => {
    const raw = (ownedTokenIdsData as readonly bigint[] | undefined) ?? [];
    return raw.map(x => BigInt(x)).filter(x => x !== 0n);
  }, [ownedTokenIdsData]);

  const { writeContractAsync: writeGiraffeNftAsync } = useScaffoldWriteContract({
    contractName: "GiraffeNFT",
  });

  useEffect(() => {
    const run = async () => {
      if (!connectedAddress) {
        setOwnedNfts([]);
        return;
      }
      if (!publicClient) return;
      if (!giraffeNftContract?.address) return;

      setIsLoadingOwnedNfts(true);
      try {
        if (ownedTokenIds.length === 0) {
          setOwnedNfts([]);
          return;
        }

        const calls = ownedTokenIds.flatMap(id => [
          {
            address: giraffeNftContract.address as `0x${string}`,
            abi: giraffeNftContract.abi as any,
            functionName: "nameOf",
            args: [id],
          },
          {
            address: giraffeNftContract.address as `0x${string}`,
            abi: giraffeNftContract.abi as any,
            functionName: "statsOf",
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
                address: giraffeNftContract.address as `0x${string}`,
                abi: giraffeNftContract.abi as any,
                functionName: "nameOf",
                args: [id],
              }),
              (publicClient as any).readContract({
                address: giraffeNftContract.address as `0x${string}`,
                abi: giraffeNftContract.abi as any,
                functionName: "statsOf",
                args: [id],
              }),
            ]),
          );
          results = settled.map(r =>
            r.status === "fulfilled" ? { status: "success", result: r.value } : { status: "failure" },
          );
        }

        const clampStat = (n: number) => Math.max(1, Math.min(10, Math.floor(n)));

        setOwnedNfts(
          ownedTokenIds.map((tokenId, i) => {
            const nameIdx = i * 2;
            const statsIdx = i * 2 + 1;
            const name = (((results[nameIdx] as any)?.result as string | undefined) ?? "").trim();
            const statsRaw = (results[statsIdx] as any)?.result;
            const tuple = (Array.isArray(statsRaw) ? statsRaw : []) as any[];
            const readiness = clampStat(Number(tuple[0] ?? 10));
            const conditioning = clampStat(Number(tuple[1] ?? 10));
            const speed = clampStat(Number(tuple[2] ?? 10));
            return { tokenId, name, readiness, conditioning, speed };
          }),
        );
      } finally {
        setIsLoadingOwnedNfts(false);
      }
    };

    void run();
  }, [
    connectedAddress,
    publicClient,
    giraffeNftContract?.address,
    giraffeNftContract?.abi,
    ownedTokenIds,
    nextTokenId,
  ]);

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">Giraffe NFTs</h1>
        <p className="text-base-content/70">Mint and view your Giraffe NFTs.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-3">
            <div className="flex items-center justify-between">
              <h2 className="card-title">Mint a Giraffe NFT</h2>
              <div className="text-xs opacity-70">
                {isGiraffeNftDeployedOnChain === null
                  ? "Checking deployment…"
                  : isGiraffeNftDeployedOnChain
                    ? "GiraffeNFT deployed"
                    : "Not deployed"}
              </div>
            </div>

            {isGiraffeNftDeployedOnChain === false ? (
              <div className="alert alert-warning">
                <span className="text-sm">
                  GiraffeNFT isn’t deployed on the connected network (or you restarted your local chain). Run `yarn
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
                !giraffeNftContract ||
                isGiraffeNftDeployedOnChain !== true ||
                mintName.trim().length === 0
              }
              onClick={async () => {
                const name = mintName.trim();
                // `mint` is overloaded; cast to avoid TS confusion and let viem pick the correct overload at runtime.
                await (writeGiraffeNftAsync as any)({ functionName: "mint", args: [name] });
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
              <h2 className="card-title">Your Giraffe NFTs</h2>
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
                      <div className="text-xs opacity-70">
                        Readiness: {nft.readiness}/10 · Conditioning: {nft.conditioning}/10 · Speed: {nft.speed}/10
                      </div>
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
