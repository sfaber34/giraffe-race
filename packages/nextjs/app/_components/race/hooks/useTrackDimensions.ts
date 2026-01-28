import { useCallback, useEffect, useState } from "react";

// Default values (match mobile CSS)
const DEFAULTS = {
  trackHeight: 328,
  trackBaseY: 164,
  trackVerticalSpread: 198,
  giraffeSize: 100,
  worldPaddingLeft: 100,
  cameraStartX: 0,
};

export interface TrackDimensions {
  trackHeight: number;
  trackBaseY: number;
  trackVerticalSpread: number;
  giraffeSize: number;
  worldPaddingLeft: number;
  cameraStartX: number;
}

/**
 * Hook to read responsive track dimensions from CSS custom properties.
 * Single source of truth: CSS defines the breakpoints, JS reads the values.
 */
export function useTrackDimensions(): TrackDimensions {
  const [dimensions, setDimensions] = useState<TrackDimensions>(DEFAULTS);

  const readDimensions = useCallback(() => {
    if (typeof window === "undefined") return DEFAULTS;

    const styles = getComputedStyle(document.documentElement);

    const parseVar = (name: string, fallback: number): number => {
      const value = styles.getPropertyValue(name).trim();
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? fallback : parsed;
    };

    return {
      trackHeight: parseVar("--track-height", DEFAULTS.trackHeight),
      trackBaseY: parseVar("--track-base-y", DEFAULTS.trackBaseY),
      trackVerticalSpread: parseVar("--track-vertical-spread", DEFAULTS.trackVerticalSpread),
      giraffeSize: parseVar("--giraffe-size", DEFAULTS.giraffeSize),
      worldPaddingLeft: parseVar("--world-padding-left", DEFAULTS.worldPaddingLeft),
      cameraStartX: parseVar("--camera-start-x", DEFAULTS.cameraStartX),
    };
  }, []);

  useEffect(() => {
    // Read initial values
    setDimensions(readDimensions());

    // Listen for viewport changes (handles both resize and orientation change)
    const mediaQuery = window.matchMedia("(min-width: 1000px)");

    const handleChange = () => {
      setDimensions(readDimensions());
    };

    // Modern browsers
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [readDimensions]);

  return dimensions;
}
