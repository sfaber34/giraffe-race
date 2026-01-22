// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title GiraffeRaceConstants
 * @notice Shared constants for the GiraffeRace system
 * @dev Single source of truth for magic numbers and configuration values
 */
library GiraffeRaceConstants {
    // ============ Race Configuration ============
    
    /// @notice Number of lanes in each race
    uint8 internal constant LANE_COUNT = 6;
    
    /// @notice Track length in arbitrary distance units
    uint16 internal constant TRACK_LENGTH = 1000;
    
    /// @notice Maximum ticks before a race fails (sanity check)
    uint16 internal constant MAX_TICKS = 500;
    
    /// @notice Speed range per tick (1 to SPEED_RANGE)
    uint8 internal constant SPEED_RANGE = 10;

    // ============ Odds Configuration ============
    
    /// @notice Basis points denominator (10000 = 100%)
    uint16 internal constant ODDS_SCALE = 10000;
    
    /// @notice Maximum house edge in basis points (30%)
    uint16 internal constant MAX_HOUSE_EDGE_BPS = 3000;
    
    /// @notice Minimum decimal odds in basis points (1.01x)
    uint32 internal constant MIN_DECIMAL_ODDS_BPS = 10100;
    
    /// @notice Fallback fixed odds when no probability table (5.70x)
    uint32 internal constant TEMP_FIXED_DECIMAL_ODDS_BPS = 57000;

    // ============ Phase Schedule ============
    
    /// @notice Blocks for submission window
    uint64 internal constant SUBMISSION_WINDOW_BLOCKS = 10;
    
    /// @notice Blocks for betting window (after finalization)
    uint64 internal constant BETTING_WINDOW_BLOCKS = 10;
    
    /// @notice Cooldown blocks after settlement before new race
    uint64 internal constant POST_RACE_COOLDOWN_BLOCKS = 5;

    // ============ Limits ============
    
    /// @notice Maximum entries per race entrant pool
    uint16 internal constant MAX_ENTRIES_PER_RACE = 128;
}
