"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { encodePacked, keccak256, toHex } from "viem";
import { useAccount, useBlockNumber, usePublicClient } from "wagmi";
import { GiraffeAnimated } from "~~/components/assets/GiraffeAnimated";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";

interface PendingCommit {
  commitId: `0x${string}`;
  name: string;
  commitBlock: bigint;
  minRevealBlock: bigint;
  maxRevealBlock: bigint;
  secret: `0x${string}`;
}

// We also store secrets by name (lowercase) so we can match them after chain sync
interface SecretStore {
  [nameLower: string]: `0x${string}`;
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

// Store secrets by name (lowercase) - this persists even if we don't know the commitId yet
function loadSecrets(address: string): SecretStore {
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
    { tokenId: bigint; name: string; readiness: number; conditioning: number; speed: number }[]
  >([]);
  const [isLoadingOwnedNfts, setIsLoadingOwnedNfts] = useState(false);
  const [isGiraffeNftDeployedOnChain, setIsGiraffeNftDeployedOnChain] = useState<boolean | null>(null);

  // Commit-reveal state - built from chain data + locally stored secrets
  const [pendingCommits, setPendingCommits] = useState<PendingCommit[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isRevealing, setIsRevealing] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState<string | null>(null);

  // For showing secret after commit and manual secret entry
  const [lastCommittedSecret, setLastCommittedSecret] = useState<{ name: string; secret: string } | null>(null);
  const [manualSecretInputs, setManualSecretInputs] = useState<Record<string, string>>({});

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

  // Read MIN_REVEAL_BLOCKS and MAX_REVEAL_BLOCKS constants
  const { data: minRevealBlocks } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "MIN_REVEAL_BLOCKS",
    query: { enabled: !!giraffeNftContract },
  });

  const { writeContractAsync: writeGiraffeNftAsync } = useScaffoldWriteContract({
    contractName: "GiraffeNFT",
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

          // Look up the secret by name from localStorage
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

  const handleCommitMint = useCallback(async () => {
    if (!connectedAddress || !mintName.trim()) return;

    setIsCommitting(true);
    setLastCommittedSecret(null);
    try {
      const name = mintName.trim();
      const secret = generateSecret();
      const commitment = computeCommitment(secret);

      // Save the secret by name BEFORE the transaction (in case user closes tab)
      saveSecret(connectedAddress, name, secret);

      await writeGiraffeNftAsync({
        functionName: "commitMint",
        args: [name, commitment],
      });

      // Show the secret to the user so they can save it as backup
      setLastCommittedSecret({ name, secret });
      setMintName("");

      // Refetch pending commits to get the new one from chain
      setTimeout(() => {
        void refetchPendingCommits();
      }, 1000);
    } catch (error) {
      console.error("Commit failed:", error);
      // If commit failed, we could remove the secret, but it's safer to keep it
      // in case the tx was actually sent but we got a timeout error
    } finally {
      setIsCommitting(false);
    }
  }, [connectedAddress, mintName, writeGiraffeNftAsync, refetchPendingCommits]);

  const handleRevealMint = useCallback(
    async (commit: PendingCommit, manualSecret?: string) => {
      if (!commit || !connectedAddress) return;

      // Use manual secret if provided, otherwise use stored secret
      const secretToUse = manualSecret || (commit.secret !== "0x" ? commit.secret : null);

      if (!secretToUse) {
        alert("Please enter your secret to reveal this mint.");
        return;
      }

      setIsRevealing(commit.commitId);
      try {
        await writeGiraffeNftAsync({
          functionName: "revealMint",
          args: [commit.commitId, secretToUse as `0x${string}`],
        });

        // Remove the secret from localStorage and clear manual input
        removeSecret(connectedAddress, commit.name);
        setManualSecretInputs(prev => {
          const updated = { ...prev };
          delete updated[commit.commitId];
          return updated;
        });

        // Refetch pending commits
        void refetchPendingCommits();
      } catch (error) {
        console.error("Reveal failed:", error);
      } finally {
        setIsRevealing(null);
      }
    },
    [writeGiraffeNftAsync, connectedAddress, refetchPendingCommits],
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

        // Remove the secret from localStorage
        removeSecret(connectedAddress, commit.name);

        // Refetch pending commits
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
        <p className="text-base-content/70">Mint and view your Giraffe NFTs using secure commit-reveal.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Mint Card - Commit Phase */}
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
                  GiraffeNFT isn&apos;t deployed on the connected network (or you restarted your local chain). Run `yarn
                  deploy` and refresh, or switch networks.
                </span>
              </div>
            ) : null}

            <div className="bg-base-100 rounded-lg p-4 text-sm">
              <h3 className="font-semibold mb-2">🔒 Secure Minting (Commit-Reveal)</h3>
              <p className="opacity-70 mb-2">To prevent gaming the random seed, minting uses a two-step process:</p>
              <ol className="list-decimal list-inside opacity-70 space-y-1">
                <li>
                  <strong>Commit</strong> – Reserve your giraffe name and lock in your commitment
                </li>
                <li>
                  <strong>Wait</strong> – Wait {minRevealBlocks?.toString() ?? "2"} blocks for randomness
                </li>
                <li>
                  <strong>Reveal</strong> – Complete the mint and receive your unique giraffe
                </li>
              </ol>
            </div>

            <label className="form-control w-full">
              <div className="label">
                <span className="label-text">Name your Giraffe</span>
              </div>
              <input
                className="input input-bordered w-full"
                value={mintName}
                onChange={e => setMintName(e.target.value)}
                placeholder="e.g. speedy-bob"
                maxLength={32}
              />
              <div className="label">
                <span className="label-text-alt opacity-70">1-32 characters, must be unique (case-insensitive)</span>
              </div>
            </label>

            <button
              className="btn btn-primary"
              disabled={
                !connectedAddress ||
                !giraffeNftContract ||
                isGiraffeNftDeployedOnChain !== true ||
                mintName.trim().length === 0 ||
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
                "Step 1: Commit"
              )}
            </button>

            {/* Show secret backup after successful commit */}
            {lastCommittedSecret && (
              <div className="alert alert-success">
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex items-start justify-between">
                    <span className="font-semibold">
                      ✅ Commit successful for &quot;{lastCommittedSecret.name}&quot;!
                    </span>
                    <button className="btn btn-ghost btn-xs" onClick={() => setLastCommittedSecret(null)}>
                      ✕
                    </button>
                  </div>
                  <p className="text-sm opacity-80">
                    Save this secret somewhere safe! You&apos;ll need it to reveal if you switch browsers or clear your
                    data.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-base-100 px-2 py-1 rounded text-xs font-mono break-all">
                      {lastCommittedSecret.secret}
                    </code>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => {
                        navigator.clipboard.writeText(lastCommittedSecret.secret);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            )}

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

              <div className="flex flex-col gap-3">
                {pendingCommits.map(commit => {
                  const status = getCommitStatus(commit);
                  const blocksUntilReady =
                    status === "waiting" && blockNumber ? Number(commit.minRevealBlock - blockNumber) : 0;
                  const blocksUntilExpiry =
                    status === "ready" && blockNumber ? Number(commit.maxRevealBlock - blockNumber) : 0;

                  return (
                    <div
                      key={commit.commitId}
                      className={`rounded-xl bg-base-100 border px-4 py-3 ${
                        status === "ready"
                          ? "border-success"
                          : status === "expired"
                            ? "border-error"
                            : "border-base-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{commit.name}</div>
                          <div className="text-xs opacity-70">
                            {status === "waiting" && (
                              <>
                                <span className="text-warning">⏳ Waiting {blocksUntilReady} more block(s)...</span>
                              </>
                            )}
                            {status === "ready" && (
                              <>
                                <span className="text-success">✅ Ready to reveal!</span>
                                <span className="ml-2 opacity-50">({blocksUntilExpiry} blocks until expiry)</span>
                              </>
                            )}
                            {status === "expired" && (
                              <span className="text-error">❌ Expired - cancel to release name</span>
                            )}
                          </div>
                          {commit.secret === "0x" && status !== "expired" && (
                            <div className="text-xs text-warning mt-1">
                              ⚠️ Secret missing -{" "}
                              {status === "ready"
                                ? "enter it below to reveal, or cancel to start fresh"
                                : "cancel to start fresh if lost"}
                            </div>
                          )}
                          {commit.secret === "0x" && status === "expired" && (
                            <div className="text-xs text-warning mt-1">
                              ⚠️ Secret missing and commit expired - cancel to release the name
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {status === "ready" && commit.secret !== "0x" && (
                            <button
                              className="btn btn-success btn-sm"
                              disabled={isRevealing === commit.commitId}
                              onClick={() => handleRevealMint(commit)}
                            >
                              {isRevealing === commit.commitId ? (
                                <>
                                  <span className="loading loading-spinner loading-xs"></span>
                                  Revealing...
                                </>
                              ) : (
                                "Reveal & Mint"
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

                      {/* Manual secret entry for missing secrets */}
                      {commit.secret === "0x" && status === "ready" && (
                        <div className="mt-3 pt-3 border-t border-base-300">
                          <div className="bg-warning/10 rounded-lg p-3 mb-3">
                            <p className="text-xs text-warning-content">
                              <strong>Lost your secret?</strong> You can <strong>Cancel</strong> this commit to release
                              the name &quot;{commit.name}&quot; and start fresh. Cancelling doesn&apos;t require the
                              secret.
                            </p>
                          </div>
                          <label className="text-xs opacity-70 mb-1 block">Or enter your secret to reveal:</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              className="input input-bordered input-sm flex-1 font-mono text-xs"
                              placeholder="0x..."
                              value={manualSecretInputs[commit.commitId] || ""}
                              onChange={e =>
                                setManualSecretInputs(prev => ({
                                  ...prev,
                                  [commit.commitId]: e.target.value,
                                }))
                              }
                            />
                            <button
                              className="btn btn-success btn-sm"
                              disabled={
                                isRevealing === commit.commitId ||
                                !manualSecretInputs[commit.commitId]?.startsWith("0x")
                              }
                              onClick={() => handleRevealMint(commit, manualSecretInputs[commit.commitId])}
                            >
                              {isRevealing === commit.commitId ? (
                                <>
                                  <span className="loading loading-spinner loading-xs"></span>
                                  Revealing...
                                </>
                              ) : (
                                "Reveal"
                              )}
                            </button>
                          </div>
                        </div>
                      )}
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
