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
        returns (bool settled, bool giraffesFinalized, bool oddsSet, bool cancelled)
    {
        Race storage r = _races[raceId];
        if (r.submissionCloseBlock == 0) return (false, false, false, false);
        return (r.settled, r.giraffesFinalized, r.oddsSet, r.cancelled);
    }

    function getRaceScheduleById(uint256 raceId)
        external
        view
        returns (uint64 bettingCloseBlock, uint64 submissionCloseBlock, uint64 settledAtBlock)
    {
        Race storage r = _races[raceId];
        submissionCloseBlock = r.submissionCloseBlock;
        if (submissionCloseBlock == 0) return (0, 0, 0);
        bettingCloseBlock = r.bettingCloseBlock;
        settledAtBlock = r.settledAtBlock;
        return (bettingCloseBlock, submissionCloseBlock, settledAtBlock);
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

    // ============ Race Actionability (for bots) ============

    function getRaceActionabilityById(uint256 raceId)
        external
        view
        returns (
            bool canFinalizeNow,
            bool canSettleNow,
            uint64 bettingCloseBlock,
            uint64 submissionCloseBlock,
            uint64 finalizeEntropyBlock,
            uint64 finalizeBlockhashExpiresAt,
            uint64 settleBlockhashExpiresAt,
            uint64 blocksUntilFinalizeExpiry,
            uint64 blocksUntilSettleExpiry
        )
    {
        Race storage r = _races[raceId];
        submissionCloseBlock = r.submissionCloseBlock;
        if (submissionCloseBlock == 0) {
            return (false, false, 0, 0, 0, 0, 0, 0, 0);
        }

        bettingCloseBlock = r.bettingCloseBlock;
        finalizeEntropyBlock = submissionCloseBlock > 0 ? (submissionCloseBlock - 1) : 0;

        finalizeBlockhashExpiresAt = finalizeEntropyBlock == 0 ? 0 : uint64(uint256(finalizeEntropyBlock) + 256);
        settleBlockhashExpiresAt = bettingCloseBlock == 0 ? 0 : uint64(uint256(bettingCloseBlock) + 256);

        if (finalizeBlockhashExpiresAt != 0 && block.number < finalizeBlockhashExpiresAt) {
            blocksUntilFinalizeExpiry = uint64(uint256(finalizeBlockhashExpiresAt) - block.number);
        } else {
            blocksUntilFinalizeExpiry = 0;
        }
        if (settleBlockhashExpiresAt != 0 && block.number < settleBlockhashExpiresAt) {
            blocksUntilSettleExpiry = uint64(uint256(settleBlockhashExpiresAt) - block.number);
        } else {
            blocksUntilSettleExpiry = 0;
        }

        bool finalizeBlockReached = block.number >= submissionCloseBlock;
        bool finalizeBhAvailable = finalizeEntropyBlock != 0 && blockhash(uint256(finalizeEntropyBlock)) != bytes32(0);
        canFinalizeNow = submissionCloseBlock != 0 && !r.settled && !r.giraffesFinalized && finalizeBlockReached && finalizeBhAvailable;

        bool settleBhAvailable = bettingCloseBlock != 0 && blockhash(uint256(bettingCloseBlock)) != bytes32(0);
        bool settleTimeReached = bettingCloseBlock != 0 && block.number > bettingCloseBlock;
        bool oddsOk = r.totalPot == 0 || r.oddsSet;

        canSettleNow = r.giraffesFinalized && !r.settled && settleTimeReached && settleBhAvailable && oddsOk;
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
