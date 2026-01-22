// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "../libraries/GiraffeRaceStorage.sol";

/**
 * @title RaceViewsFacet
 * @notice Read-only functions for race state, giraffe assignments, and simulation
 * @dev Consolidates all view functions for UI/bot consumption
 */
contract RaceViewsFacet {
    uint8 internal constant LANE_COUNT = 6;

    // ============ Constants ============

    function laneCount() external pure returns (uint8) {
        return LANE_COUNT;
    }

    function tickCount() external pure returns (uint16) {
        return GiraffeRaceStorage.MAX_TICKS;
    }

    function speedRange() external pure returns (uint8) {
        return GiraffeRaceStorage.SPEED_RANGE;
    }

    function trackLength() external pure returns (uint16) {
        return GiraffeRaceStorage.TRACK_LENGTH;
    }

    // ============ Race State ============

    function getRace()
        external
        view
        returns (
            uint64 bettingCloseBlock,
            bool settled,
            uint8 winner,
            bytes32 seed,
            uint256 totalPot,
            uint256[LANE_COUNT] memory totalOnLane
        )
    {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256 raceId = _latestRaceId(s);
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        return (r.bettingCloseBlock, r.settled, r.winner, r.seed, r.totalPot, r.totalOnLane);
    }

    function getRaceById(uint256 raceId)
        external
        view
        returns (
            uint64 bettingCloseBlock,
            bool settled,
            uint8 winner,
            bytes32 seed,
            uint256 totalPot,
            uint256[LANE_COUNT] memory totalOnLane
        )
    {
        GiraffeRaceStorage.Race storage r = GiraffeRaceStorage.layout().races[raceId];
        return (r.bettingCloseBlock, r.settled, r.winner, r.seed, r.totalPot, r.totalOnLane);
    }

    function getRaceFlagsById(uint256 raceId)
        external
        view
        returns (bool settled, bool giraffesFinalized, bool oddsSet)
    {
        GiraffeRaceStorage.Race storage r = GiraffeRaceStorage.layout().races[raceId];
        if (r.submissionCloseBlock == 0) return (false, false, false);
        return (r.settled, r.giraffesFinalized, r.oddsSet);
    }

    function getRaceScheduleById(uint256 raceId)
        external
        view
        returns (uint64 bettingCloseBlock, uint64 submissionCloseBlock, uint64 settledAtBlock)
    {
        GiraffeRaceStorage.Race storage r = GiraffeRaceStorage.layout().races[raceId];
        submissionCloseBlock = r.submissionCloseBlock;
        if (submissionCloseBlock == 0) return (0, 0, 0);
        bettingCloseBlock = r.bettingCloseBlock;
        settledAtBlock = r.settledAtBlock;
        return (bettingCloseBlock, submissionCloseBlock, settledAtBlock);
    }

    function getRaceOddsById(uint256 raceId)
        external
        view
        returns (bool oddsSet, uint32[LANE_COUNT] memory decimalOddsBps)
    {
        GiraffeRaceStorage.Race storage r = GiraffeRaceStorage.layout().races[raceId];
        return (r.oddsSet, r.decimalOddsBps);
    }

    function getRaceDeadHeatById(uint256 raceId)
        external
        view
        returns (uint8 deadHeatCount, uint8[LANE_COUNT] memory winners)
    {
        GiraffeRaceStorage.Race storage r = GiraffeRaceStorage.layout().races[raceId];
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
        GiraffeRaceStorage.Race storage r = GiraffeRaceStorage.layout().races[raceId];
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

    function getRaceGiraffes()
        external
        view
        returns (
            uint8 assignedCount,
            uint256[LANE_COUNT] memory tokenIds,
            address[LANE_COUNT] memory originalOwners
        )
    {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256 raceId = _latestRaceId(s);
        GiraffeRaceStorage.RaceGiraffes storage ra = s.raceGiraffes[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners);
    }

    function getRaceGiraffesById(uint256 raceId)
        external
        view
        returns (
            uint8 assignedCount,
            uint256[LANE_COUNT] memory tokenIds,
            address[LANE_COUNT] memory originalOwners
        )
    {
        GiraffeRaceStorage.RaceGiraffes storage ra = GiraffeRaceStorage.layout().raceGiraffes[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners);
    }

    function getRaceScore() external view returns (uint8[LANE_COUNT] memory score) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256 raceId = _latestRaceId(s);
        return s.raceScore[raceId];
    }

    function getRaceScoreById(uint256 raceId) external view returns (uint8[LANE_COUNT] memory score) {
        return GiraffeRaceStorage.layout().raceScore[raceId];
    }

    // ============ Simulation ============

    function simulate(bytes32 seed) external view returns (uint8 winner, uint16[LANE_COUNT] memory distances) {
        return GiraffeRaceStorage.layout().simulator.simulate(seed);
    }

    function simulateWithScore(bytes32 seed, uint8[LANE_COUNT] calldata score)
        external
        view
        returns (uint8 winner, uint16[LANE_COUNT] memory distances)
    {
        return GiraffeRaceStorage.layout().simulator.simulateWithScore(seed, score);
    }

    // ============ Contract References ============

    function giraffeNft() external view returns (address) {
        return address(GiraffeRaceStorage.layout().giraffeNft);
    }

    function simulator() external view returns (address) {
        return address(GiraffeRaceStorage.layout().simulator);
    }

    function treasury() external view returns (address) {
        return address(GiraffeRaceStorage.layout().treasury);
    }

    function winProbTable() external view returns (address) {
        return address(GiraffeRaceStorage.layout().winProbTable);
    }

    // ============ Internal Helpers ============

    function _latestRaceId(GiraffeRaceStorage.Layout storage s) internal view returns (uint256 raceId) {
        if (s.nextRaceId == 0) revert GiraffeRaceStorage.InvalidRace();
        return s.nextRaceId - 1;
    }
}
