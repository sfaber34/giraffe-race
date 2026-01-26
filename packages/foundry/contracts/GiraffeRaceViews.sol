// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "./GiraffeRaceBase.sol";

/**
 * @title GiraffeRaceViews
 * @notice Read-only functions for race state, giraffe assignments, and simulation
 * @dev Consolidates all view functions for UI/bot consumption
 */
abstract contract GiraffeRaceViews is GiraffeRaceBase {
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
        if (r.bettingCloseBlock == 0) return (false, false, false);
        return (r.settled, r.oddsSet, r.cancelled);
    }

    function getRaceScheduleById(uint256 raceId)
        external
        view
        returns (uint64 bettingCloseBlock, uint64 settledAtBlock)
    {
        Race storage r = _races[raceId];
        bettingCloseBlock = r.bettingCloseBlock;
        if (bettingCloseBlock == 0) return (0, 0);
        settledAtBlock = r.settledAtBlock;
        return (bettingCloseBlock, settledAtBlock);
    }

    function getRaceOddsById(uint256 raceId)
        external
        view
        returns (bool oddsSet, uint32[6] memory decimalOddsBps)
    {
        Race storage r = _races[raceId];
        return (r.oddsSet, r.decimalOddsBps);
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

    // ============ Race Actionability (for bots) ============

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
        bool oddsOk = r.totalPot == 0 || r.oddsSet;

        canSettleNow = !r.settled && settleTimeReached && settleBhAvailable && oddsOk;
    }

    // ============ Giraffe Assignments ============

    function getRaceGiraffesById(uint256 raceId)
        external
        view
        returns (
            uint8 assignedCount,
            uint256[6] memory tokenIds,
            address[6] memory originalOwners
        )
    {
        RaceGiraffes storage ra = _raceGiraffes[raceId];
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
