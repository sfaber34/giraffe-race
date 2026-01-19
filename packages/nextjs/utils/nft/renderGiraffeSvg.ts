import { readFile } from "fs/promises";
import path from "path";
import type { Hex } from "viem";
import { encodePacked, keccak256 } from "viem";
import { DEFAULT_GIRAFFE_PALETTE, giraffePaletteFromSeed } from "~~/utils/nft/giraffePalette";
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

  const svg = await loadTemplate();

  // Palette rules live here. For now, `giraffePaletteFromSeed()` returns defaults, so output is unchanged.
  const palette = giraffePaletteFromSeed(seed);

  // Map "old" (template) colors -> "new" (palette) colors.
  // This keeps the first iteration extremely simple (direct fill/stroke replacement).
  const replacements: Record<string, string> = {
    [DEFAULT_GIRAFFE_PALETTE.body]: palette.body,
    [DEFAULT_GIRAFFE_PALETTE.faceHighlight]: palette.faceHighlight,
    [DEFAULT_GIRAFFE_PALETTE.legs]: palette.legs,
    [DEFAULT_GIRAFFE_PALETTE.spots]: palette.spots,
    [DEFAULT_GIRAFFE_PALETTE.accentDark]: palette.accentDark,
    [DEFAULT_GIRAFFE_PALETTE.feet]: palette.feet,
    [DEFAULT_GIRAFFE_PALETTE.hornCircles]: palette.hornCircles,
    [DEFAULT_GIRAFFE_PALETTE.eyePupil]: palette.eyePupil,
    [DEFAULT_GIRAFFE_PALETTE.eyeWhite]: palette.eyeWhite,
  };

  return applyHexReplacements(svg, replacements);
}

function applyHexReplacements(svg: string, replacements: Record<string, string>): string {
  let out = svg;
  for (const [from, to] of Object.entries(replacements)) {
    if (!from || !to) continue;
    if (from.toLowerCase() === to.toLowerCase()) continue;
    out = out.replace(new RegExp(escapeRegExp(from), "gi"), to);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
