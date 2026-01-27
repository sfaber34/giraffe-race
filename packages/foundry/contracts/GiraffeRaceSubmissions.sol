// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "./GiraffeRaceBase.sol";

/**
 * @title GiraffeRaceSubmissions
 * @notice Handles the persistent race queue for giraffe entries
 * @dev Users enter the queue once and are automatically selected for races FIFO.
 *      One entry per user. Entries persist until selected for a race.
 *      Users CANNOT withdraw from queue once entered (commitment model).
 *      Priority queue holds restored entries from cancelled races (processed first).
 */
abstract contract GiraffeRaceSubmissions is GiraffeRaceBase {
    /// @notice Enter your giraffe into the persistent race queue
    /// @dev FIFO order - first to enter will be first to race
    ///      Once entered, you CANNOT withdraw - you're committed until race runs
    /// @param tokenId The token ID of the giraffe to queue
    function enterQueue(uint256 tokenId) external {
        // One entry per user
        if (userInQueue[msg.sender]) revert AlreadyInQueue();
        
        // Must own the giraffe
        if (giraffeNft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        
        // Prevent queuing house giraffes
        for (uint256 i = 0; i < LANE_COUNT; ) {
            if (houseGiraffeTokenIds[i] == tokenId) revert CannotQueueHouseGiraffe();
            unchecked { ++i; }
        }
        
        // Token must not already be in queue (main or priority)
        if (_tokenQueueIndex[tokenId] != 0) revert TokenAlreadyQueued();
        
        // Queue size limit (count active entries from both queues)
        uint256 activeCount = _priorityQueue.length; // All priority queue entries count
        for (uint256 i = queueHead; i < _raceQueue.length; ) {
            if (!_raceQueue[i].removed) {
                unchecked { ++activeCount; }
            }
            unchecked { ++i; }
        }
        if (activeCount >= MAX_QUEUE_SIZE) revert QueueFull();
        
        // Add to queue
        _raceQueue.push(QueueEntry({
            tokenId: tokenId,
            owner: msg.sender,
            removed: false
        }));
        
        uint256 queueIndex = _raceQueue.length; // 1-indexed for mapping (0 = not in queue)
        _tokenQueueIndex[tokenId] = queueIndex;
        userInQueue[msg.sender] = true;
        
        emit QueueEntered(msg.sender, tokenId, _raceQueue.length - 1);
    }

    // NOTE: leaveQueue() has been removed - users cannot withdraw once entered

    // ============ View Functions ============

    /// @notice Get the total length of the main queue array (includes removed/processed entries)
    function getQueueLength() external view returns (uint256) {
        return _raceQueue.length;
    }

    /// @notice Get the current queue head index
    function getQueueHead() external view returns (uint256) {
        return queueHead;
    }

    /// @notice Get the length of the priority queue (restored entries from cancelled races)
    function getPriorityQueueLength() external view returns (uint256) {
        return _priorityQueue.length;
    }

    /// @notice Get the total number of active entries (priority + main queue)
    /// @dev These are non-removed entries where owner still owns the token
    function getActiveQueueLength() external view returns (uint256 count) {
        // Count priority queue (all entries are active since they're freshly restored)
        for (uint256 i = 0; i < _priorityQueue.length; ) {
            QueueEntry storage entry = _priorityQueue[i];
            if (!entry.removed && giraffeNft.ownerOf(entry.tokenId) == entry.owner) {
                unchecked { ++count; }
            }
            unchecked { ++i; }
        }
        
        // Count main queue
        for (uint256 i = queueHead; i < _raceQueue.length; ) {
            QueueEntry storage entry = _raceQueue[i];
            if (!entry.removed && giraffeNft.ownerOf(entry.tokenId) == entry.owner) {
                unchecked { ++count; }
            }
            unchecked { ++i; }
        }
    }

    /// @notice Check if a user is currently in the queue (main or priority)
    function isUserInQueue(address user) external view returns (bool) {
        return userInQueue[user];
    }

    /// @notice Check if a token is currently in the queue (main or priority)
    function isTokenInQueue(uint256 tokenId) external view returns (bool) {
        return _tokenQueueIndex[tokenId] != 0;
    }

    /// @notice Get priority queue entries (restored from cancelled races)
    /// @return entries Array of queue entry views
    function getPriorityQueueEntries() 
        external 
        view 
        returns (QueueEntryView[] memory entries) 
    {
        entries = new QueueEntryView[](_priorityQueue.length);
        
        for (uint256 i = 0; i < _priorityQueue.length; ) {
            QueueEntry storage entry = _priorityQueue[i];
            
            bool isValid = !entry.removed && 
                           giraffeNft.ownerOf(entry.tokenId) == entry.owner;
            
            entries[i] = QueueEntryView({
                index: i,
                tokenId: entry.tokenId,
                owner: entry.owner,
                isValid: isValid
            });
            unchecked { ++i; }
        }
    }

    /// @notice Get main queue entries with validity info
    /// @param start Starting index (from queueHead)
    /// @param count Maximum number of entries to return
    /// @return entries Array of queue entry views
    function getQueueEntries(uint256 start, uint256 count) 
        external 
        view 
        returns (QueueEntryView[] memory entries) 
    {
        uint256 startIdx = queueHead + start;
        uint256 endIdx = startIdx + count;
        if (endIdx > _raceQueue.length) {
            endIdx = _raceQueue.length;
        }
        
        uint256 resultCount = endIdx > startIdx ? endIdx - startIdx : 0;
        entries = new QueueEntryView[](resultCount);
        
        for (uint256 i = 0; i < resultCount; ) {
            uint256 idx = startIdx + i;
            QueueEntry storage entry = _raceQueue[idx];
            
            bool isValid = !entry.removed && 
                           giraffeNft.ownerOf(entry.tokenId) == entry.owner;
            
            entries[i] = QueueEntryView({
                index: idx,
                tokenId: entry.tokenId,
                owner: entry.owner,
                isValid: isValid
            });
            unchecked { ++i; }
        }
    }

    /// @notice Get the user's queued token ID (0 if not in queue)
    /// @dev Checks priority queue first, then main queue
    function getUserQueuedToken(address user) external view returns (uint256 tokenId) {
        if (!userInQueue[user]) return 0;
        
        // Check priority queue first
        for (uint256 i = 0; i < _priorityQueue.length; ) {
            QueueEntry storage entry = _priorityQueue[i];
            if (entry.owner == user && !entry.removed) {
                return entry.tokenId;
            }
            unchecked { ++i; }
        }
        
        // Check main queue
        for (uint256 i = queueHead; i < _raceQueue.length; ) {
            QueueEntry storage entry = _raceQueue[i];
            if (entry.owner == user && !entry.removed) {
                return entry.tokenId;
            }
            unchecked { ++i; }
        }
        return 0;
    }
    
    /// @notice Get the user's position in the queue (0 if not in queue, 1 = first)
    /// @dev Priority queue entries are positions 1-N, then main queue continues
    function getUserQueuePosition(address user) external view returns (uint256 position) {
        if (!userInQueue[user]) return 0;
        
        uint256 validPosition = 0;
        
        // Check priority queue first
        for (uint256 i = 0; i < _priorityQueue.length; ) {
            QueueEntry storage entry = _priorityQueue[i];
            if (!entry.removed && giraffeNft.ownerOf(entry.tokenId) == entry.owner) {
                unchecked { ++validPosition; }
                if (entry.owner == user) {
                    return validPosition;
                }
            }
            unchecked { ++i; }
        }
        
        // Then main queue
        for (uint256 i = queueHead; i < _raceQueue.length; ) {
            QueueEntry storage entry = _raceQueue[i];
            if (!entry.removed && giraffeNft.ownerOf(entry.tokenId) == entry.owner) {
                unchecked { ++validPosition; }
                if (entry.owner == user) {
                    return validPosition;
                }
            }
            unchecked { ++i; }
        }
        return 0;
    }

    /// @notice Check if a user is in the priority queue (restored from cancelled race)
    function isUserInPriorityQueue(address user) external view returns (bool) {
        for (uint256 i = 0; i < _priorityQueue.length; ) {
            QueueEntry storage entry = _priorityQueue[i];
            if (entry.owner == user && !entry.removed) {
                return true;
            }
            unchecked { ++i; }
        }
        return false;
    }
}
