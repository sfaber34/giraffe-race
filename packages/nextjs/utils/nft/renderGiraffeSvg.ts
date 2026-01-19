import { readFile } from "fs/promises";
import path from "path";
import type { Hex } from "viem";
import { encodePacked, keccak256 } from "viem";
import { DeterministicDice } from "~~/utils/race/deterministicDice";

let templatePromise: Promise<string> | null = null;

async function loadTemplate(): Promise<string> {
  if (!templatePromise) {
    const svgPath = path.join(process.cwd(), "public", "giraffe_animated.svg");
    templatePromise = readFile(svgPath, "utf8");
  }
  return await templatePromise;
}

export type RenderGiraffeSvgParams = {
  tokenId: bigint;
  seed: Hex;
};

/**
 * Server-side giraffe SVG renderer.
 *
 * Today: returns the existing `/public/giraffe_animated.svg` unchanged (so all renders look identical),
 * but still runs a deterministic dice stream from the on-chain seed so color rules can be added later
 * without changing the randomness plumbing.
 *
 * Future: replace selected `fill="#..."` values directly (marketplace-friendly) using palette rules.
 */
export async function renderGiraffeSvg({ tokenId, seed }: RenderGiraffeSvgParams): Promise<string> {
  // Deterministic roll stream is derived from the on-chain seed.
  // We "touch" the stream today so the wiring is exercised; values are unused until palette rules exist.
  const dice = new DeterministicDice(seed);
  const _debugRoll = dice.roll(10_000n);

  // Example of a stable, namespaced secondary seed (useful if you later want separate streams).
  // Keep this deterministic across JS/Solidity by hashing packed bytes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _paletteSeed = keccak256(
    encodePacked(["bytes32", "uint256", "uint256", "string"], [seed, tokenId, _debugRoll, "GIRAFFE_PALETTE_V1"]),
  );

  return await loadTemplate();
}
