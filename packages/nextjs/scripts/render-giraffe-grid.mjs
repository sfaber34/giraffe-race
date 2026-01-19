import fs from "fs/promises";
import path from "path";
import { hexToBytes, keccak256, toHex } from "viem";

// -----------------------
// Deterministic dice (matches TS + Solidity)
// -----------------------

class DeterministicDice {
  constructor(seed) {
    this.entropy = hexToBytes(seed);
    this.position = 0; // nibble position 0..63
  }

  roll(n) {
    if (n <= 0n) throw new Error("DeterministicDice: n must be > 0");
    const bitsNeeded = ceilLog2(n);
    let hexCharsNeeded = Number((bitsNeeded + 3n) / 4n);
    if (hexCharsNeeded === 0) hexCharsNeeded = 1;

    const maxValue = 16n ** BigInt(hexCharsNeeded);
    const threshold = maxValue - (maxValue % n);

    let value;
    do {
      value = this.consumeNibbles(hexCharsNeeded);
    } while (value >= threshold);

    return value % n;
  }

  consumeNibbles(count) {
    let value = 0n;
    for (let i = 0; i < count; i++) {
      if (this.position >= 64) {
        this.entropy = hexToBytes(keccak256(this.entropy));
        this.position = 0;
      }
      const nibble = getNibble(this.entropy, this.position);
      value = (value << 4n) + BigInt(nibble);
      this.position++;
    }
    return value;
  }
}

function getNibble(bytes, pos) {
  const byteIndex = Math.floor(pos / 2);
  const byteValue = bytes[byteIndex] ?? 0;
  return pos % 2 === 0 ? byteValue >> 4 : byteValue & 0x0f;
}

function ceilLog2(n) {
  if (n <= 1n) return 0n;
  let result = 0n;
  let temp = n - 1n;
  while (temp > 0n) {
    result++;
    temp >>= 1n;
  }
  return result;
}

/**
 * Generates a simple HTML grid of 1k giraffe SVGs for palette iteration.
 *
 * Today: all SVGs are identical because the renderer hasn't applied palette rules yet.
 * We still generate distinct seeds to make it easy to switch to seed-based coloring later.
 *
 * Usage:
 *   node packages/nextjs/scripts/render-giraffe-grid.mjs
 *   node packages/nextjs/scripts/render-giraffe-grid.mjs --count 1000 --cols 20
 */

function parseArgs(argv) {
  const out = { count: 1000, cols: 20, out: "packages/nextjs/generated/giraffe-grid.html" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count") out.count = Number(argv[++i]);
    else if (a === "--cols") out.cols = Number(argv[++i]);
    else if (a === "--out") out.out = String(argv[++i]);
  }
  out.count = Number.isFinite(out.count) ? Math.max(1, Math.floor(out.count)) : 1000;
  out.cols = Number.isFinite(out.cols) ? Math.max(1, Math.floor(out.cols)) : 20;
  return out;
}

function base64(s) {
  return Buffer.from(s, "utf8").toString("base64");
}

const { count, cols, out } = parseArgs(process.argv.slice(2));

const templatePath = path.join(process.cwd(), "packages/nextjs/public/giraffe_animated.svg");
const svgTemplate = await fs.readFile(templatePath, "utf8");

const SIZE = 192;
const CELL_W = SIZE + 32;

const items = [];
for (let i = 1; i <= count; i++) {
  const tokenId = BigInt(i);
  const seed = keccak256(toHex(tokenId, { size: 32 }));
  const svg = applyPaletteFromSeed(makeStaticSvg(svgTemplate), seed);
  const src = `data:image/svg+xml;base64,${base64(svg)}`;
  items.push(`
    <div class="cell" title="tokenId=${tokenId} seed=${seed}">
      <img src="${src}" width="${SIZE}" height="${SIZE}" alt="giraffe ${tokenId}" />
      <div class="meta">#${tokenId}</div>
    </div>
  `);
}

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Giraffe Grid (${count})</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background: #0b1020; color: #e6e6e6; }
      .wrap { padding: 16px; }
      .hint { opacity: 0.7; margin-bottom: 12px; font-size: 12px; }
      .grid { display: grid; grid-template-columns: repeat(${cols}, ${CELL_W}px); gap: 12px; justify-content: start; }
      .cell { width: ${CELL_W}px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; overflow: hidden; }
      img { display: block; width: ${SIZE}px; height: ${SIZE}px; }
      .meta { font-size: 11px; opacity: 0.75; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="hint">
        ${count} samples. Today all images are identical (palette rules not applied yet), but each cell has a distinct seed in its tooltip.
      </div>
      <div class="grid">
        ${items.join("\n")}
      </div>
    </div>
  </body>
</html>`;

const outPath = path.join(process.cwd(), out);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, html, "utf8");
console.log(`Wrote ${outPath}`);

// -----------------------
// Seed → colors (match TS logic via DeterministicDice)
// -----------------------

function applyPaletteFromSeed(svg, seed) {
  // Keep ranges aligned with `utils/nft/giraffePalette.ts`:
  // hue: roll(360), sat: 55+roll(26), light: 42+roll(19)
  const dice = new DeterministicDice(seed);
  const hue = Number(dice.roll(360n)); // 0..359
  const saturation = 55 + Number(dice.roll(26n)); // 55..80
  const lightness = 42 + Number(dice.roll(19n)); // 42..60

  const body = hslToHex(hue, saturation, lightness);
  const face = hslToHex(hue, clampInt(saturation - 10, 0, 100), clampInt(lightness + 18, 0, 100));

  // Spots: same hue, more saturated, darker (matches TS).
  const spotsSatBump = 5 + Number(dice.roll(11n)); // +5..+15
  const spotsDarken = 10 + Number(dice.roll(9n)); // -10..-18
  const spots = hslToHex(hue, clampInt(saturation + spotsSatBump, 0, 100), clampInt(lightness - spotsDarken, 0, 100));

  const accentDark = hslToHex(
    hue,
    clampInt(saturation + Math.max(0, spotsSatBump - 5), 0, 100),
    clampInt(lightness - (spotsDarken + 12), 0, 100),
  );

  return svg
    .replace(/#e8b84a/gi, body) // default body
    .replace(/#f5d76e/gi, face) // default highlight
    .replace(/#c4923a/gi, spots) // default spots / accents
    .replace(/#8b6914/gi, accentDark); // neck accent rounded-rects + other dark accents
}

function clampInt(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function hslToHex(h, s, l) {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

function hslToRgb(h, s, l) {
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

function rgbToHex(r, g, b) {
  const rr = clampInt(r, 0, 255).toString(16).padStart(2, "0");
  const gg = clampInt(g, 0, 255).toString(16).padStart(2, "0");
  const bb = clampInt(b, 0, 255).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}

function makeStaticSvg(svg) {
  // Disable CSS animations in the embedded SVG so the grid is a stable “thumbnail sheet”.
  const style = `<style><![CDATA[
svg * { animation: none !important; animation-play-state: paused !important; }
]]></style>`;
  const i = svg.indexOf(">");
  if (i === -1) return svg + style;
  return svg.slice(0, i + 1) + style + svg.slice(i + 1);
}
