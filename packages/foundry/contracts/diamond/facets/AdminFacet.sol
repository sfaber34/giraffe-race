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

    /// @notice Publish the fixed decimal odds for a race (must be done after lineup is finalized).
    /// @dev Odds must be set before any bets can be placed. House-only to protect bankroll.
    function setRaceOdds(uint256 raceId, uint32[6] calldata decimalOddsBps) external {
        GiraffeRaceStorage.enforceIsTreasuryOwner();
        
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        
        if (r.submissionCloseBlock == 0) revert GiraffeRaceStorage.InvalidRace();
        if (r.settled) revert GiraffeRaceStorage.AlreadySettled();
        if (!r.giraffesFinalized) revert GiraffeRaceStorage.RaceNotReady();
        if (r.oddsSet) revert GiraffeRaceStorage.OddsAlreadySet();

        // Must be within the betting window
        if (r.bettingCloseBlock == 0) revert GiraffeRaceStorage.BettingNotOpen();
        if (block.number >= r.bettingCloseBlock) revert GiraffeRaceStorage.BettingClosed();

        // Validate overround
        uint256 invSumBps = 0;
        for (uint8 i = 0; i < GiraffeRaceStorage.LANE_COUNT; ) {
            uint32 o = decimalOddsBps[i];
            if (o < GiraffeRaceStorage.MIN_DECIMAL_ODDS_BPS) revert GiraffeRaceStorage.InvalidOdds();
            
            uint256 num = uint256(GiraffeRaceStorage.ODDS_SCALE) * uint256(GiraffeRaceStorage.ODDS_SCALE);
            invSumBps += (num + uint256(o) - 1) / uint256(o);
            unchecked { ++i; }
        }

        uint256 minOverroundBps = (
            uint256(GiraffeRaceStorage.ODDS_SCALE) * uint256(GiraffeRaceStorage.ODDS_SCALE) 
            + (GiraffeRaceStorage.ODDS_SCALE - s.houseEdgeBps) - 1
        ) / (GiraffeRaceStorage.ODDS_SCALE - s.houseEdgeBps);
        
        if (invSumBps < minOverroundBps) revert GiraffeRaceStorage.InvalidOdds();

        r.decimalOddsBps = decimalOddsBps;
        r.oddsSet = true;
        
        emit GiraffeRaceStorage.RaceOddsSet(raceId, decimalOddsBps);
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
