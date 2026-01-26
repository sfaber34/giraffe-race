// Race-related constants - keep in sync with GiraffeRaceStorage.sol (Diamond pattern)

export const USDC_DECIMALS = 6;
export const LANE_COUNT = 6 as const;

// Window sizes (not offsets from race creation)
export const SUBMISSION_WINDOW_BLOCKS = 30n;
export const BETTING_WINDOW_BLOCKS = 30n;

// Race simulation parameters
export const SPEED_RANGE = 10;
export const TRACK_LENGTH = 1000;
export const MAX_TICKS = 500;

// Replay speed baseline multiplier:
// - "1x" should feel faster than real-time UI defaults
// - higher speeds scale proportionally (2x/3x still work the same, just faster)
export const BASE_REPLAY_SPEED_MULTIPLIER = 1.5;

// Track geometry - Side-view camera perspective
// All animals run side-by-side on one track with slight vertical stagger for depth
export const WORLD_PADDING_LEFT_PX = 80;
export const WORLD_PADDING_RIGHT_PX = 140;
export const PX_PER_UNIT = 3;
export const GIRAFFE_SIZE_PX = 78;

// Side-view specific: vertical spread creates depth illusion
// Lane 0 = furthest from camera (top), Lane 5 = closest to camera (bottom)
export const TRACK_VERTICAL_SPREAD_PX = 70; // Total vertical spread for depth
export const TRACK_BASE_Y_PX = 180; // Base Y position for the track center

// Legacy export for compatibility (now unused in rendering)
export const LANE_HEIGHT_PX = 86;
export const LANE_GAP_PX = 10;

// Derived track geometry
export const TRACK_LENGTH_PX = TRACK_LENGTH * PX_PER_UNIT;
export const FINISH_LINE_X = WORLD_PADDING_LEFT_PX + TRACK_LENGTH_PX;
export const WORLD_WIDTH_PX = WORLD_PADDING_LEFT_PX + TRACK_LENGTH_PX + WORLD_PADDING_RIGHT_PX;
export const TRACK_HEIGHT_PX = TRACK_BASE_Y_PX + TRACK_VERTICAL_SPREAD_PX + GIRAFFE_SIZE_PX;
