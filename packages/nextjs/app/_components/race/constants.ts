// Race-related constants - keep in sync with GiraffeRaceStorage.sol (Diamond pattern)

export const USDC_DECIMALS = 6;
export const LANE_COUNT = 6 as const;

// Window sizes (not offsets from race creation)
export const SUBMISSION_WINDOW_BLOCKS = 10n;
export const BETTING_WINDOW_BLOCKS = 10n;

// Race simulation parameters
export const SPEED_RANGE = 10;
export const TRACK_LENGTH = 1000;
export const MAX_TICKS = 500;

// Replay speed baseline multiplier:
// - "1x" should feel faster than real-time UI defaults
// - higher speeds scale proportionally (2x/3x still work the same, just faster)
export const BASE_REPLAY_SPEED_MULTIPLIER = 1.5;

// Track geometry
export const LANE_HEIGHT_PX = 86;
export const LANE_GAP_PX = 10;
export const WORLD_PADDING_LEFT_PX = 80;
export const WORLD_PADDING_RIGHT_PX = 140;
export const PX_PER_UNIT = 3;
export const GIRAFFE_SIZE_PX = 78;

// Derived track geometry
export const TRACK_LENGTH_PX = TRACK_LENGTH * PX_PER_UNIT;
export const FINISH_LINE_X = WORLD_PADDING_LEFT_PX + TRACK_LENGTH_PX;
export const WORLD_WIDTH_PX = WORLD_PADDING_LEFT_PX + TRACK_LENGTH_PX + WORLD_PADDING_RIGHT_PX;
export const TRACK_HEIGHT_PX = LANE_COUNT * (LANE_HEIGHT_PX + LANE_GAP_PX) - LANE_GAP_PX;
