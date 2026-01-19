import type { Hex } from "viem";
import { DeterministicDice } from "~~/utils/race/deterministicDice";

/**
 * Color slots for the giraffe SVG.
 *
 * IMPORTANT: these values are intentionally the current/default SVG colors so rendering is unchanged until
 * you start iterating on palette rules.
 *
 * The initial SVG uses these notable colors (from `public/giraffe_animated.svg`):
 * - #e8b84a: body / head base
 * - #f5d76e: lighter face highlight
 * - #b8862f: legs / tail base
 * - #c4923a: spots + some accents
 * - #8b6914: darker accents (brow/horn rectangle in places)
 * - #4e342e / #5d4037: feet + some facial features / horn circles
 * - #222: eye pupil
 * - #fff: eye white + highlights
 */

export type GiraffePalette = {
  body: string;
  faceHighlight: string;
  legs: string;
  spots: string;
  accentDark: string;
  feet: string;
  hornCircles: string;
  eyePupil: string;
  eyeWhite: string;
};

export const DEFAULT_GIRAFFE_PALETTE: GiraffePalette = {
  body: "#e8b84a",
  faceHighlight: "#f5d76e",
  legs: "#b8862f",
  spots: "#c4923a",
  accentDark: "#8b6914",
  feet: "#4e342e",
  hornCircles: "#5d4037",
  eyePupil: "#222",
  eyeWhite: "#fff",
};

/**
 * Derive a palette from an on-chain seed.
 *
 * First iteration:
 * - body: random-but-bounded HSL color from seed
 * - faceHighlight: lighter, slightly less saturated shade of body (same hue)
 * - everything else: defaults for now
 */
export function giraffePaletteFromSeed(seed: Hex): GiraffePalette {
  const dice = new DeterministicDice(seed);

  // Bounded HSL to avoid extreme neon/dark colors.
  const hue = Number(dice.roll(360n)); // 0..359
  const saturation = 55 + Number(dice.roll(26n)); // 55..80
  const lightness = 42 + Number(dice.roll(19n)); // 42..60

  const body = hslToHex({ h: hue, s: saturation, l: lightness });
  const faceHighlight = hslToHex({
    h: hue,
    s: clampInt(saturation - 10, 0, 100),
    l: clampInt(lightness + 18, 0, 100),
  });

  // Spots should contrast body but still feel "related":
  // - mostly analogous hue shift (small offset)
  // - occasionally a stronger contrasting hue shift
  // - a bit more saturated
  // - noticeably darker
  //
  // Option B: weighted mode
  // - 85%: analogous (±25°)
  // - 15%: contrasting (+120..+180°)
  const modePick = Number(dice.roll(100n)); // 0..99
  const spotsHue =
    modePick < 85
      ? modHue(hue + (Number(dice.roll(51n)) - 25)) // -25..+25
      : modHue(hue + 120 + Number(dice.roll(61n))); // +120..+180

  const spotsSatBump = 5 + Number(dice.roll(11n)); // +5..+15
  const spotsDarken = 10 + Number(dice.roll(9n)); // -10..-18
  const spots = hslToHex({
    h: spotsHue,
    // If we're in the contrasting mode, cap saturation a bit so it doesn't go neon.
    s: clampInt(saturation + spotsSatBump - (modePick < 85 ? 0 : 12), 0, 100),
    l: clampInt(lightness - spotsDarken, 0, 100),
  });

  // Accent-dark is used by the small rounded-rect "neck accents" (and some line accents).
  // Keep it in the same hue family, but push it darker than spots for visual hierarchy.
  const accentDark = hslToHex({
    h: spotsHue,
    s: clampInt(saturation + Math.max(0, spotsSatBump - 5) - (modePick < 85 ? 0 : 12), 0, 100),
    l: clampInt(lightness - (spotsDarken + 12), 0, 100),
  });

  // Legs/feet: analogous to body hue (NOT spot rules).
  // We want them to feel like the same character, but with some variation and a darker value range.
  const legsHue = modHue(hue + (Number(dice.roll(31n)) - 15)); // -15..+15
  const legsSatDelta = Number(dice.roll(13n)); // 0..12
  const legsDarken = 8 + Number(dice.roll(11n)); // -8..-18
  const legs = hslToHex({
    h: legsHue,
    s: clampInt(saturation - legsSatDelta, 0, 100),
    l: clampInt(lightness - legsDarken, 0, 100),
  });

  const feetHue = modHue(hue + (Number(dice.roll(21n)) - 10)); // -10..+10
  const feetSatDelta = 8 + Number(dice.roll(13n)); // 8..20
  const feetDarken = 22 + Number(dice.roll(13n)); // -22..-34
  const feet = hslToHex({
    h: feetHue,
    s: clampInt(saturation - feetSatDelta, 0, 100),
    l: clampInt(lightness - feetDarken, 0, 100),
  });

  // Horn circles/extra dark accents: close to feet but slightly different for separation.
  const hornCircles = hslToHex({
    h: feetHue,
    s: clampInt(saturation - (feetSatDelta + 6), 0, 100),
    l: clampInt(lightness - (feetDarken - 6), 0, 100),
  });

  return {
    ...DEFAULT_GIRAFFE_PALETTE,
    body,
    faceHighlight,
    spots,
    accentDark,
    legs,
    feet,
    hornCircles,
  };
}

type Hsl = { h: number; s: number; l: number };

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function modHue(h: number): number {
  const x = h % 360;
  return x < 0 ? x + 360 : x;
}

function hslToHex({ h, s, l }: Hsl): string {
  const { r, g, b } = hslToRgb({ h, s, l });
  return rgbToHex({ r, g, b });
}

type Rgb = { r: number; g: number; b: number };

// HSL in [0..360), [0..100], [0..100]
function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const ss = clampInt(s, 0, 100) / 100;
  const ll = clampInt(l, 0, 100) / 100;

  if (ss === 0) {
    const v = Math.round(ll * 255);
    return { r: v, g: v, b: v };
  }

  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;

  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (hh < 60) {
    rp = c;
    gp = x;
  } else if (hh < 120) {
    rp = x;
    gp = c;
  } else if (hh < 180) {
    gp = c;
    bp = x;
  } else if (hh < 240) {
    gp = x;
    bp = c;
  } else if (hh < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const rr = clampInt(r, 0, 255).toString(16).padStart(2, "0");
  const gg = clampInt(g, 0, 255).toString(16).padStart(2, "0");
  const bb = clampInt(b, 0, 255).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}
