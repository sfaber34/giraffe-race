// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "../libraries/GiraffeRaceStorage.sol";

/**
 * @title GiraffeSubmissionFacet
 * @notice Handles NFT submission for races
 * @dev Manages the entrant pool for races
 */
contract GiraffeSubmissionFacet {
    /// @notice Submit one of your GiraffeNFTs into the race's entrant pool (non-custodial)
    /// @param tokenId The token ID of the giraffe to submit
    function submitGiraffe(uint256 tokenId) external {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        
        uint256 raceId = GiraffeRaceStorage.activeRaceId();
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        
        // Submissions close before finalization/betting
        if (block.number >= r.submissionCloseBlock) revert GiraffeRaceStorage.SubmissionsClosed();
        if (r.settled) revert GiraffeRaceStorage.AlreadySettled();

        if (s.hasSubmittedGiraffe[raceId][msg.sender]) revert GiraffeRaceStorage.AlreadySubmitted();
        if (s.giraffeNft.ownerOf(tokenId) != msg.sender) revert GiraffeRaceStorage.NotTokenOwner();
        
        // Prevent submitting house giraffes
        for (uint256 i = 0; i < GiraffeRaceStorage.LANE_COUNT; ) {
            if (s.houseGiraffeTokenIds[i] == tokenId) revert GiraffeRaceStorage.InvalidHouseGiraffe();
            unchecked { ++i; }
        }
        
        if (s.tokenEntered[raceId][tokenId]) revert GiraffeRaceStorage.TokenAlreadyEntered();
        if (s.raceEntries[raceId].length >= GiraffeRaceStorage.MAX_ENTRIES_PER_RACE) {
            revert GiraffeRaceStorage.EntryPoolFull();
        }

        // Mark submission
        s.hasSubmittedGiraffe[raceId][msg.sender] = true;
        s.tokenEntered[raceId][tokenId] = true;
        s.raceEntries[raceId].push(GiraffeRaceStorage.RaceEntry({ 
            tokenId: tokenId, 
            submitter: msg.sender 
        }));

        // Lane isn't determined until settlement; emit 255 to mean "pool entry"
        emit GiraffeRaceStorage.GiraffeSubmitted(raceId, msg.sender, tokenId, type(uint8).max);
    }

    // ============ View Functions ============

    /// @notice Get the number of entries submitted for a race
    function getRaceEntryCount(uint256 raceId) external view returns (uint256) {
        return GiraffeRaceStorage.layout().raceEntries[raceId].length;
    }

    /// @notice Check if an address has submitted a giraffe for a race
    function hasSubmitted(uint256 raceId, address user) external view returns (bool) {
        return GiraffeRaceStorage.layout().hasSubmittedGiraffe[raceId][user];
    }

    /// @notice Check if a token has been entered in a race
    function isTokenEntered(uint256 raceId, uint256 tokenId) external view returns (bool) {
        return GiraffeRaceStorage.layout().tokenEntered[raceId][tokenId];
    }

    /// @notice Get entry at a specific index
    function getRaceEntry(uint256 raceId, uint256 index) external view returns (uint256 tokenId, address submitter) {
        GiraffeRaceStorage.RaceEntry storage entry = GiraffeRaceStorage.layout().raceEntries[raceId][index];
        return (entry.tokenId, entry.submitter);
    }
}
