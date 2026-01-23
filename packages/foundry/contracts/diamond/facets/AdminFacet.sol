// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage, IWinProbTable6 } from "../libraries/GiraffeRaceStorage.sol";

/**
 * @title AdminFacet
 * @notice Admin functions for GiraffeRace configuration
 * @dev Only callable by treasuryOwner
 */
contract AdminFacet {
    /// @notice Update the house edge (in basis points). Max 30%.
    /// @param newEdgeBps The new house edge in basis points (e.g., 500 = 5%).
    function setHouseEdgeBps(uint16 newEdgeBps) external {
        GiraffeRaceStorage.enforceIsTreasuryOwner();
        if (newEdgeBps > GiraffeRaceStorage.MAX_HOUSE_EDGE_BPS) {
            revert GiraffeRaceStorage.HouseEdgeTooHigh();
        }
        
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint16 oldEdgeBps = s.houseEdgeBps;
        s.houseEdgeBps = newEdgeBps;
        
        emit GiraffeRaceStorage.HouseEdgeUpdated(oldEdgeBps, newEdgeBps);
    }

    /// @notice Update the maximum bet amount (in USDC, 6 decimals).
    /// @param newMaxBet The new max bet amount (e.g., 5_000_000 = 5 USDC).
    function setMaxBetAmount(uint256 newMaxBet) external {
        GiraffeRaceStorage.enforceIsTreasuryOwner();
        
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256 oldMaxBet = s.maxBetAmount;
        s.maxBetAmount = newMaxBet;
        
        emit GiraffeRaceStorage.MaxBetUpdated(oldMaxBet, newMaxBet);
    }

    /// @notice Update the win probability table contract address.
    /// @dev Set to address(0) to use fallback fixed odds.
    function setWinProbTable(address _winProbTable) external {
        GiraffeRaceStorage.enforceIsTreasuryOwner();
        
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        s.winProbTable = IWinProbTable6(_winProbTable);
        
        emit GiraffeRaceStorage.WinProbTableUpdated(_winProbTable);
    }

    /// @notice Cancel a stuck race and enable refunds for all bettors
    /// @dev Only callable by treasuryOwner. Use when a race cannot be settled (e.g., blockhash expired).
    ///      After cancellation, bettors can claim() to receive their original bet back.
    /// @param raceId The race ID to cancel
    function adminCancelRace(uint256 raceId) external {
        GiraffeRaceStorage.enforceIsTreasuryOwner();
        
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        
        // Validate race exists
        if (raceId >= s.nextRaceId) revert GiraffeRaceStorage.InvalidRace();
        
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        
        // Cannot cancel already settled race
        if (r.settled) revert GiraffeRaceStorage.AlreadySettled();
        
        // Cannot cancel already cancelled race
        if (r.cancelled) revert GiraffeRaceStorage.AlreadyCancelled();
        
        // Mark as cancelled and settled (so new race can be created)
        r.cancelled = true;
        r.settled = true;
        r.settledAtBlock = uint64(block.number);
        
        emit GiraffeRaceStorage.RaceCancelled(raceId);
    }

    // ============ View Functions ============

    function treasuryOwner() external view returns (address) {
        return GiraffeRaceStorage.layout().treasuryOwner;
    }

    // DEBUG: Return raw storage info
    function debugStorage() external view returns (
        bytes32 storageSlot,
        address storedTreasuryOwner,
        address storedGiraffeNft
    ) {
        storageSlot = GiraffeRaceStorage.STORAGE_SLOT;
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        storedTreasuryOwner = s.treasuryOwner;
        storedGiraffeNft = address(s.giraffeNft);
    }

    function houseEdgeBps() external view returns (uint16) {
        return GiraffeRaceStorage.layout().houseEdgeBps;
    }

    function maxBetAmount() external view returns (uint256) {
        return GiraffeRaceStorage.layout().maxBetAmount;
    }

    function houseGiraffeTokenIds() external view returns (uint256[6] memory) {
        return GiraffeRaceStorage.layout().houseGiraffeTokenIds;
    }
}
