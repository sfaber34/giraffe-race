import fs from "fs/promises";
import path from "path";
import { keccak256, toHex } from "viem";

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
  const svg = applyBodyColorsFromSeed(svgTemplate, seed);
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
// Seed → colors (match TS logic for body/face highlight)
// -----------------------

function applyBodyColorsFromSeed(svg, seed) {
  // Keep ranges aligned with `utils/nft/giraffePalette.ts`:
  // hue: 0..359, sat: 55..80, light: 42..60, highlight: sat-10, light+18.
  // We derive pseudo-random numbers from the seed with keccak (simple + deterministic).
  const hue = mod(hashU32(seed, "h"), 360);
  const saturation = 55 + mod(hashU32(seed, "s"), 26);
  const lightness = 42 + mod(hashU32(seed, "l"), 19);

  const body = hslToHex(hue, saturation, lightness);
  const face = hslToHex(hue, clampInt(saturation - 10, 0, 100), clampInt(lightness + 18, 0, 100));

  return svg
    .replace(/#e8b84a/gi, body) // default body
    .replace(/#f5d76e/gi, face); // default highlight
}

function hashU32(seed, tag) {
  // Seed is 0x-prefixed hex string.
  const h = keccak256(Buffer.from(`${seed}:${tag}`));
  // take first 4 bytes as u32
  return Number.parseInt(h.slice(2, 10), 16) >>> 0;
}

function mod(n, m) {
  return ((n % m) + m) % m;
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

