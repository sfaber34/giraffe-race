"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { encodePacked, formatUnits, keccak256, toHex } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
  useUsdcContract,
} from "~~/hooks/scaffold-eth";
import { containsProfanity } from "~~/utils/profanityFilter";

const MINT_FEE = 1_000_000n; // 1 USDC (6 decimals)

interface PendingCommit {
  commitId: `0x${string}`;
  name: string;
  commitBlock: bigint;
  minRevealBlock: bigint;
  maxRevealBlock: bigint;
  secret: `0x${string}`;
}

// Helper to generate a random secret
function generateSecret(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes) as `0x${string}`;
}

// Helper to compute commitment from secret
function computeCommitment(secret: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(["bytes32"], [secret]));
}

// Store secrets by name (lowercase) in localStorage
function loadSecrets(address: string): Record<string, `0x${string}`> {
  if (typeof window === "undefined") return {};
  try {
    const data = localStorage.getItem(`giraffe-secrets-${address}`);
    if (!data) return {};
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveSecret(address: string, name: string, secret: `0x${string}`) {
  if (typeof window === "undefined") return;
  const secrets = loadSecrets(address);
  secrets[name.toLowerCase()] = secret;
  localStorage.setItem(`giraffe-secrets-${address}`, JSON.stringify(secrets));
}

function removeSecret(address: string, name: string) {
  if (typeof window === "undefined") return;
  const secrets = loadSecrets(address);
  delete secrets[name.toLowerCase()];
  localStorage.setItem(`giraffe-secrets-${address}`, JSON.stringify(secrets));
}

function getSecret(address: string, name: string): `0x${string}` | undefined {
  const secrets = loadSecrets(address);
  return secrets[name.toLowerCase()];
}

export const GiraffeNfts = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });

  const [mintName, setMintName] = useState("");
  const [ownedNfts, setOwnedNfts] = useState<
    { tokenId: bigint; name: string; zip: number; moxie: number; hustle: number }[]
  >([]);
  const [isLoadingOwnedNfts, setIsLoadingOwnedNfts] = useState(false);
  const [isGiraffeNftDeployedOnChain, setIsGiraffeNftDeployedOnChain] = useState<boolean | null>(null);

  // Commit-reveal state
  const [pendingCommits, setPendingCommits] = useState<PendingCommit[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isRevealing, setIsRevealing] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const { data: blockNumber } = useBlockNumber({ watch: true });

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

  const { data: minRevealBlocks } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "MIN_REVEAL_BLOCKS",
    query: { enabled: !!giraffeNftContract },
  });

  const { writeContractAsync: writeGiraffeNftAsync } = useScaffoldWriteContract({
    contractName: "GiraffeNFT",
  });

  // Read treasury address from GiraffeNFT to check if mint fee is required
  const { data: treasuryAddress } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "treasury",
    query: { enabled: !!giraffeNftContract },
  });

  // Check if mint fee is required (treasury is configured)
  const mintFeeRequired = useMemo(() => {
    return !!(treasuryAddress && treasuryAddress !== "0x0000000000000000000000000000000000000000");
  }, [treasuryAddress]);

  // Get USDC contract info for allowance check (USDC for Base, MockUSDC for local)
  const { data: usdcContract, contractName: usdcContractName } = useUsdcContract();

  // Read user's USDC allowance for GiraffeNFT contract
  const { data: usdcAllowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: usdcContractName as any,
    functionName: "allowance",
    args: [connectedAddress, giraffeNftContract?.address],
    query: {
      enabled: !!connectedAddress && !!giraffeNftContract && !!usdcContract && !!usdcContractName && mintFeeRequired,
    },
  } as any);

  // Check if user has sufficient allowance
  const hasAllowance = useMemo(() => {
    if (!mintFeeRequired) return true;
    if (!usdcAllowance) return false;
    return (usdcAllowance as unknown as bigint) >= MINT_FEE;
  }, [mintFeeRequired, usdcAllowance]);

  // Read user's USDC balance
  const { data: usdcBalance } = useScaffoldReadContract({
    contractName: usdcContractName as any,
    functionName: "balanceOf",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress && !!usdcContract && !!usdcContractName && mintFeeRequired },
  } as any);

  // Check if user has enough USDC balance
  const hasSufficientBalance = useMemo(() => {
    if (!mintFeeRequired) return true;
    if (!usdcBalance) return false;
    return (usdcBalance as unknown as bigint) >= MINT_FEE;
  }, [mintFeeRequired, usdcBalance]);

  // Use dynamic USDC contract name (USDC for Base, MockUSDC for local)
  const { writeContractAsync: writeUsdcAsync } = useScaffoldWriteContract({
    contractName: usdcContractName as any,
  });

  // Fetch pending commits from chain
  const { data: chainPendingCommitIds, refetch: refetchPendingCommits } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "getPendingCommits",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress && !!giraffeNftContract },
  });

  // Build pending commits from chain data + local secrets
  useEffect(() => {
    const fetchCommitDetails = async () => {
      if (!chainPendingCommitIds || !publicClient || !giraffeNftContract?.address || !connectedAddress) {
        setPendingCommits([]);
        return;
      }

      const chainIds = chainPendingCommitIds as readonly `0x${string}`[];
      if (chainIds.length === 0) {
        setPendingCommits([]);
        return;
      }

      const commits: PendingCommit[] = [];

      for (const commitId of chainIds) {
        try {
          const result = await publicClient.readContract({
            address: giraffeNftContract.address as `0x${string}`,
            abi: giraffeNftContract.abi,
            functionName: "getCommit",
            args: [commitId],
          });

          const [, name, commitBlock, , minRevealBlock, maxRevealBlock] = result as [
            string,
            string,
            bigint,
            number,
            bigint,
            bigint,
          ];

          const secret = getSecret(connectedAddress, name);

          commits.push({
            commitId,
            name,
            commitBlock,
            minRevealBlock,
            maxRevealBlock,
            secret: secret ?? ("0x" as `0x${string}`),
          });
        } catch (e) {
          console.error("Failed to fetch commit details:", e);
        }
      }

      setPendingCommits(commits);
    };

    void fetchCommitDetails();
  }, [chainPendingCommitIds, publicClient, giraffeNftContract?.address, giraffeNftContract?.abi, connectedAddress]);

  // Fetch owned NFT details
  useEffect(() => {
    const run = async () => {
      if (!connectedAddress || !publicClient || !giraffeNftContract?.address) {
        setOwnedNfts([]);
        return;
      }

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

        let results: { result?: unknown }[];

        try {
          results = (await publicClient.multicall({ contracts: calls as any, allowFailure: true })) as any;
        } catch {
          const settled = await Promise.allSettled(
            ownedTokenIds.flatMap(id => [
              (publicClient as any).readContract({
                address: giraffeNftContract.address,
                abi: giraffeNftContract.abi,
                functionName: "nameOf",
                args: [id],
              }),
              (publicClient as any).readContract({
                address: giraffeNftContract.address,
                abi: giraffeNftContract.abi,
                functionName: "statsOf",
                args: [id],
              }),
            ]),
          );
          results = settled.map(r => (r.status === "fulfilled" ? { result: r.value } : {}));
        }

        const clampStat = (n: number) => Math.max(1, Math.min(10, Math.floor(n)));

        setOwnedNfts(
          ownedTokenIds.map((tokenId, i) => {
            const name = (((results[i * 2] as any)?.result as string) ?? "").trim();
            const statsRaw = (results[i * 2 + 1] as any)?.result;
            const tuple = (Array.isArray(statsRaw) ? statsRaw : []) as any[];
            return {
              tokenId,
              name,
              zip: clampStat(Number(tuple[0] ?? 10)),
              moxie: clampStat(Number(tuple[1] ?? 10)),
              hustle: clampStat(Number(tuple[2] ?? 10)),
            };
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

  // Validate name for profanity
  const validateName = useCallback((name: string): boolean => {
    if (containsProfanity(name)) {
      setNameError("Name contains inappropriate language. Please choose another name.");
      return false;
    }
    setNameError(null);
    return true;
  }, []);

  // Handle name input change with validation
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      setMintName(newName);
      if (newName.trim()) {
        validateName(newName);
      } else {
        setNameError(null);
      }
    },
    [validateName],
  );

  const handleCommitMint = useCallback(async () => {
    if (!connectedAddress || !mintName.trim()) return;

    const name = mintName.trim();

    // Final validation before commit
    if (!validateName(name)) return;

    setIsCommitting(true);
    try {
      const secret = generateSecret();
      const commitment = computeCommitment(secret);

      // Save secret BEFORE transaction (in case user closes tab during confirmation)
      saveSecret(connectedAddress, name, secret);

      await writeGiraffeNftAsync({
        functionName: "commitMint",
        args: [name, commitment],
      });

      setMintName("");
      setNameError(null);
      setTimeout(() => void refetchPendingCommits(), 1000);
    } catch (error) {
      console.error("Commit failed:", error);
    } finally {
      setIsCommitting(false);
    }
  }, [connectedAddress, mintName, validateName, writeGiraffeNftAsync, refetchPendingCommits]);

  const handleApproveUsdc = useCallback(async () => {
    if (!connectedAddress || !giraffeNftContract?.address) return;

    setIsApproving(true);
    try {
      await (writeUsdcAsync as any)({
        functionName: "approve",
        args: [giraffeNftContract.address, MINT_FEE], // Approve exactly 1 mint
      });
      setTimeout(() => void refetchAllowance(), 1000);
    } catch (error) {
      console.error("Approval failed:", error);
    } finally {
      setIsApproving(false);
    }
  }, [connectedAddress, giraffeNftContract?.address, writeUsdcAsync, refetchAllowance]);

  const handleRevealMint = useCallback(
    async (commit: PendingCommit) => {
      if (!commit || !connectedAddress || commit.secret === "0x") return;

      setIsRevealing(commit.commitId);
      try {
        await writeGiraffeNftAsync({
          functionName: "revealMint",
          args: [commit.commitId, commit.secret],
        });

        removeSecret(connectedAddress, commit.name);
        void refetchPendingCommits();
        // Refetch allowance after reveal since we spent some
        if (mintFeeRequired) {
          setTimeout(() => void refetchAllowance(), 1000);
        }
      } catch (error) {
        console.error("Reveal failed:", error);
      } finally {
        setIsRevealing(null);
      }
    },
    [writeGiraffeNftAsync, connectedAddress, refetchPendingCommits, mintFeeRequired, refetchAllowance],
  );

  const handleCancelCommit = useCallback(
    async (commit: PendingCommit) => {
      if (!commit || !connectedAddress) return;

      setIsCancelling(commit.commitId);
      try {
        await writeGiraffeNftAsync({
          functionName: "cancelCommit",
          args: [commit.commitId],
        });

        removeSecret(connectedAddress, commit.name);
        void refetchPendingCommits();
      } catch (error) {
        console.error("Cancel failed:", error);
      } finally {
        setIsCancelling(null);
      }
    },
    [writeGiraffeNftAsync, connectedAddress, refetchPendingCommits],
  );

  const getCommitStatus = (commit: PendingCommit): "waiting" | "ready" | "expired" => {
    if (!blockNumber) return "waiting";
    if (blockNumber < commit.minRevealBlock) return "waiting";
    if (blockNumber > commit.maxRevealBlock) return "expired";
    return "ready";
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold">Giraffe NFTs</h1>
        <p className="text-base-content/70">Mint and view your Giraffe NFTs.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Mint Card */}
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

            {isGiraffeNftDeployedOnChain === false && (
              <div className="alert alert-warning">
                <span className="text-sm">
                  GiraffeNFT isn&apos;t deployed on the connected network. Run `yarn deploy` and refresh.
                </span>
              </div>
            )}

            <div className="bg-base-100 rounded-lg p-4 text-sm">
              <h3 className="font-semibold mb-2">🔒 Secure Minting</h3>
              <p className="opacity-70">
                Minting uses commit-reveal to prevent gaming. After committing, wait{" "}
                {minRevealBlocks?.toString() ?? "2"} blocks, then reveal to mint your unique giraffe.
              </p>
              {mintFeeRequired && (
                <p className="mt-2 text-primary font-medium">💰 Mint fee: {formatUnits(MINT_FEE, 6)} USDC</p>
              )}
            </div>

            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">Name your Giraffe</span>
              </div>
              <input
                className={`input input-bordered w-full ${nameError ? "input-error" : ""}`}
                value={mintName}
                onChange={handleNameChange}
                placeholder="e.g. speedy-bob"
                maxLength={32}
              />
              <div className="label">
                {nameError ? (
                  <span className="label-text-alt text-error">{nameError}</span>
                ) : (
                  <span className="label-text-alt opacity-70">1-32 characters, must be unique</span>
                )}
              </div>
            </label>

            <button
              className="btn btn-primary"
              disabled={
                !connectedAddress ||
                !giraffeNftContract ||
                isGiraffeNftDeployedOnChain !== true ||
                mintName.trim().length === 0 ||
                !!nameError ||
                isCommitting
              }
              onClick={handleCommitMint}
            >
              {isCommitting ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Committing...
                </>
              ) : (
                "Commit"
              )}
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

        {/* Pending Commits Card */}
        {pendingCommits.length > 0 && (
          <div className="card bg-base-200 shadow">
            <div className="card-body gap-3">
              <div className="flex items-center justify-between">
                <h2 className="card-title">Pending Mints</h2>
                <div className="text-xs opacity-70">Block: {blockNumber?.toString() ?? "..."}</div>
              </div>

              {/* USDC approval status */}
              {mintFeeRequired && (
                <div className={`rounded-lg p-3 text-sm ${hasAllowance ? "bg-success/10" : "bg-warning/10"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      {!hasSufficientBalance ? (
                        <span className="text-error">
                          ❌ Insufficient USDC balance (need {formatUnits(MINT_FEE, 6)} USDC)
                        </span>
                      ) : hasAllowance ? (
                        <span className="text-success">✅ USDC approved for minting</span>
                      ) : (
                        <span className="text-warning">⚠️ Approve USDC before revealing</span>
                      )}
                    </div>
                    {hasSufficientBalance && !hasAllowance && (
                      <button className="btn btn-warning btn-sm" disabled={isApproving} onClick={handleApproveUsdc}>
                        {isApproving ? (
                          <>
                            <span className="loading loading-spinner loading-xs"></span>
                            Approving...
                          </>
                        ) : (
                          "Approve USDC"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3">
                {pendingCommits.map(commit => {
                  const status = getCommitStatus(commit);
                  const blocksUntilReady =
                    status === "waiting" && blockNumber ? Number(commit.minRevealBlock - blockNumber) : 0;
                  const blocksUntilExpiry =
                    status === "ready" && blockNumber ? Number(commit.maxRevealBlock - blockNumber) : 0;
                  const hasSecret = commit.secret !== "0x";
                  const canReveal =
                    status === "ready" && hasSecret && (!mintFeeRequired || (hasAllowance && hasSufficientBalance));

                  return (
                    <div
                      key={commit.commitId}
                      className={`rounded-xl bg-base-100 border px-4 py-3 ${
                        status === "ready" && hasSecret
                          ? "border-success"
                          : status === "expired" || !hasSecret
                            ? "border-error"
                            : "border-base-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{commit.name}</div>
                          <div className="text-xs opacity-70">
                            {status === "waiting" && (
                              <span className="text-warning">⏳ Waiting {blocksUntilReady} more block(s)...</span>
                            )}
                            {status === "ready" && hasSecret && (
                              <>
                                <span className="text-success">✅ Ready to reveal!</span>
                                <span className="ml-2 opacity-50">({blocksUntilExpiry} blocks until expiry)</span>
                              </>
                            )}
                            {status === "ready" && !hasSecret && (
                              <span className="text-error">❌ Secret lost - cancel to start fresh</span>
                            )}
                            {status === "expired" && (
                              <span className="text-error">❌ Expired - cancel to release name</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {status === "ready" && hasSecret && (
                            <button
                              className="btn btn-success btn-sm"
                              disabled={isRevealing === commit.commitId || !canReveal}
                              onClick={() => handleRevealMint(commit)}
                              title={!canReveal && mintFeeRequired ? "Approve USDC first" : undefined}
                            >
                              {isRevealing === commit.commitId ? (
                                <>
                                  <span className="loading loading-spinner loading-xs"></span>
                                  Revealing...
                                </>
                              ) : (
                                `Reveal & Mint${mintFeeRequired ? " (1 USDC)" : ""}`
                              )}
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={isCancelling === commit.commitId}
                            onClick={() => handleCancelCommit(commit)}
                          >
                            {isCancelling === commit.commitId ? (
                              <span className="loading loading-spinner loading-xs"></span>
                            ) : (
                              "Cancel"
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Owned NFTs Card */}
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
                {[...ownedNfts]
                  .sort((a, b) => Number(b.tokenId - a.tokenId))
                  .map(nft => (
                    <div
                      key={nft.tokenId.toString()}
                      className="rounded-xl bg-base-100 border border-base-300 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            <GiraffeAnimated
                              idPrefix={`nft-${nft.tokenId.toString()}`}
                              tokenId={nft.tokenId}
                              playbackRate={1}
                              playing={false}
                              sizePx={96}
                            />
                            <span>{nft.name || "(unnamed)"}</span>
                          </span>
                        </div>
                        <div className="text-xs opacity-70">
                          Zip: {nft.zip}/10 · Moxie: {nft.moxie}/10 · Hustle: {nft.hustle}/10
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
