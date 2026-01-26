// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase, IWinProbTable6 } from "./GiraffeRaceBase.sol";

/**
 * @title GiraffeRaceAdmin
 * @notice Admin functions for GiraffeRace configuration
 * @dev Only callable by treasuryOwner
 */
abstract contract GiraffeRaceAdmin is GiraffeRaceBase {
    /// @notice Update the house edge (in basis points). Max 30%.
    /// @param newEdgeBps The new house edge in basis points (e.g., 500 = 5%).
    function setHouseEdgeBps(uint16 newEdgeBps) external onlyTreasuryOwner {
        if (newEdgeBps > MAX_HOUSE_EDGE_BPS) {
            revert HouseEdgeTooHigh();
        }
        
        uint16 oldEdgeBps = houseEdgeBps;
        houseEdgeBps = newEdgeBps;
        
        emit HouseEdgeUpdated(oldEdgeBps, newEdgeBps);
    }

    /// @notice Update the maximum bet amount (in USDC, 6 decimals).
    /// @param newMaxBet The new max bet amount (e.g., 5_000_000 = 5 USDC).
    function setMaxBetAmount(uint256 newMaxBet) external onlyTreasuryOwner {
        uint256 oldMaxBet = maxBetAmount;
        maxBetAmount = newMaxBet;
        
        emit MaxBetUpdated(oldMaxBet, newMaxBet);
    }

    /// @notice Update the win probability table contract address.
    /// @dev Set to address(0) to use fallback fixed odds.
    function setWinProbTable(address _winProbTable) external onlyTreasuryOwner {
        winProbTable = IWinProbTable6(_winProbTable);
        
        emit WinProbTableUpdated(_winProbTable);
    }

    /// @notice Cancel a stuck race and enable refunds for all bettors
    /// @dev Only callable by treasuryOwner. Use when a race cannot be settled (e.g., blockhash expired).
    ///      After cancellation, bettors can claim() to receive their original bet back.
    /// @param raceId The race ID to cancel
    function adminCancelRace(uint256 raceId) external onlyTreasuryOwner {
        // Validate race exists
        if (raceId >= nextRaceId) revert InvalidRace();
        
        Race storage r = _races[raceId];
        
        // Cannot cancel already settled race
        if (r.settled) revert AlreadySettled();
        
        // Cannot cancel already cancelled race
        if (r.cancelled) revert AlreadyCancelled();
        
        // Mark as cancelled and settled (so new race can be created)
        r.cancelled = true;
        r.settled = true;
        r.settledAtBlock = uint64(block.number);
        
        emit RaceCancelled(raceId);
    }

    // ============ View Functions ============

    function getHouseGiraffeTokenIds() external view returns (uint256[6] memory) {
        return houseGiraffeTokenIds;
    }
}
