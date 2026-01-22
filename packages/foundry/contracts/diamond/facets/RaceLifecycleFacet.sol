// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "../libraries/GiraffeRaceStorage.sol";
import { SettlementLib } from "../libraries/SettlementLib.sol";
import { OddsLib } from "../libraries/OddsLib.sol";
import { DeterministicDice } from "../../libraries/DeterministicDice.sol";

/**
 * @title RaceLifecycleFacet
 * @notice Handles race creation, finalization, and settlement
 * @dev Core race lifecycle management
 */
contract RaceLifecycleFacet {
    using DeterministicDice for DeterministicDice.Dice;

    // ============ Race Creation ============

    /// @notice Create a new race
    function createRace() external returns (uint256 raceId) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        
        // Only allow one open race at a time
        if (s.nextRaceId > 0) {
            GiraffeRaceStorage.Race storage prev = s.races[s.nextRaceId - 1];
            if (!prev.settled) revert GiraffeRaceStorage.PreviousRaceNotSettled();
            
            // Cooldown check
            if (block.number < uint256(prev.settledAtBlock) + GiraffeRaceStorage.POST_RACE_COOLDOWN_BLOCKS) {
                revert GiraffeRaceStorage.CooldownNotElapsed();
            }
        }

        uint64 submissionCloseBlock = uint64(block.number + GiraffeRaceStorage.SUBMISSION_WINDOW_BLOCKS);

        raceId = s.nextRaceId++;
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        r.submissionCloseBlock = submissionCloseBlock;

        emit GiraffeRaceStorage.RaceCreated(raceId, submissionCloseBlock);
    }

    // ============ Race Finalization ============

    /// @notice Finalize the race lineup after submissions close
    /// @dev Sets the betting window and assigns giraffes to lanes
    function finalizeRaceGiraffes() external {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256 raceId = GiraffeRaceStorage.activeRaceId();
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        
        if (r.settled) revert GiraffeRaceStorage.AlreadySettled();
        if (r.giraffesFinalized) revert GiraffeRaceStorage.GiraffesAlreadyFinalized();
        if (block.number < r.submissionCloseBlock) revert GiraffeRaceStorage.BettingNotOpen();

        _finalizeGiraffes(s, raceId);
        
        // Set the betting close block NOW - this starts the betting window
        r.bettingCloseBlock = uint64(block.number) + GiraffeRaceStorage.BETTING_WINDOW_BLOCKS;
        emit GiraffeRaceStorage.BettingWindowOpened(raceId, r.bettingCloseBlock);
    }

    // ============ Race Settlement ============

    /// @notice Settle the current active race
    function settleRace() external {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256 raceId = GiraffeRaceStorage.activeRaceId();
        SettlementLib.settleRace(s, raceId);
    }

    // ============ Internal Helpers ============

    function _finalizeGiraffes(GiraffeRaceStorage.Layout storage s, uint256 raceId) internal {
        GiraffeRaceStorage.Race storage r = s.races[raceId];

        bytes32 bh = blockhash(uint256(r.submissionCloseBlock - 1));
        if (bh == bytes32(0)) revert GiraffeRaceStorage.BlockhashUnavailable();

        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 fillSeed = keccak256(abi.encodePacked(baseSeed, "HOUSE_FILL"));

        _finalizeGiraffesFromPool(s, raceId, fillSeed);

        // Snapshot effective score for each lane
        GiraffeRaceStorage.RaceGiraffes storage raSnapshot = s.raceGiraffes[raceId];
        for (uint8 lane = 0; lane < GiraffeRaceStorage.LANE_COUNT; ) {
            (uint8 r0, uint8 c0, uint8 s0) = s.giraffeNft.statsOf(raSnapshot.tokenIds[lane]);
            s.raceScore[raceId][lane] = OddsLib.calculateEffectiveScore(r0, c0, s0);
            unchecked { ++lane; }
        }

        // Auto-quote fixed odds
        _autoSetOddsFromScore(s, raceId);
        r.giraffesFinalized = true;

        // Emit assignment events
        GiraffeRaceStorage.RaceGiraffes storage ra = s.raceGiraffes[raceId];
        for (uint8 lane = 0; lane < GiraffeRaceStorage.LANE_COUNT; ) {
            emit GiraffeRaceStorage.GiraffeAssigned(raceId, ra.tokenIds[lane], ra.originalOwners[lane], lane);
            unchecked { ++lane; }
        }
    }

    function _autoSetOddsFromScore(GiraffeRaceStorage.Layout storage s, uint256 raceId) internal {
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        if (r.oddsSet) return;

        uint8[6] memory scores = s.raceScore[raceId];

        // Fallback if no probability table
        if (address(s.winProbTable) == address(0)) {
            for (uint8 lane = 0; lane < GiraffeRaceStorage.LANE_COUNT; ) {
                r.decimalOddsBps[lane] = GiraffeRaceStorage.TEMP_FIXED_DECIMAL_ODDS_BPS;
                unchecked { ++lane; }
            }
            r.oddsSet = true;
            emit GiraffeRaceStorage.RaceOddsSet(raceId, r.decimalOddsBps);
            return;
        }

        // Get win probabilities from on-chain table
        uint16[6] memory probsBps = s.winProbTable.get(scores);

        // Apply symmetry fix
        uint16[6] memory probsAdj = OddsLib.adjustProbabilitiesForSymmetry(probsBps, scores);

        // Convert to odds
        for (uint8 i = 0; i < GiraffeRaceStorage.LANE_COUNT; ) {
            r.decimalOddsBps[i] = OddsLib.probabilityToOdds(probsAdj[i], s.houseEdgeBps);
            unchecked { ++i; }
        }

        r.oddsSet = true;
        emit GiraffeRaceStorage.RaceOddsSet(raceId, r.decimalOddsBps);
    }

    function _finalizeGiraffesFromPool(
        GiraffeRaceStorage.Layout storage s, 
        uint256 raceId, 
        bytes32 fillSeed
    ) internal {
        delete s.raceGiraffes[raceId];
        GiraffeRaceStorage.RaceGiraffes storage ra = s.raceGiraffes[raceId];

        DeterministicDice.Dice memory dice = DeterministicDice.create(fillSeed);

        uint8[6] memory availableIdx = [0, 1, 2, 3, 4, 5];
        uint8 availableCount = GiraffeRaceStorage.LANE_COUNT;

        GiraffeRaceStorage.RaceEntry[] storage entries = s.raceEntries[raceId];
        uint256 n = entries.length;

        // Build valid entrants list
        uint256[] memory validIdx = new uint256[](n);
        uint256 validCount = 0;
        for (uint256 i = 0; i < n; ) {
            GiraffeRaceStorage.RaceEntry storage e = entries[i];
            if (s.giraffeNft.ownerOf(e.tokenId) == e.submitter) {
                validIdx[validCount++] = i;
            }
            unchecked { ++i; }
        }

        // Select racers
        if (validCount <= GiraffeRaceStorage.LANE_COUNT) {
            uint8 lane = 0;
            for (uint256 i = 0; i < n && lane < GiraffeRaceStorage.LANE_COUNT; ) {
                GiraffeRaceStorage.RaceEntry storage e = entries[i];
                if (s.giraffeNft.ownerOf(e.tokenId) == e.submitter) {
                    ra.tokenIds[lane] = e.tokenId;
                    ra.originalOwners[lane] = e.submitter;
                    unchecked { ++lane; }
                }
                unchecked { ++i; }
            }
            ra.assignedCount = lane;
        } else {
            for (uint8 lane = 0; lane < GiraffeRaceStorage.LANE_COUNT; ) {
                uint256 remaining = validCount - uint256(lane);
                (uint256 pick, DeterministicDice.Dice memory updatedDice) = dice.roll(remaining);
                dice = updatedDice;

                uint256 chosenPos = uint256(lane) + pick;
                uint256 entryIdx = validIdx[chosenPos];
                validIdx[chosenPos] = validIdx[uint256(lane)];
                validIdx[uint256(lane)] = entryIdx;

                GiraffeRaceStorage.RaceEntry storage e = entries[entryIdx];
                ra.tokenIds[lane] = e.tokenId;
                ra.originalOwners[lane] = e.submitter;
                unchecked { ++lane; }
            }
            ra.assignedCount = GiraffeRaceStorage.LANE_COUNT;
        }

        // Fill remaining lanes with house giraffes
        for (uint8 lane = ra.assignedCount; lane < GiraffeRaceStorage.LANE_COUNT; ) {
            if (availableCount == 0) revert GiraffeRaceStorage.InvalidHouseGiraffe();
            (uint256 pick, DeterministicDice.Dice memory updatedDice) = dice.roll(availableCount);
            dice = updatedDice;

            uint8 idx = availableIdx[uint8(pick)];
            availableCount--;
            availableIdx[uint8(pick)] = availableIdx[availableCount];

            uint256 houseTokenId = s.houseGiraffeTokenIds[idx];
            if (s.giraffeNft.ownerOf(houseTokenId) != s.treasuryOwner) {
                revert GiraffeRaceStorage.InvalidHouseGiraffe();
            }

            ra.tokenIds[lane] = houseTokenId;
            ra.originalOwners[lane] = s.treasuryOwner;
            emit GiraffeRaceStorage.HouseGiraffeAssigned(raceId, houseTokenId, lane);
            unchecked { ++lane; }
        }

        ra.assignedCount = GiraffeRaceStorage.LANE_COUNT;
    }

    // ============ View Functions ============

    function nextRaceId() external view returns (uint256) {
        return GiraffeRaceStorage.layout().nextRaceId;
    }

    function latestRaceId() public view returns (uint256 raceId) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        if (s.nextRaceId == 0) revert GiraffeRaceStorage.InvalidRace();
        return s.nextRaceId - 1;
    }

    function getActiveRaceIdOrZero() external view returns (uint256 raceId) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        if (s.nextRaceId == 0) return 0;
        raceId = s.nextRaceId - 1;
        if (s.races[raceId].settled) return 0;
        return raceId;
    }

    function getCreateRaceCooldown() external view returns (bool canCreate, uint64 blocksRemaining, uint64 cooldownEndsAtBlock) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        
        if (s.nextRaceId == 0) {
            return (true, 0, 0);
        }
        
        GiraffeRaceStorage.Race storage prev = s.races[s.nextRaceId - 1];
        if (!prev.settled) {
            return (false, 0, 0);
        }
        
        cooldownEndsAtBlock = prev.settledAtBlock + GiraffeRaceStorage.POST_RACE_COOLDOWN_BLOCKS;
        if (block.number >= cooldownEndsAtBlock) {
            return (true, 0, cooldownEndsAtBlock);
        }
        
        blocksRemaining = uint64(cooldownEndsAtBlock - block.number);
        return (false, blocksRemaining, cooldownEndsAtBlock);
    }
}
