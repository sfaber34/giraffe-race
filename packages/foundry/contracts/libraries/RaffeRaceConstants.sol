// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title RaffeRaceConstants
 * @notice Single source of truth for all RaffeRace constants
 * @dev Import this and use `C.CONSTANT_NAME` throughout the codebase.
 *      
 *      IMPORTANT: Solidity requires literal values for array sizes in function 
 *      signatures. When you need `uint8[6]` in a function parameter/return type,
 *      you must use the literal `6`. However, you should add an assertion to 
 *      ensure it matches this file:
 *      
 *          assert(6 == RaffeRaceConstants.LANE_COUNT);
 */
library RaffeRaceConstants {
    // ============ Race Configuration ============
    
    /// @notice Number of lanes in each race (also used for array sizes)
    uint8 internal constant LANE_COUNT = 6;
    
    /// @notice Track length in arbitrary distance units
    uint16 internal constant TRACK_LENGTH = 1000;
    
    /// @notice Maximum ticks before a race fails (sanity check)
    uint16 internal constant MAX_TICKS = 500;
    
    /// @notice Speed range per tick (1 to SPEED_RANGE)
    uint8 internal constant SPEED_RANGE = 10;
    
    /// @notice Distance past finish line to run (ensures all racers visually cross)
    uint16 internal constant FINISH_OVERSHOOT = 10;

    // ============ Odds Configuration ============
    
    /// @notice Basis points denominator (10000 = 100%)
    uint16 internal constant ODDS_SCALE = 10000;
    
    /// @notice Maximum house edge in basis points (30%)
    uint16 internal constant MAX_HOUSE_EDGE_BPS = 3000;
    
    /// @notice Minimum decimal odds in basis points (1.01x)
    uint32 internal constant MIN_DECIMAL_ODDS_BPS = 10100;

    // ============ Bet Types ============
    
    uint8 internal constant BET_TYPE_WIN = 0;
    uint8 internal constant BET_TYPE_PLACE = 1;
    uint8 internal constant BET_TYPE_SHOW = 2;

    // ============ Phase Schedule ============
    
    /// @notice Blocks for bot to submit odds after race creation
    uint64 internal constant ODDS_WINDOW_BLOCKS = 10;
    
    /// @notice Blocks for betting window (after odds are set)
    uint64 internal constant BETTING_WINDOW_BLOCKS = 30;
    
    /// @notice Cooldown blocks after settlement before new race
    uint64 internal constant POST_RACE_COOLDOWN_BLOCKS = 30;
    
    /// @notice Blocks after settlement before claim expires (~3 hours on Base with 2s blocks)
    uint64 internal constant CLAIM_EXPIRATION_BLOCKS = 5400;

    // ============ Limits ============
    
    /// @notice Maximum entries in the persistent race queue
    uint16 internal constant MAX_QUEUE_SIZE = 128;

    // ============ Claim Status ============
    
    uint8 internal constant CLAIM_STATUS_BLOCKHASH_UNAVAILABLE = 0;
    uint8 internal constant CLAIM_STATUS_READY_TO_SETTLE = 1;
    uint8 internal constant CLAIM_STATUS_LOSS = 2;
    uint8 internal constant CLAIM_STATUS_WIN = 3;
    uint8 internal constant CLAIM_STATUS_REFUND = 4;
}
