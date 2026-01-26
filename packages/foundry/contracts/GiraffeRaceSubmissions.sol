// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "./GiraffeRaceBase.sol";

/**
 * @title GiraffeRaceSubmissions
 * @notice Handles NFT submission for races
 * @dev Manages the entrant pool for races
 */
abstract contract GiraffeRaceSubmissions is GiraffeRaceBase {
    /// @notice Submit one of your GiraffeNFTs into the race's entrant pool (non-custodial)
    /// @param tokenId The token ID of the giraffe to submit
    function submitGiraffe(uint256 tokenId) external {
        uint256 raceId = _activeRaceId();
        Race storage r = _races[raceId];
        
        // Submissions close before finalization/betting
        if (block.number >= r.submissionCloseBlock) revert SubmissionsClosed();
        if (r.settled) revert AlreadySettled();

        if (_hasSubmittedGiraffe[raceId][msg.sender]) revert AlreadySubmitted();
        if (giraffeNft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        
        // Prevent submitting house giraffes
        for (uint256 i = 0; i < LANE_COUNT; ) {
            if (houseGiraffeTokenIds[i] == tokenId) revert InvalidHouseGiraffe();
            unchecked { ++i; }
        }
        
        if (_tokenEntered[raceId][tokenId]) revert TokenAlreadyEntered();
        if (_raceEntries[raceId].length >= MAX_ENTRIES_PER_RACE) {
            revert EntryPoolFull();
        }

        // Mark submission
        _hasSubmittedGiraffe[raceId][msg.sender] = true;
        _tokenEntered[raceId][tokenId] = true;
        _raceEntries[raceId].push(RaceEntry({ 
            tokenId: tokenId, 
            submitter: msg.sender 
        }));

        // Lane isn't determined until settlement; emit 255 to mean "pool entry"
        emit GiraffeSubmitted(raceId, msg.sender, tokenId, type(uint8).max);
    }

    // ============ View Functions ============

    /// @notice Get the number of entries submitted for a race
    function getRaceEntryCount(uint256 raceId) external view returns (uint256) {
        return _raceEntries[raceId].length;
    }

    /// @notice Check if an address has submitted a giraffe for a race
    function hasSubmitted(uint256 raceId, address user) external view returns (bool) {
        return _hasSubmittedGiraffe[raceId][user];
    }

    /// @notice Check if a token has been entered in a race
    function isTokenEntered(uint256 raceId, uint256 tokenId) external view returns (bool) {
        return _tokenEntered[raceId][tokenId];
    }

    /// @notice Get entry at a specific index
    function getRaceEntry(uint256 raceId, uint256 index) external view returns (uint256 tokenId, address submitter) {
        RaceEntry storage entry = _raceEntries[raceId][index];
        return (entry.tokenId, entry.submitter);
    }
}
