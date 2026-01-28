import { readFile } from "fs/promises";
import path from "path";
import type { Hex } from "viem";
import { encodePacked, keccak256 } from "viem";
import { DEFAULT_RAFFE_PALETTE, raffePaletteFromSeed } from "~~/utils/nft/raffePalette";
import { DeterministicDice } from "~~/utils/race/deterministicDice";

let templatePromise: Promise<string> | null = null;

async function loadTemplate(): Promise<string> {
  if (!templatePromise) {
    const svgPath = path.join(process.cwd(), "public", "raffe_animated.svg");
    templatePromise = readFile(svgPath, "utf8");
  }
  return await templatePromise;
}

export type RenderRaffeSvgParams = {
  tokenId: bigint;
  seed: Hex;
};

/**
 * Server-side raffe SVG renderer.
 *
 * Today: returns the existing `/public/raffe_animated.svg` unchanged (so all renders look identical),
 * but still runs a deterministic dice stream from the on-chain seed so color rules can be added later
 * without changing the randomness plumbing.
 *
 * Future: replace selected `fill="#..."` values directly (marketplace-friendly) using palette rules.
 */
export async function renderRaffeSvg({ tokenId, seed }: RenderRaffeSvgParams): Promise<string> {
  // Deterministic roll stream is derived from the on-chain seed.
  // We "touch" the stream today so the wiring is exercised; values are unused until palette rules exist.
  const dice = new DeterministicDice(seed);
  const _debugRoll = dice.roll(10_000n);

  // Example of a stable, namespaced secondary seed (useful if you later want separate streams).
  // Keep this deterministic across JS/Solidity by hashing packed bytes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _paletteSeed = keccak256(
    encodePacked(["bytes32", "uint256", "uint256", "string"], [seed, tokenId, _debugRoll, "RAFFE_PALETTE_V1"]),
  );

  const svg = await loadTemplate();

  // Palette rules live here. For now, `raffePaletteFromSeed()` returns defaults, so output is unchanged.
  const palette = raffePaletteFromSeed(seed);

  // Map "old" (template) colors -> "new" (palette) colors.
  // This keeps the first iteration extremely simple (direct fill/stroke replacement).
  const replacements: Record<string, string> = {
    [DEFAULT_RAFFE_PALETTE.body]: palette.body,
    [DEFAULT_RAFFE_PALETTE.faceHighlight]: palette.faceHighlight,
    [DEFAULT_RAFFE_PALETTE.legs]: palette.legs,
    [DEFAULT_RAFFE_PALETTE.tailStroke]: palette.tailStroke,
    [DEFAULT_RAFFE_PALETTE.tailBall]: palette.tailBall,
    [DEFAULT_RAFFE_PALETTE.spots]: palette.spots,
    [DEFAULT_RAFFE_PALETTE.accentDark]: palette.accentDark,
    [DEFAULT_RAFFE_PALETTE.feet]: palette.feet,
    [DEFAULT_RAFFE_PALETTE.hornCircles]: palette.hornCircles,
    [DEFAULT_RAFFE_PALETTE.eyePupil]: palette.eyePupil,
    [DEFAULT_RAFFE_PALETTE.eyeWhite]: palette.eyeWhite,
  };

  return applyHexReplacements(svg, replacements);
}

function applyHexReplacements(svg: string, replacements: Record<string, string>): string {
  let out = svg;
  for (const [from, to] of Object.entries(replacements)) {
    if (!from || !to) continue;
    if (from.toLowerCase() === to.toLowerCase()) continue;
    // Negative lookahead (?![0-9a-fA-F]) prevents short hex colors like #223
    // from matching inside longer colors like #2234bf
    out = out.replace(new RegExp(escapeRegExp(from) + "(?![0-9a-fA-F])", "gi"), to);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
