// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { RaffeRaceBase } from "./RaffeRaceBase.sol";

/**
 * @title RaffeRaceViews
 * @notice Read-only functions for race state, raffe assignments, and simulation
 * @dev Consolidates all view functions for UI/bot consumption
 */
abstract contract RaffeRaceViews is RaffeRaceBase {
    // ============ Bot Action Enum ============
    
    /// @notice Actions the bot should take
    uint8 public constant BOT_ACTION_NONE = 0;           // Nothing to do
    uint8 public constant BOT_ACTION_CREATE_RACE = 1;    // Call createRace()
    uint8 public constant BOT_ACTION_SET_PROBABILITIES = 2;  // Call setProbabilities()
    uint8 public constant BOT_ACTION_SETTLE_RACE = 3;    // Call settleRace()
    uint8 public constant BOT_ACTION_CANCEL_RACE = 4;    // Call cancelRaceNoOdds() (optional, createRace auto-cancels)

    // ============ Race State ============

    function getRaceById(uint256 raceId)
        external
        view
        returns (
            uint64 bettingCloseBlock,
            bool settled,
            uint8 winner,
            bytes32 seed,
            uint256 totalPot,
            uint256[6] memory totalOnLane
        )
    {
        Race storage r = _races[raceId];
        return (r.bettingCloseBlock, r.settled, r.winner, r.seed, r.totalPot, r.totalOnLane);
    }

    function getRaceFlagsById(uint256 raceId)
        external
        view
        returns (bool settled, bool oddsSet, bool cancelled)
    {
        Race storage r = _races[raceId];
        if (r.oddsDeadlineBlock == 0) return (false, false, false);
        return (r.settled, r.oddsSet, r.cancelled);
    }

    function getRaceScheduleById(uint256 raceId)
        external
        view
        returns (uint64 oddsDeadlineBlock, uint64 bettingCloseBlock, uint64 settledAtBlock)
    {
        Race storage r = _races[raceId];
        return (r.oddsDeadlineBlock, r.bettingCloseBlock, r.settledAtBlock);
    }

    function getRaceOddsById(uint256 raceId)
        external
        view
        returns (
            bool oddsSet, 
            uint32[6] memory winOddsBps,
            uint32[6] memory placeOddsBps,
            uint32[6] memory showOddsBps
        )
    {
        Race storage r = _races[raceId];
        return (r.oddsSet, r.decimalOddsBps, r.placeOddsBps, r.showOddsBps);
    }

    function getRaceDeadHeatById(uint256 raceId)
        external
        view
        returns (uint8 deadHeatCount, uint8[6] memory winners)
    {
        Race storage r = _races[raceId];
        return (r.deadHeatCount, r.winners);
    }
    
    /// @notice Get complete finish order for a race (for Win/Place/Show)
    /// @param raceId The race ID
    /// @return firstLanes Lane indices that finished 1st (first `firstCount` are valid)
    /// @return firstCount Number of lanes in 1st place (1 = normal, 2+ = dead heat)
    /// @return secondLanes Lane indices that finished 2nd
    /// @return secondCount Number of lanes in 2nd place
    /// @return thirdLanes Lane indices that finished 3rd  
    /// @return thirdCount Number of lanes in 3rd place
    /// @return finalDistances Final distance for each lane
    function getRaceFinishOrderById(uint256 raceId)
        external
        view
        returns (
            uint8[6] memory firstLanes,
            uint8 firstCount,
            uint8[6] memory secondLanes,
            uint8 secondCount,
            uint8[6] memory thirdLanes,
            uint8 thirdCount,
            uint16[6] memory finalDistances
        )
    {
        Race storage r = _races[raceId];
        return (
            r.firstPlace.lanes,
            r.firstPlace.count,
            r.secondPlace.lanes,
            r.secondPlace.count,
            r.thirdPlace.lanes,
            r.thirdPlace.count,
            r.finalDistances
        );
    }

    // ============ Bot Dashboard (comprehensive view for bot decision-making) ============

    /// @notice Get everything the bot needs to know in one call
    /// @dev This is the primary function the bot should poll to know what action to take
    /// @return action The recommended bot action (BOT_ACTION_*)
    /// @return raceId The race ID relevant to the action (0 if creating new race)
    /// @return blocksRemaining Blocks until action becomes available/expires (context-dependent)
    /// @return scores Lane scores (only populated for SET_ODDS action)
    /// @return expiredRaceIds Race IDs with expired unclaimed bets needing cleanup
    function getBotDashboard()
        external
        view
        returns (
            uint8 action,
            uint256 raceId,
            uint64 blocksRemaining,
            uint8[6] memory scores,
            uint256[] memory expiredRaceIds
        )
    {
        // Get expired races first
        expiredRaceIds = _getExpiredRaceIds();
        
        // No races yet - can create
        if (nextRaceId == 0) {
            return (BOT_ACTION_CREATE_RACE, 0, 0, scores, expiredRaceIds);
        }
        
        raceId = nextRaceId - 1;
        Race storage r = _races[raceId];
        
        // Race is settled - check cooldown for next race
        if (r.settled) {
            uint64 cooldownEndsAt = r.settledAtBlock + POST_RACE_COOLDOWN_BLOCKS;
            if (block.number >= cooldownEndsAt) {
                return (BOT_ACTION_CREATE_RACE, raceId + 1, 0, scores, expiredRaceIds);
            } else {
                blocksRemaining = uint64(cooldownEndsAt - block.number);
                return (BOT_ACTION_NONE, raceId, blocksRemaining, scores, expiredRaceIds);
            }
        }
        
        // Race is cancelled - can create new race
        if (r.cancelled) {
            return (BOT_ACTION_CREATE_RACE, raceId + 1, 0, scores, expiredRaceIds);
        }
        
        // Race exists but odds not set
        if (!r.oddsSet) {
            if (block.number <= r.oddsDeadlineBlock) {
                // Still in odds window - bot should set odds
                blocksRemaining = uint64(r.oddsDeadlineBlock - block.number);
                scores = _raceScore[raceId];
                return (BOT_ACTION_SET_PROBABILITIES, raceId, blocksRemaining, scores, expiredRaceIds);
            } else {
                // Odds window expired - can cancel (or auto-cancel via createRace)
                return (BOT_ACTION_CANCEL_RACE, raceId, 0, scores, expiredRaceIds);
            }
        }
        
        // Odds are set - check betting/settlement status
        if (block.number <= r.bettingCloseBlock) {
            // Betting still open - nothing for bot to do
            blocksRemaining = uint64(r.bettingCloseBlock - block.number);
            return (BOT_ACTION_NONE, raceId, blocksRemaining, scores, expiredRaceIds);
        }
        
        // Betting closed - check if can settle
        bool settleBhAvailable = blockhash(r.bettingCloseBlock) != bytes32(0);
        if (settleBhAvailable) {
            return (BOT_ACTION_SETTLE_RACE, raceId, 0, scores, expiredRaceIds);
        }
        
        // Blockhash expired - race may be stuck (edge case)
        // In this case, the race would need admin intervention or special handling
        return (BOT_ACTION_NONE, raceId, 0, scores, expiredRaceIds);
    }
    
    /// @dev Internal helper to get expired race IDs
    function _getExpiredRaceIds() internal view returns (uint256[] memory raceIds) {
        if (nextRaceId == 0) return raceIds;
        
        // First pass: count
        uint256 count = 0;
        for (uint256 i = 0; i < nextRaceId; i++) {
            Race storage r = _races[i];
            if (r.settled && !r.cancelled && !r.liabilityCleaned &&
                r.unclaimedLiability > 0 &&
                block.number > uint256(r.settledAtBlock) + CLAIM_EXPIRATION_BLOCKS) {
                count++;
            }
        }
        
        // Second pass: populate
        raceIds = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < nextRaceId; i++) {
            Race storage r = _races[i];
            if (r.settled && !r.cancelled && !r.liabilityCleaned &&
                r.unclaimedLiability > 0 &&
                block.number > uint256(r.settledAtBlock) + CLAIM_EXPIRATION_BLOCKS) {
                raceIds[idx++] = i;
            }
        }
    }

    // ============ Race Actionability ============

    function getRaceActionabilityById(uint256 raceId)
        external
        view
        returns (
            bool canSettleNow,
            uint64 bettingCloseBlock,
            uint64 settleBlockhashExpiresAt,
            uint64 blocksUntilSettleExpiry
        )
    {
        Race storage r = _races[raceId];
        bettingCloseBlock = r.bettingCloseBlock;
        
        // No betting block means race not ready for settlement consideration
        if (bettingCloseBlock == 0) {
            return (false, 0, 0, 0);
        }

        settleBlockhashExpiresAt = uint64(uint256(bettingCloseBlock) + 256);

        if (block.number < settleBlockhashExpiresAt) {
            blocksUntilSettleExpiry = uint64(uint256(settleBlockhashExpiresAt) - block.number);
        } else {
            blocksUntilSettleExpiry = 0;
        }

        bool settleBhAvailable = blockhash(uint256(bettingCloseBlock)) != bytes32(0);
        bool settleTimeReached = block.number > bettingCloseBlock;

        canSettleNow = !r.settled && !r.cancelled && r.oddsSet && settleTimeReached && settleBhAvailable;
    }

    // ============ Raffe Assignments ============

    function getRaceRaffesById(uint256 raceId)
        external
        view
        returns (
            uint8 assignedCount,
            uint256[6] memory tokenIds,
            address[6] memory originalOwners
        )
    {
        RaceRaffes storage ra = _raceRaffes[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners);
    }

    function getRaceScoreById(uint256 raceId) external view returns (uint8[6] memory score) {
        return _raceScore[raceId];
    }

    // ============ Simulation ============

    function simulate(bytes32 seed) external view returns (uint8 winner, uint16[6] memory distances) {
        return simulator.simulate(seed);
    }

    function simulateWithScore(bytes32 seed, uint8[6] calldata score)
        external
        view
        returns (uint8 winner, uint16[6] memory distances)
    {
        return simulator.simulateWithScore(seed, score);
    }
    
}
