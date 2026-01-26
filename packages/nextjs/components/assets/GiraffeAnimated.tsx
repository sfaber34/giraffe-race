"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { isHex } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { DEFAULT_GIRAFFE_PALETTE, giraffePaletteFromSeed } from "~~/utils/nft/giraffePalette";

type Props = {
  /**
   * Used to namespace SVG ids (clipPath/mask/etc) so multiple giraffes can be rendered safely.
   * Must be stable for the lifetime of the component instance.
   */
  idPrefix: string;
  /**
   * If provided, we will read `seedOf(tokenId)` from the GiraffeNFT contract and apply seed-based palette rules.
   */
  tokenId?: bigint;
  /**
   * Optional override if you already have the on-chain seed (bytes32 hex). If provided, no on-chain read is done.
   */
  seed?: Hex;
  /**
   * Controls animation speed without restarting by setting Web Animations API playbackRate.
   * 1 = normal speed, 2 = double speed, 0.5 = half speed.
   */
  playbackRate: number;
  /**
   * Increment this to force the SVG animations to jump to t=0 (useful to sync all racers at the start pose).
   */
  resetNonce?: number;
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

function isBytes32Hex(value: unknown): value is Hex {
  return typeof value === "string" && isHex(value) && value.length === 66;
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

export function GiraffeAnimated({
  idPrefix,
  tokenId,
  seed,
  playbackRate,
  resetNonce = 0,
  playing = true,
  sizePx = 72,
  className,
}: Props) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const targetRateRef = useRef(1);
  const currentRateRef = useRef<number | null>(null);
  const rateRafRef = useRef<number | null>(null);
  const rateLastTsRef = useRef<number | null>(null);

  // Determine if we need to fetch the seed from the contract
  const needsSeedFromContract = tokenId !== undefined && tokenId !== 0n && seed === undefined;
  const { data: seedData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "seedOf",
    args: [needsSeedFromContract ? tokenId : undefined],
    query: { enabled: needsSeedFromContract },
  });

  const resolvedSeed = useMemo(() => {
    if (isBytes32Hex(seed)) return seed;
    if (isBytes32Hex(seedData)) return seedData;
    return undefined;
  }, [seed, seedData]);

  // Don't render SVG until we have the seed (when tokenId is provided)
  // This prevents the flash of default colors before the correct palette is applied
  const isWaitingForSeed = needsSeedFromContract && !resolvedSeed;

  useEffect(() => {
    // Don't generate SVG while waiting for seed - prevents FOUC
    if (isWaitingForSeed) {
      setSvgMarkup(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const raw = await fetchGiraffeSvgText();
      const decoded = decodeEmbeddedCssImport(raw);
      const colorized = resolvedSeed
        ? (() => {
            const palette = giraffePaletteFromSeed(resolvedSeed);
            return applyHexReplacements(decoded, {
              [DEFAULT_GIRAFFE_PALETTE.body]: palette.body,
              [DEFAULT_GIRAFFE_PALETTE.faceHighlight]: palette.faceHighlight,
              [DEFAULT_GIRAFFE_PALETTE.spots]: palette.spots,
              [DEFAULT_GIRAFFE_PALETTE.accentDark]: palette.accentDark,
              [DEFAULT_GIRAFFE_PALETTE.legs]: palette.legs,
              [DEFAULT_GIRAFFE_PALETTE.tailStroke]: palette.tailStroke,
              [DEFAULT_GIRAFFE_PALETTE.tailBall]: palette.tailBall,
              [DEFAULT_GIRAFFE_PALETTE.feet]: palette.feet,
              [DEFAULT_GIRAFFE_PALETTE.hornCircles]: palette.hornCircles,
              [DEFAULT_GIRAFFE_PALETTE.eyePupil]: palette.eyePupil,
              [DEFAULT_GIRAFFE_PALETTE.eyeWhite]: palette.eyeWhite,
            });
          })()
        : decoded;
      const prefixed = prefixIds(colorized, idPrefix);
      const finalSvg = addRuntimeOverrides(prefixed);
      if (!cancelled) setSvgMarkup(finalSvg);
    })().catch(() => {
      if (!cancelled) setSvgMarkup(null);
    });
    return () => {
      cancelled = true;
    };
  }, [idPrefix, resolvedSeed, isWaitingForSeed]);

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

            // Ensure a deterministic start pose while we're staging (or if we just mounted).
            // This prevents "random mid-run" frozen poses if we pause shortly after mount.
            for (const a of anims) {
              try {
                a.currentTime = 0;
              } catch {
                // ignore
              }
            }
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

  // Hard reset to t=0 when requested (without recreating the SVG subtree).
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
        a.currentTime = 0;
      } catch {
        // ignore
      }
    }

    // Apply paused/running state after seek, so we "start on the ground" and then take off cleanly.
    for (const a of anims) {
      try {
        if (!playing) {
          a.pause();
        } else {
          a.play();
        }
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  // Apply rate changes without restarting animations.
  useEffect(() => {
    // Treat `playbackRate` as a target and smooth toward it (prevents choppy tick-to-tick speed changes).
    const nextTarget = Number.isFinite(playbackRate) ? Math.max(0, playbackRate) : 1;
    targetRateRef.current = nextTarget;
  }, [playbackRate]);

  // Smoothly apply rate changes via RAF to avoid "snapping" animation speed each tick.
  useEffect(() => {
    // Cancel any in-flight loop.
    if (rateRafRef.current) cancelAnimationFrame(rateRafRef.current);
    rateRafRef.current = null;
    rateLastTsRef.current = null;
    currentRateRef.current = null;

    const RATE_SMOOTH_TIME_MS = 200; // bigger = smoother, smaller = snappier

    const step = (now: number) => {
      const last = rateLastTsRef.current;
      rateLastTsRef.current = now;
      const dt = last === null ? 16 : Math.min(64, Math.max(0, now - last));

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

      if (anims.length) {
        const target = targetRateRef.current;
        const current = currentRateRef.current ?? target;
        const alpha = 1 - Math.exp(-dt / Math.max(1, RATE_SMOOTH_TIME_MS));
        const next = current + (target - current) * alpha;
        currentRateRef.current = next;

        const applied = next <= 0 ? 0.0001 : next;
        for (const a of anims) {
          try {
            a.playbackRate = applied;
          } catch {
            // ignore
          }
        }
      }

      rateRafRef.current = requestAnimationFrame(step);
    };

    rateRafRef.current = requestAnimationFrame(step);

    return () => {
      if (rateRafRef.current) cancelAnimationFrame(rateRafRef.current);
      rateRafRef.current = null;
      rateLastTsRef.current = null;
      currentRateRef.current = null;
    };
  }, [svgMarkup]);

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
      // Force GPU compositing to fix Chrome bug where CSS animations don't start
      // until the page is scrolled. This creates a compositor layer immediately.
      willChange: "transform",
      transform: "translateZ(0)",
    } as React.CSSProperties;
  }, [playing, sizePx]);

  if (!svgMarkup) {
    return <div className={className} style={wrapperStyle} aria-hidden="true" />;
  }

  return <div className={className} style={wrapperStyle} ref={hostRef} aria-hidden="true" />;
}
