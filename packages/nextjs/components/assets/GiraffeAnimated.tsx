"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  /**
   * Used to namespace SVG ids (clipPath/mask/etc) so multiple giraffes can be rendered safely.
   * Must be stable for the lifetime of the component instance.
   */
  idPrefix: string;
  /**
   * Controls the CSS animation rate inside the SVG by overriding animation-duration.
   * The original SVG uses ~2000ms as its base duration.
   */
  durationMs: number;
  /**
   * If false, pauses the SVG animation (movement is controlled separately by the race renderer).
   */
  playing?: boolean;
  /**
   * Size in CSS pixels for the rendered SVG (applies to both width and height).
   */
  sizePx?: number;
  className?: string;
};

let giraffeSvgTextPromise: Promise<string> | null = null;

async function fetchGiraffeSvgText(): Promise<string> {
  if (!giraffeSvgTextPromise) {
    giraffeSvgTextPromise = fetch("/giraffe_animated.svg").then(async r => {
      if (!r.ok) throw new Error(`Failed to fetch giraffe SVG: ${r.status}`);
      return await r.text();
    });
  }
  return await giraffeSvgTextPromise;
}

function decodeEmbeddedCssImport(svg: string): string {
  // The exported SVG uses a base64 CSS @import inside <style><![CDATA[ ... ]]></style>.
  // We decode it so we can safely prefix ids (SVGR-style) without dealing with base64 rewriting.
  const re = /@import\s+"data:text\/css;base64,([^"]+)";/;
  const match = svg.match(re);
  if (!match) return svg;

  const base64 = match[1] ?? "";
  let decoded = "";
  try {
    decoded = globalThis.atob(base64);
  } catch {
    return svg; // fall back to original if decode fails
  }

  return svg.replace(re, decoded);
}

function prefixIds(svg: string, prefix: string): string {
  // Collect ids.
  const ids = new Set<string>();
  svg.replace(/\bid="([^"]+)"/g, (_, id: string) => {
    ids.add(id);
    return "";
  });

  if (ids.size === 0) return svg;

  const map = new Map<string, string>();
  for (const id of ids) {
    map.set(id, `${prefix}-${id}`);
  }

  let out = svg;

  // Replace id="..."
  out = out.replace(/\bid="([^"]+)"/g, (full, id: string) => {
    const next = map.get(id);
    return next ? `id="${next}"` : full;
  });

  // Replace url(#...)
  out = out.replace(/url\(#([^)]+)\)/g, (full, id: string) => {
    const next = map.get(id);
    return next ? `url(#${next})` : full;
  });

  // Replace href="#..." and xlink:href="#..."
  out = out.replace(/\b(xlink:href|href)="#([^"]+)"/g, (full, attr: string, id: string) => {
    const next = map.get(id);
    return next ? `${attr}="#${next}"` : full;
  });

  // Replace occurrences of "#id" (CSS selectors, etc). We only replace known ids, using a boundary.
  for (const [id, next] of map.entries()) {
    const re = new RegExp(`#${escapeRegExp(id)}(?![A-Za-z0-9_-])`, "g");
    out = out.replace(re, `#${next}`);
  }

  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addRuntimeOverrides(svg: string): string {
  // Add a class so our override styles can be scoped to this SVG only.
  // Also add duration/play-state overrides that are driven by CSS variables from the wrapper.
  const classed = svg.replace(/<svg\b/, `<svg class="giraffe-svg" preserveAspectRatio="xMidYMid meet"`);

  const overrideStyle = `
<style><![CDATA[
svg.giraffe-svg * {
  animation-duration: var(--giraffe-anim-duration, 2000ms) !important;
  animation-play-state: var(--giraffe-anim-state, running) !important;
}
]]></style>`;

  // Insert right after opening <svg ...> if possible; otherwise append at the end.
  const insertPoint = classed.indexOf(">");
  if (insertPoint === -1) return classed + overrideStyle;
  return classed.slice(0, insertPoint + 1) + overrideStyle + classed.slice(insertPoint + 1);
}

export function GiraffeAnimated({ idPrefix, durationMs, playing = true, sizePx = 72, className }: Props) {
  const [svgInnerHtml, setSvgInnerHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await fetchGiraffeSvgText();
      const decoded = decodeEmbeddedCssImport(raw);
      const prefixed = prefixIds(decoded, idPrefix);
      const finalSvg = addRuntimeOverrides(prefixed);
      if (!cancelled) setSvgInnerHtml(finalSvg);
    })().catch(() => {
      if (!cancelled) setSvgInnerHtml(null);
    });
    return () => {
      cancelled = true;
    };
  }, [idPrefix]);

  const wrapperStyle = useMemo(() => {
    return {
      ["--giraffe-anim-duration" as any]: `${Math.max(50, Math.floor(durationMs))}ms`,

      ["--giraffe-anim-state" as any]: playing ? "running" : "paused",
      width: `${sizePx}px`,
      height: `${sizePx}px`,
    } as React.CSSProperties;
  }, [durationMs, playing, sizePx]);

  if (!svgInnerHtml) {
    return <div className={className} style={wrapperStyle} aria-hidden="true" />;
  }

  return (
    <div
      className={className}
      style={wrapperStyle}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svgInnerHtml }}
    />
  );
}
