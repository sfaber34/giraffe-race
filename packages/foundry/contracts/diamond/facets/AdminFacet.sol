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

    // ============ View Functions ============

    function treasuryOwner() external view returns (address) {
        return GiraffeRaceStorage.layout().treasuryOwner;
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
