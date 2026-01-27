// Race-related constants - keep in sync with GiraffeRaceConstants.sol

export const USDC_DECIMALS = 6;
export const LANE_COUNT = 6 as const;
export const ODDS_SCALE = 10000;

// Fixed odds in basis points (temporary until dynamic odds)
// Win: 5.70x, Place: 2.40x, Show: 1.60x
export const TEMP_FIXED_WIN_ODDS_BPS = 57000n;
export const TEMP_FIXED_PLACE_ODDS_BPS = 24000n;
export const TEMP_FIXED_SHOW_ODDS_BPS = 16000n;

// Window sizes
export const BETTING_WINDOW_BLOCKS = 30n;

// Race simulation parameters
export const SPEED_RANGE = 10;
export const TRACK_LENGTH = 1000;
export const FINISH_OVERSHOOT = 10; // Race runs until all are 10 units past finish
export const MAX_TICKS = 500;

// Replay speed baseline multiplier:
// - "1x" should feel faster than real-time UI defaults
// - higher speeds scale proportionally (2x/3x still work the same, just faster)
export const BASE_REPLAY_SPEED_MULTIPLIER = 1.5;

// Track geometry - Side-view camera perspective
// All animals run side-by-side on one track with slight vertical stagger for depth
export const WORLD_PADDING_LEFT_PX = 100;
export const WORLD_PADDING_RIGHT_PX = 140;
export const PX_PER_UNIT = 3;
export const GIRAFFE_SIZE_PX = 100;

// Track height - fixed to fill parent container
export const TRACK_HEIGHT_PX = 328;

// Side-view specific: giraffes span nearly full track height with ~15px padding
// Lane 0 = furthest from camera (top), Lane 5 = closest to camera (bottom)
// All giraffes same size for cartoon style
export const TRACK_BASE_Y_PX = 164; // Center of track
export const TRACK_VERTICAL_SPREAD_PX = 198; // Spread between lane 0 and lane 5 centers

// Legacy export for compatibility (now unused in rendering)
export const LANE_HEIGHT_PX = 86;
export const LANE_GAP_PX = 10;

// Derived track geometry
export const TRACK_LENGTH_PX = TRACK_LENGTH * PX_PER_UNIT;
export const FINISH_LINE_X = WORLD_PADDING_LEFT_PX + TRACK_LENGTH_PX;
export const WORLD_WIDTH_PX = WORLD_PADDING_LEFT_PX + TRACK_LENGTH_PX + WORLD_PADDING_RIGHT_PX;
