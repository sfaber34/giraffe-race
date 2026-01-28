import type { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import type { Abi } from "viem";
import { foundry } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";
import { renderRaffeSvg } from "~~/utils/nft/renderRaffeSvg";

export const runtime = "nodejs";

const raffeNftAbi = [
  {
    type: "function",
    name: "seedOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "nameOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "statsOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "readiness", type: "uint8" },
      { name: "conditioning", type: "uint8" },
      { name: "speed", type: "uint8" },
    ],
  },
] as const satisfies Abi;

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(),
});

function parseTokenId(raw: string | undefined): bigint | null {
  if (!raw) return null;
  try {
    const n = BigInt(raw);
    if (n <= 0n) return null;
    return n;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ tokenId: string }> }) {
  const { tokenId: tokenIdParam } = await ctx.params;
  const tokenId = parseTokenId(tokenIdParam);
  if (!tokenId) {
    return Response.json({ error: "Invalid tokenId" }, { status: 400 });
  }

  const chainId = foundry.id;
  const addr = (deployedContracts as any)?.[chainId]?.RaffeNFT?.address as `0x${string}` | undefined;
  if (!addr) {
    return Response.json(
      { error: `RaffeNFT not configured for chainId=${chainId}. Redeploy + regenerate deployedContracts.` },
      { status: 500 },
    );
  }

  try {
    const [seed, mintedName, stats] = await Promise.all([
      publicClient.readContract({
        address: addr,
        abi: raffeNftAbi,
        functionName: "seedOf",
        args: [tokenId],
      }),
      publicClient.readContract({
        address: addr,
        abi: raffeNftAbi,
        functionName: "nameOf",
        args: [tokenId],
      }),
      publicClient.readContract({
        address: addr,
        abi: raffeNftAbi,
        functionName: "statsOf",
        args: [tokenId],
      }),
    ]);

    const [readiness, conditioning, speed] = stats as readonly [number, number, number];

    const svg = await renderRaffeSvg({ tokenId, seed });
    const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

    const nameTrimmed = (mintedName ?? "").trim();
    const displayName = nameTrimmed.length ? nameTrimmed : `Raffe #${tokenId.toString()}`;

    return Response.json(
      {
        name: displayName,
        description: "A raffe racer from Raffe Race. Appearance is derived deterministically from an on-chain seed.",
        image,
        attributes: [
          { trait_type: "tokenId", value: tokenId.toString() },
          { trait_type: "seed", value: seed },
          { trait_type: "readiness", value: readiness },
          { trait_type: "conditioning", value: conditioning },
          { trait_type: "speed", value: speed },
        ],
      },
      {
        headers: {
          // Helps marketplaces cache, while still allowing you to change the baseURI per deployment.
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return Response.json({ error: "Token not found (or contract not deployed on this RPC)" }, { status: 404 });
  }
}
