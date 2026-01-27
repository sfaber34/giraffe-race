// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "./GiraffeRaceBase.sol";
import { SettlementLib } from "./libraries/SettlementLib.sol";
import { OddsLib } from "./libraries/OddsLib.sol";

/**
 * @title GiraffeRaceLifecycle
 * @notice Handles race creation, odds setting, cancellation, and settlement
 * @dev New flow:
 *      1. createRace() - selects lineup, starts odds window (10 blocks)
 *      2. setOdds() - bot sets odds within window, opens betting
 *      3. If no odds within window, race can be cancelled (auto or explicit)
 *      4. settleRace() - settles after betting closes
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

    /// @notice Create a new race - selects lineup from queue, starts odds window
    /// @dev Lineup is selected FIFO from priority queue then main queue.
    ///      Empty lanes filled with random house giraffes.
    ///      Bot has ODDS_WINDOW_BLOCKS to call setOdds(), otherwise race is cancelled.
    function createRace() external returns (uint256 raceId) {
        // Handle previous race state
        if (nextRaceId > 0) {
            Race storage prev = _races[nextRaceId - 1];
            
            if (prev.settled) {
                // Normal case: previous race finished, check cooldown
                if (block.number < uint256(prev.settledAtBlock) + POST_RACE_COOLDOWN_BLOCKS) {
                    revert CooldownNotElapsed();
                }
            } else if (prev.cancelled) {
                // Previous race was cancelled, no cooldown needed
                // Can proceed
            } else if (!prev.oddsSet) {
                // Race exists but odds never set
                if (block.number > prev.oddsDeadlineBlock) {
                    // Deadline passed - auto cancel previous race
                    _cancelRace(nextRaceId - 1);
                    emit RaceAutoCancelled(nextRaceId - 1);
                } else {
                    // Still in odds window - can't create new race yet
                    revert OddsWindowActive();
                }
            } else {
                // Odds set but not settled - need to settle first
                revert PreviousRaceNotSettled();
            }
        }

        raceId = nextRaceId++;
        Race storage r = _races[raceId];
        
        // Select lineup from queue (priority queue first, then main queue)
        _selectLineupFromQueue(raceId);
        
        // Snapshot effective score for each lane
        RaceGiraffes storage ra = _raceGiraffes[raceId];
        for (uint8 lane = 0; lane < LANE_COUNT; ) {
            (uint8 zip, uint8 moxie, uint8 hustle) = giraffeNft.statsOf(ra.tokenIds[lane]);
            _raceScore[raceId][lane] = OddsLib.calculateEffectiveScore(zip, moxie, hustle);
            unchecked { ++lane; }
        }
        
        // Set odds deadline - bot has ODDS_WINDOW_BLOCKS to set odds
        r.oddsDeadlineBlock = uint64(block.number) + ODDS_WINDOW_BLOCKS;
        
        // DO NOT set odds here - bot will call setOdds()
        // DO NOT set bettingCloseBlock - that happens in setOdds()
        
        emit RaceCreated(raceId, r.oddsDeadlineBlock);
    }

    // ============ Odds Setting ============

    /// @notice Set odds for a race - called by raceBot within odds window
    /// @dev Opens betting window after odds are set. Only callable by raceBot address.
    /// @param raceId The race to set odds for
    /// @param winOddsBps Win odds for each lane in basis points (e.g., 57000 = 5.70x)
    /// @param placeOddsBps Place odds for each lane in basis points
    /// @param showOddsBps Show odds for each lane in basis points
    function setOdds(
        uint256 raceId,
        uint32[6] calldata winOddsBps,
        uint32[6] calldata placeOddsBps,
        uint32[6] calldata showOddsBps
    ) external onlyRaceBot {
        if (raceId >= nextRaceId) revert InvalidRace();
        
        Race storage r = _races[raceId];
        
        if (r.oddsSet) revert OddsAlreadySet();
        if (r.cancelled) revert AlreadyCancelled();
        if (r.settled) revert AlreadySettled();
        if (block.number > r.oddsDeadlineBlock) revert OddsWindowNotExpired(); // Window expired, must cancel
        
        // Validate all odds meet minimum
        for (uint8 i = 0; i < LANE_COUNT; ) {
            if (winOddsBps[i] < MIN_DECIMAL_ODDS_BPS) revert InvalidOdds();
            if (placeOddsBps[i] < MIN_DECIMAL_ODDS_BPS) revert InvalidOdds();
            if (showOddsBps[i] < MIN_DECIMAL_ODDS_BPS) revert InvalidOdds();
            unchecked { ++i; }
        }
        
        // Store odds
        r.decimalOddsBps = winOddsBps;
        r.placeOddsBps = placeOddsBps;
        r.showOddsBps = showOddsBps;
        r.oddsSet = true;
        
        // Open betting window
        r.bettingCloseBlock = uint64(block.number) + BETTING_WINDOW_BLOCKS;
        
        emit RaceOddsSet(raceId, winOddsBps, placeOddsBps, showOddsBps, r.bettingCloseBlock);
    }

    // ============ Race Cancellation ============

    /// @notice Cancel a race that didn't receive odds in time
    /// @dev Only works after odds deadline has passed and odds were never set.
    ///      Restores queue entries to priority queue (front of line for next race).
    /// @param raceId The race to cancel
    function cancelRaceNoOdds(uint256 raceId) external {
        if (raceId >= nextRaceId) revert InvalidRace();
        
        Race storage r = _races[raceId];
        
        if (r.oddsSet) revert OddsAlreadySet();
        if (r.cancelled) revert AlreadyCancelled();
        if (r.settled) revert AlreadySettled();
        if (block.number <= r.oddsDeadlineBlock) revert OddsWindowNotExpired();
        
        _cancelRace(raceId);
    }

    /// @notice Internal function to cancel a race and restore queue entries
    function _cancelRace(uint256 raceId) internal {
        Race storage r = _races[raceId];
        r.cancelled = true;
        
        // Restore user queue entries to priority queue
        _restoreQueueEntries(raceId);
        
        emit RaceCancelled(raceId);
    }

    /// @notice Restore queue entries from a cancelled race to priority queue
    /// @dev Entries go to priority queue which is processed before main queue
    function _restoreQueueEntries(uint256 raceId) internal {
        RaceGiraffes storage ra = _raceGiraffes[raceId];
        
        for (uint8 i = 0; i < ra.assignedCount; ) {
            address owner = ra.originalOwners[i];
            uint256 tokenId = ra.tokenIds[i];
            
            // Skip house giraffes - they don't go back to queue
            if (owner == treasuryOwner) {
                unchecked { ++i; }
                continue;
            }
            
            // Validate ownership still valid
            if (giraffeNft.ownerOf(tokenId) != owner) {
                unchecked { ++i; }
                continue;
            }
            
            // Add to priority queue (front of line for next race)
            _priorityQueue.push(QueueEntry({
                tokenId: tokenId,
                owner: owner,
                removed: false
            }));
            
            // Mark as in queue again
            _tokenQueueIndex[tokenId] = type(uint256).max; // Special marker for priority queue
            userInQueue[owner] = true;
            
            emit QueueEntryRestored(owner, tokenId);
            
            unchecked { ++i; }
        }
    }

    // ============ Race Settlement ============

    /// @notice Settle the current active race
    /// @dev Can only be called after betting closes
    function settleRace() external {
        uint256 raceId = _activeRaceId();
        Race storage r = _races[raceId];
        
        // Must have odds set to settle
        if (!r.oddsSet) revert OddsNotSet();
        
        settledLiability = SettlementLib.settleRace(r, raceId, _raceScore[raceId], simulator, settledLiability);
    }

    // ============ Internal Helpers ============

    /// @notice Select lineup from queue (FIFO) and fill remaining with house giraffes
    /// @dev Priority queue is processed first (restored entries from cancelled races)
    function _selectLineupFromQueue(uint256 raceId) internal {
        delete _raceGiraffes[raceId];
        RaceGiraffes storage ra = _raceGiraffes[raceId];
        
        uint8 assignedCount = 0;
        
        // First: drain priority queue (restored entries from cancelled races)
        while (_priorityQueue.length > 0 && assignedCount < LANE_COUNT) {
            // Pop from end (LIFO within priority queue, but these are all "priority")
            QueueEntry storage entry = _priorityQueue[_priorityQueue.length - 1];
            
            uint256 tokenId = entry.tokenId;
            address owner = entry.owner;
            bool removed = entry.removed;
            
            // Remove from priority queue
            _priorityQueue.pop();
            
            // Skip removed entries
            if (removed) {
                continue;
            }
            
            // Validate ownership
            if (giraffeNft.ownerOf(tokenId) != owner) {
                // Invalid - clear state and skip
                _tokenQueueIndex[tokenId] = 0;
                userInQueue[owner] = false;
                continue;
            }
            
            // Valid entry - assign to race
            ra.tokenIds[assignedCount] = tokenId;
            ra.originalOwners[assignedCount] = owner;
            
            emit QueueEntrySelected(raceId, owner, tokenId, assignedCount);
            emit GiraffeAssigned(raceId, tokenId, owner, assignedCount);
            
            // Clear queue state (consumed)
            _tokenQueueIndex[tokenId] = 0;
            userInQueue[owner] = false;
            
            unchecked { ++assignedCount; }
        }
        
        // Then: select from main queue FIFO
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

    // ============ View Functions ============

    function latestRaceId() public view returns (uint256 raceId) {
        if (nextRaceId == 0) revert InvalidRace();
        return nextRaceId - 1;
    }

    function getActiveRaceIdOrZero() external view returns (uint256 raceId) {
        if (nextRaceId == 0) return 0;
        raceId = nextRaceId - 1;
        Race storage r = _races[raceId];
        if (r.settled || r.cancelled) return 0;
        return raceId;
    }

    function getCreateRaceCooldown() external view returns (bool canCreate, uint64 blocksRemaining, uint64 cooldownEndsAtBlock) {
        if (nextRaceId == 0) {
            return (true, 0, 0);
        }
        
        Race storage prev = _races[nextRaceId - 1];
        
        // If cancelled, can create immediately
        if (prev.cancelled) {
            return (true, 0, 0);
        }
        
        // If not settled, check odds situation
        if (!prev.settled) {
            if (!prev.oddsSet) {
                // Race waiting for odds or can be auto-cancelled
                if (block.number > prev.oddsDeadlineBlock) {
                    // Can auto-cancel and create
                    return (true, 0, 0);
                } else {
                    // Still in odds window
                    return (false, uint64(prev.oddsDeadlineBlock - block.number), prev.oddsDeadlineBlock);
                }
            }
            // Odds set but not settled
            return (false, 0, 0);
        }
        
        // Settled - check cooldown
        cooldownEndsAtBlock = prev.settledAtBlock + POST_RACE_COOLDOWN_BLOCKS;
        if (block.number >= cooldownEndsAtBlock) {
            return (true, 0, cooldownEndsAtBlock);
        }
        
        blocksRemaining = uint64(cooldownEndsAtBlock - block.number);
        return (false, blocksRemaining, cooldownEndsAtBlock);
    }
}
