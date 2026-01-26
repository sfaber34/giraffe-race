// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "./GiraffeRaceBase.sol";
import { SettlementLib } from "./libraries/SettlementLib.sol";
import { OddsLib } from "./libraries/OddsLib.sol"; // Used for calculateEffectiveScore

/**
 * @title GiraffeRaceLifecycle
 * @notice Handles race creation and settlement
 * @dev Race creation now selects lineup from persistent queue (FIFO)
 */
abstract contract GiraffeRaceLifecycle is GiraffeRaceBase {
    // ============ Optimized Simple RNG (for house giraffe selection) ============
    
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

    /// @notice Create a new race - selects lineup from queue and opens betting immediately
    /// @dev Lineup is selected FIFO from the persistent queue. Empty lanes filled with house giraffes.
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

        raceId = nextRaceId++;
        Race storage r = _races[raceId];
        
        // Select lineup from queue and fill with house giraffes
        _selectLineupFromQueue(raceId);
        
        // Snapshot effective score for each lane
        RaceGiraffes storage ra = _raceGiraffes[raceId];
        for (uint8 lane = 0; lane < LANE_COUNT; ) {
            (uint8 zip, uint8 moxie, uint8 hustle) = giraffeNft.statsOf(ra.tokenIds[lane]);
            _raceScore[raceId][lane] = OddsLib.calculateEffectiveScore(zip, moxie, hustle);
            unchecked { ++lane; }
        }
        
        // Set fixed odds
        _autoSetOddsFromScore(raceId);
        
        // Open betting immediately
        r.bettingCloseBlock = uint64(block.number) + BETTING_WINDOW_BLOCKS;
        
        emit RaceCreated(raceId, r.bettingCloseBlock);
    }

    // ============ Race Settlement ============

    /// @notice Settle the current active race
    function settleRace() external {
        uint256 raceId = _activeRaceId();
        settledLiability = SettlementLib.settleRace(_races[raceId], raceId, _raceScore[raceId], simulator, settledLiability);
    }

    // ============ Internal Helpers ============

    /// @notice Select lineup from queue (FIFO) and fill remaining with house giraffes
    function _selectLineupFromQueue(uint256 raceId) internal {
        delete _raceGiraffes[raceId];
        RaceGiraffes storage ra = _raceGiraffes[raceId];
        
        uint8 assignedCount = 0;
        
        // Select from queue FIFO (first-come-first-served)
        while (queueHead < _raceQueue.length && assignedCount < LANE_COUNT) {
            QueueEntry storage entry = _raceQueue[queueHead];
            
            // Skip removed entries
            if (entry.removed) {
                queueHead++;
                continue;
            }
            
            // Validate ownership (user might have transferred NFT after queuing)
            if (giraffeNft.ownerOf(entry.tokenId) != entry.owner) {
                // Invalid entry - mark as removed and skip
                entry.removed = true;
                _tokenQueueIndex[entry.tokenId] = 0;
                userInQueue[entry.owner] = false;
                queueHead++;
                continue;
            }
            
            // Valid entry - assign to race
            ra.tokenIds[assignedCount] = entry.tokenId;
            ra.originalOwners[assignedCount] = entry.owner;
            
            emit QueueEntrySelected(raceId, entry.owner, entry.tokenId, assignedCount);
            emit GiraffeAssigned(raceId, entry.tokenId, entry.owner, assignedCount);
            
            // Remove from queue (consumed)
            entry.removed = true;
            _tokenQueueIndex[entry.tokenId] = 0;
            userInQueue[entry.owner] = false;
            
            queueHead++;
            unchecked { ++assignedCount; }
        }
        
        ra.assignedCount = assignedCount;
        
        // Fill remaining lanes with house giraffes (randomly selected)
        if (assignedCount < LANE_COUNT) {
            _fillWithHouseGiraffes(raceId, assignedCount);
        }
    }

    /// @notice Fill remaining race lanes with randomly selected house giraffes
    function _fillWithHouseGiraffes(uint256 raceId, uint8 startLane) internal {
        RaceGiraffes storage ra = _raceGiraffes[raceId];
        
        // Create seed for random house giraffe selection
        bytes32 seed = keccak256(abi.encodePacked(
            block.prevrandao,
            block.timestamp,
            raceId,
            address(this)
        ));
        SimpleRng memory rng = _createRng(seed);
        
        // Track which house giraffes are still available
        uint8[6] memory availableIdx = [0, 1, 2, 3, 4, 5];
        uint8 availableCount = LANE_COUNT;
        
        for (uint8 lane = startLane; lane < LANE_COUNT; ) {
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
            emit GiraffeAssigned(raceId, houseTokenId, treasuryOwner, lane);
            
            unchecked { ++lane; }
        }
        
        ra.assignedCount = LANE_COUNT;
    }

    function _autoSetOddsFromScore(uint256 raceId) internal {
        Race storage r = _races[raceId];
        if (r.oddsSet) return;

        // Use fixed odds for all lanes
        for (uint8 lane = 0; lane < LANE_COUNT; ) {
            r.decimalOddsBps[lane] = TEMP_FIXED_DECIMAL_ODDS_BPS;
            unchecked { ++lane; }
        }
        r.oddsSet = true;
        emit RaceOddsSet(raceId, r.decimalOddsBps);
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
