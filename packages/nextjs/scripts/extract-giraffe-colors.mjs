import fs from "fs/promises";
import path from "path";

/**
 * Quick helper to inventory hex colors in `public/giraffe_animated.svg`.
 *
 * Usage:
 *   node packages/nextjs/scripts/extract-giraffe-colors.mjs
 */

const svgPath = path.join(process.cwd(), "packages/nextjs/public/giraffe_animated.svg");
const svg = await fs.readFile(svgPath, "utf8");

const re = /#[0-9a-fA-F]{3,8}\b/g;
const counts = new Map();
for (const m of svg.matchAll(re)) {
  const hex = (m[0] ?? "").toLowerCase();
  if (!hex) continue;
  counts.set(hex, (counts.get(hex) ?? 0) + 1);
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Found ${sorted.length} unique hex colors in ${svgPath}`);
for (const [hex, c] of sorted) console.log(`${hex}  ${c}`);
