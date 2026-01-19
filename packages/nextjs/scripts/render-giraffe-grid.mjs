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

const items = [];
for (let i = 1; i <= count; i++) {
  const tokenId = BigInt(i);
  const seed = keccak256(toHex(tokenId, { size: 32 }));
  const src = `data:image/svg+xml;base64,${base64(svgTemplate)}`;
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
      .grid { display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); gap: 10px; }
      .cell { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
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

