// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "./GiraffeRaceStorage.sol";

/**
 * @title ClaimLib
 * @notice Library for claim-related calculations and winner detection
 * @dev Extracted from GiraffeRace to reduce contract size and improve reusability
 */
library ClaimLib {
    uint16 internal constant ODDS_SCALE = 10000;
    uint8 internal constant LANE_COUNT = 6;

    /// @notice Calculate payout for a winning bet
    /// @param betAmount The amount bet
    /// @param decimalOddsBps The decimal odds in basis points
    /// @param deadHeatCount Number of winners (1 = normal, 2+ = dead heat)
    /// @return payout The calculated payout amount
    function calculatePayout(
        uint256 betAmount,
        uint32 decimalOddsBps,
        uint8 deadHeatCount
    ) internal pure returns (uint256 payout) {
        // Winner payout: (betAmount * odds) / ODDS_SCALE / deadHeatCount
        payout = (betAmount * uint256(decimalOddsBps)) / ODDS_SCALE;
        if (deadHeatCount > 1) {
            payout = payout / uint256(deadHeatCount);
        }
    }

    /// @notice Check if a lane is among the winners (supports dead heat)
    /// @param winners Array of winning lane indices
    /// @param deadHeatCount Number of winners
    /// @param lane The lane to check
    /// @return True if the lane is a winner
    function isWinner(
        uint8[LANE_COUNT] memory winners,
        uint8 deadHeatCount,
        uint8 lane
    ) internal pure returns (bool) {
        for (uint8 i = 0; i < deadHeatCount; i++) {
            if (winners[i] == lane) return true;
        }
        return false;
    }

    /// @notice Check if a lane is a winner using storage reference
    /// @param race The race storage reference
    /// @param lane The lane to check
    /// @return True if the lane is a winner
    function isWinnerFromRace(
        GiraffeRaceStorage.Race storage race,
        uint8 lane
    ) internal view returns (bool) {
        for (uint8 i = 0; i < race.deadHeatCount; i++) {
            if (race.winners[i] == lane) return true;
        }
        return false;
    }

    /// @notice Calculate the maximum potential payout across all lanes for a race
    /// @param totalOnLane Array of total bets on each lane
    /// @param decimalOddsBps Array of decimal odds for each lane
    /// @return maxPayout The maximum potential payout
    function calculateMaxPayout(
        uint256[LANE_COUNT] memory totalOnLane,
        uint32[LANE_COUNT] memory decimalOddsBps
    ) internal pure returns (uint256 maxPayout) {
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            uint256 payoutIfWin = (totalOnLane[i] * uint256(decimalOddsBps[i])) / ODDS_SCALE;
            if (payoutIfWin > maxPayout) {
                maxPayout = payoutIfWin;
            }
        }
    }

    /// @notice Calculate projected max payout with a new bet
    /// @param totalOnLane Current totals on each lane
    /// @param decimalOddsBps Odds for each lane
    /// @param newBetLane Lane for the new bet
    /// @param newBetAmount Amount of the new bet
    /// @return maxPayout The maximum potential payout including the new bet
    function calculateProjectedMaxPayout(
        uint256[LANE_COUNT] memory totalOnLane,
        uint32[LANE_COUNT] memory decimalOddsBps,
        uint8 newBetLane,
        uint256 newBetAmount
    ) internal pure returns (uint256 maxPayout) {
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            uint256 laneTotal = totalOnLane[i];
            if (i == newBetLane) {
                laneTotal += newBetAmount;
            }
            uint256 payoutIfWin = (laneTotal * uint256(decimalOddsBps[i])) / ODDS_SCALE;
            if (payoutIfWin > maxPayout) {
                maxPayout = payoutIfWin;
            }
        }
    }

    /// @notice Calculate total liability for a settled race (sum of winning lane payouts / deadHeatCount)
    /// @param race The race storage reference
    /// @return liability Total liability for the race
    function calculateRaceLiability(
        GiraffeRaceStorage.Race storage race
    ) internal view returns (uint256 liability) {
        uint8 winnerCount = race.deadHeatCount;
        for (uint8 i = 0; i < winnerCount; i++) {
            uint8 w = race.winners[i];
            uint256 lanePayout = (race.totalOnLane[w] * uint256(race.decimalOddsBps[w])) / ODDS_SCALE;
            liability += lanePayout / uint256(winnerCount);
        }
    }
}
