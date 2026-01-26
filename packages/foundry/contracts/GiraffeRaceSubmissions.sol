// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "./GiraffeRaceBase.sol";

/**
 * @title GiraffeRaceSubmissions
 * @notice Handles the persistent race queue for giraffe entries
 * @dev Users enter the queue once and are automatically selected for races FIFO.
 *      One entry per user. Entries persist until the user leaves or is selected.
 */
abstract contract GiraffeRaceSubmissions is GiraffeRaceBase {
    /// @notice Enter your giraffe into the persistent race queue
    /// @dev FIFO order - first to enter will be first to race
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
        
        // Token must not already be in queue
        if (_tokenQueueIndex[tokenId] != 0) revert TokenAlreadyQueued();
        
        // Queue size limit (count active entries from head)
        uint256 activeCount = 0;
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

    /// @notice Leave the race queue (remove your entry)
    function leaveQueue() external {
        if (!userInQueue[msg.sender]) revert NotInQueue();
        
        // Find and soft-delete the user's entry
        for (uint256 i = queueHead; i < _raceQueue.length; ) {
            QueueEntry storage entry = _raceQueue[i];
            if (entry.owner == msg.sender && !entry.removed) {
                entry.removed = true;
                _tokenQueueIndex[entry.tokenId] = 0;
                userInQueue[msg.sender] = false;
                
                emit QueueLeft(msg.sender, entry.tokenId);
                return;
            }
            unchecked { ++i; }
        }
        
        // Should not reach here if userInQueue was true
        revert NotInQueue();
    }

    // ============ View Functions ============

    /// @notice Get the total length of the queue array (includes removed/processed entries)
    function getQueueLength() external view returns (uint256) {
        return _raceQueue.length;
    }

    /// @notice Get the current queue head index
    function getQueueHead() external view returns (uint256) {
        return queueHead;
    }

    /// @notice Get the number of active (non-removed, non-processed) entries in the queue
    function getActiveQueueLength() external view returns (uint256 count) {
        for (uint256 i = queueHead; i < _raceQueue.length; ) {
            QueueEntry storage entry = _raceQueue[i];
            if (!entry.removed && giraffeNft.ownerOf(entry.tokenId) == entry.owner) {
                unchecked { ++count; }
            }
            unchecked { ++i; }
        }
    }

    /// @notice Check if a user is currently in the queue
    function isUserInQueue(address user) external view returns (bool) {
        return userInQueue[user];
    }

    /// @notice Check if a token is currently in the queue
    function isTokenInQueue(uint256 tokenId) external view returns (bool) {
        return _tokenQueueIndex[tokenId] != 0;
    }

    /// @notice Get queue entries with validity info
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
    function getUserQueuedToken(address user) external view returns (uint256 tokenId) {
        if (!userInQueue[user]) return 0;
        
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
    function getUserQueuePosition(address user) external view returns (uint256 position) {
        if (!userInQueue[user]) return 0;
        
        uint256 validPosition = 0;
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
}
