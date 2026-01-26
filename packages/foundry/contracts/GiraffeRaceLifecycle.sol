// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "./GiraffeRaceBase.sol";
import { SettlementLib } from "./libraries/SettlementLib.sol";
import { OddsLib } from "./libraries/OddsLib.sol";

/**
 * @title GiraffeRaceLifecycle
 * @notice Handles race creation, finalization, and settlement
 * @dev Core race lifecycle management
 */
abstract contract GiraffeRaceLifecycle is GiraffeRaceBase {
    // ============ Optimized Simple RNG (for small selections) ============
    // Uses direct modulo - fine for selecting from small sets (max ~128 entries)
    
    struct SimpleRng {
        bytes32 seed;
        uint256 counter;
    }
    
    function _createRng(bytes32 seed) internal pure returns (SimpleRng memory) {
        return SimpleRng({ seed: seed, counter: 0 });
    }
    
    function _roll(SimpleRng memory rng, uint256 n) internal pure returns (uint256 result, SimpleRng memory) {
        bytes32 entropy = keccak256(abi.encodePacked(rng.seed, rng.counter));
        rng.counter++;
        result = uint256(entropy) % n;
        return (result, rng);
    }

    // ============ Race Creation ============

    /// @notice Create a new race
    function createRace() external returns (uint256 raceId) {
        // Only allow one open race at a time
        if (nextRaceId > 0) {
            Race storage prev = _races[nextRaceId - 1];
            if (!prev.settled) revert PreviousRaceNotSettled();
            
            // Cooldown check
            if (block.number < uint256(prev.settledAtBlock) + POST_RACE_COOLDOWN_BLOCKS) {
                revert CooldownNotElapsed();
            }
        }

        uint64 submissionCloseBlock = uint64(block.number + SUBMISSION_WINDOW_BLOCKS);

        raceId = nextRaceId++;
        Race storage r = _races[raceId];
        r.submissionCloseBlock = submissionCloseBlock;

        emit RaceCreated(raceId, submissionCloseBlock);
    }

    // ============ Race Finalization ============

    /// @notice Finalize the race lineup after submissions close
    /// @dev Sets the betting window and assigns giraffes to lanes
    function finalizeRaceGiraffes() external {
        uint256 raceId = _activeRaceId();
        Race storage r = _races[raceId];
        
        if (r.settled) revert AlreadySettled();
        if (r.giraffesFinalized) revert GiraffesAlreadyFinalized();
        if (block.number < r.submissionCloseBlock) revert BettingNotOpen();

        _finalizeGiraffes(raceId);
        
        // Set the betting close block NOW - this starts the betting window
        r.bettingCloseBlock = uint64(block.number) + BETTING_WINDOW_BLOCKS;
        emit BettingWindowOpened(raceId, r.bettingCloseBlock);
    }

    // ============ Race Settlement ============

    /// @notice Settle the current active race
    function settleRace() external {
        uint256 raceId = _activeRaceId();
        settledLiability = SettlementLib.settleRace(_races[raceId], raceId, _raceScore[raceId], simulator, settledLiability);
    }

    // ============ Internal Helpers ============

    function _finalizeGiraffes(uint256 raceId) internal {
        Race storage r = _races[raceId];

        bytes32 bh = blockhash(uint256(r.submissionCloseBlock - 1));
        if (bh == bytes32(0)) revert BlockhashUnavailable();

        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 fillSeed = keccak256(abi.encodePacked(baseSeed, "HOUSE_FILL"));

        _finalizeGiraffesFromPool(raceId, fillSeed);

        // Snapshot effective score for each lane
        RaceGiraffes storage raSnapshot = _raceGiraffes[raceId];
        for (uint8 lane = 0; lane < LANE_COUNT; ) {
            (uint8 r0, uint8 c0, uint8 s0) = giraffeNft.statsOf(raSnapshot.tokenIds[lane]);
            _raceScore[raceId][lane] = OddsLib.calculateEffectiveScore(r0, c0, s0);
            unchecked { ++lane; }
        }

        // Auto-quote fixed odds
        _autoSetOddsFromScore(raceId);
        r.giraffesFinalized = true;

        // Emit assignment events
        RaceGiraffes storage ra = _raceGiraffes[raceId];
        for (uint8 lane = 0; lane < LANE_COUNT; ) {
            emit GiraffeAssigned(raceId, ra.tokenIds[lane], ra.originalOwners[lane], lane);
            unchecked { ++lane; }
        }
    }

    function _autoSetOddsFromScore(uint256 raceId) internal {
        Race storage r = _races[raceId];
        if (r.oddsSet) return;

        uint8[6] memory scores = _raceScore[raceId];

        // Fallback if no probability table
        if (address(winProbTable) == address(0)) {
            for (uint8 lane = 0; lane < LANE_COUNT; ) {
                r.decimalOddsBps[lane] = TEMP_FIXED_DECIMAL_ODDS_BPS;
                unchecked { ++lane; }
            }
            r.oddsSet = true;
            emit RaceOddsSet(raceId, r.decimalOddsBps);
            return;
        }

        // Get win probabilities from on-chain table
        uint16[6] memory probsBps = winProbTable.get(scores);

        // Apply symmetry fix
        uint16[6] memory probsAdj = OddsLib.adjustProbabilitiesForSymmetry(probsBps, scores);

        // Convert to odds
        for (uint8 i = 0; i < LANE_COUNT; ) {
            r.decimalOddsBps[i] = OddsLib.probabilityToOdds(probsAdj[i], houseEdgeBps);
            unchecked { ++i; }
        }

        r.oddsSet = true;
        emit RaceOddsSet(raceId, r.decimalOddsBps);
    }

    function _finalizeGiraffesFromPool(
        uint256 raceId, 
        bytes32 fillSeed
    ) internal {
        delete _raceGiraffes[raceId];
        RaceGiraffes storage ra = _raceGiraffes[raceId];

        SimpleRng memory rng = _createRng(fillSeed);

        uint8[6] memory availableIdx = [0, 1, 2, 3, 4, 5];
        uint8 availableCount = LANE_COUNT;

        RaceEntry[] storage entries = _raceEntries[raceId];
        uint256 n = entries.length;

        // Build valid entrants list
        uint256[] memory validIdx = new uint256[](n);
        uint256 validCount = 0;
        for (uint256 i = 0; i < n; ) {
            RaceEntry storage e = entries[i];
            if (giraffeNft.ownerOf(e.tokenId) == e.submitter) {
                validIdx[validCount++] = i;
            }
            unchecked { ++i; }
        }

        // Select racers
        if (validCount <= LANE_COUNT) {
            uint8 lane = 0;
            for (uint256 i = 0; i < n && lane < LANE_COUNT; ) {
                RaceEntry storage e = entries[i];
                if (giraffeNft.ownerOf(e.tokenId) == e.submitter) {
                    ra.tokenIds[lane] = e.tokenId;
                    ra.originalOwners[lane] = e.submitter;
                    unchecked { ++lane; }
                }
                unchecked { ++i; }
            }
            ra.assignedCount = lane;
        } else {
            for (uint8 lane = 0; lane < LANE_COUNT; ) {
                uint256 remaining = validCount - uint256(lane);
                uint256 pick;
                (pick, rng) = _roll(rng, remaining);

                uint256 chosenPos = uint256(lane) + pick;
                uint256 entryIdx = validIdx[chosenPos];
                validIdx[chosenPos] = validIdx[uint256(lane)];
                validIdx[uint256(lane)] = entryIdx;

                RaceEntry storage e = entries[entryIdx];
                ra.tokenIds[lane] = e.tokenId;
                ra.originalOwners[lane] = e.submitter;
                unchecked { ++lane; }
            }
            ra.assignedCount = LANE_COUNT;
        }

        // Fill remaining lanes with house giraffes
        for (uint8 lane = ra.assignedCount; lane < LANE_COUNT; ) {
            if (availableCount == 0) revert InvalidHouseGiraffe();
            uint256 pick;
            (pick, rng) = _roll(rng, availableCount);

            uint8 idx = availableIdx[uint8(pick)];
            availableCount--;
            availableIdx[uint8(pick)] = availableIdx[availableCount];

            uint256 houseTokenId = houseGiraffeTokenIds[idx];
            if (giraffeNft.ownerOf(houseTokenId) != treasuryOwner) {
                revert InvalidHouseGiraffe();
            }

            ra.tokenIds[lane] = houseTokenId;
            ra.originalOwners[lane] = treasuryOwner;
            emit HouseGiraffeAssigned(raceId, houseTokenId, lane);
            unchecked { ++lane; }
        }

        ra.assignedCount = LANE_COUNT;
    }

    // ============ View Functions ============

    function latestRaceId() public view returns (uint256 raceId) {
        if (nextRaceId == 0) revert InvalidRace();
        return nextRaceId - 1;
    }

    function getActiveRaceIdOrZero() external view returns (uint256 raceId) {
        if (nextRaceId == 0) return 0;
        raceId = nextRaceId - 1;
        if (_races[raceId].settled) return 0;
        return raceId;
    }

    function getCreateRaceCooldown() external view returns (bool canCreate, uint64 blocksRemaining, uint64 cooldownEndsAtBlock) {
        if (nextRaceId == 0) {
            return (true, 0, 0);
        }
        
        Race storage prev = _races[nextRaceId - 1];
        if (!prev.settled) {
            return (false, 0, 0);
        }
        
        cooldownEndsAtBlock = prev.settledAtBlock + POST_RACE_COOLDOWN_BLOCKS;
        if (block.number >= cooldownEndsAtBlock) {
            return (true, 0, cooldownEndsAtBlock);
        }
        
        blocksRemaining = uint64(cooldownEndsAtBlock - block.number);
        return (false, blocksRemaining, cooldownEndsAtBlock);
    }
}
