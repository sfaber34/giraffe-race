"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  /**
   * Used to namespace SVG ids (clipPath/mask/etc) so multiple giraffes can be rendered safely.
   * Must be stable for the lifetime of the component instance.
   */
  idPrefix: string;
  /**
   * Controls animation speed without restarting by setting Web Animations API playbackRate.
   * 1 = normal speed, 2 = double speed, 0.5 = half speed.
   */
  playbackRate: number;
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
  // Also add play-state overrides that are driven by CSS variables from the wrapper (fallback).
  const classed = svg.replace(/<svg\b/, `<svg class="giraffe-svg" preserveAspectRatio="xMidYMid meet"`);

  const overrideStyle = `
<style><![CDATA[
svg.giraffe-svg * {
  animation-play-state: var(--giraffe-anim-state, running) !important;
}
]]></style>`;

  // Insert right after opening <svg ...> if possible; otherwise append at the end.
  const insertPoint = classed.indexOf(">");
  if (insertPoint === -1) return classed + overrideStyle;
  return classed.slice(0, insertPoint + 1) + overrideStyle + classed.slice(insertPoint + 1);
}

export function GiraffeAnimated({ idPrefix, playbackRate, playing = true, sizePx = 72, className }: Props) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const animationsRef = useRef<Animation[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await fetchGiraffeSvgText();
      const decoded = decodeEmbeddedCssImport(raw);
      const prefixed = prefixIds(decoded, idPrefix);
      const finalSvg = addRuntimeOverrides(prefixed);
      if (!cancelled) setSvgMarkup(finalSvg);
    })().catch(() => {
      if (!cancelled) setSvgMarkup(null);
    });
    return () => {
      cancelled = true;
    };
  }, [idPrefix]);

  // IMPORTANT: Don't use dangerouslySetInnerHTML in render, because React may re-apply it on every parent re-render,
  // which recreates the SVG subtree and restarts CSS animations. Instead, imperatively set innerHTML only when the
  // markup changes (which should be only when idPrefix changes).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!svgMarkup) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = svgMarkup;
  }, [svgMarkup]);

  // Grab the underlying animations once the SVG is in the DOM so we can adjust playbackRate without restarting.
  useEffect(() => {
    animationsRef.current = [];
    const host = hostRef.current;
    if (!host) return;
    if (!svgMarkup) return;

    let raf = 0;
    let attemptsLeft = 10;

    const tryCapture = () => {
      const svg = host.querySelector("svg.giraffe-svg");
      if (svg) {
        try {
          // subtree:true captures descendant CSS animations too.
          const anims = svg.getAnimations({ subtree: true });
          if (anims.length > 0) {
            animationsRef.current = anims;
            return;
          }
        } catch {
          // ignore and retry
        }
      }

      attemptsLeft -= 1;
      if (attemptsLeft > 0) {
        raf = window.requestAnimationFrame(tryCapture);
      }
    };

    raf = window.requestAnimationFrame(tryCapture);

    return () => {
      window.cancelAnimationFrame(raf);
      animationsRef.current = [];
    };
  }, [svgMarkup]);

  // Apply rate changes without restarting animations.
  useEffect(() => {
    let anims = animationsRef.current;
    if (!anims.length) {
      const host = hostRef.current;
      const svg = host?.querySelector("svg.giraffe-svg");
      if (svg) {
        try {
          anims = svg.getAnimations({ subtree: true });
          animationsRef.current = anims;
        } catch {
          // ignore
        }
      }
    }
    if (!anims.length) return;

    const rate = Number.isFinite(playbackRate) ? Math.max(0, playbackRate) : 1;

    for (const a of anims) {
      try {
        a.playbackRate = rate === 0 ? 0.0001 : rate;
      } catch {
        // ignore
      }
    }
  }, [playbackRate]);

  // Apply play/pause without resetting the timeline.
  useEffect(() => {
    let anims = animationsRef.current;
    if (!anims.length) {
      const host = hostRef.current;
      const svg = host?.querySelector("svg.giraffe-svg");
      if (svg) {
        try {
          anims = svg.getAnimations({ subtree: true });
          animationsRef.current = anims;
        } catch {
          // ignore
        }
      }
    }
    if (!anims.length) return;

    for (const a of anims) {
      try {
        if (!playing) {
          if (a.playState !== "paused") a.pause();
        } else {
          // Only resume if paused/idle; avoid calling play() every tick.
          if (a.playState === "paused" || a.playState === "idle") a.play();
        }
      } catch {
        // ignore
      }
    }
  }, [playing]);

  const wrapperStyle = useMemo(() => {
    return {
      ["--giraffe-anim-state" as any]: playing ? "running" : "paused",
      width: `${sizePx}px`,
      height: `${sizePx}px`,
    } as React.CSSProperties;
  }, [playing, sizePx]);

  if (!svgMarkup) {
    return <div className={className} style={wrapperStyle} aria-hidden="true" />;
  }

  return <div className={className} style={wrapperStyle} ref={hostRef} aria-hidden="true" />;
}
