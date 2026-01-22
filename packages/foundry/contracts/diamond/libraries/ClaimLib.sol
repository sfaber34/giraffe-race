// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "./GiraffeRaceStorage.sol";

/**
 * @title ClaimLib
 * @notice Library for claim-related calculations and winner detection
 * @dev Extracted from GiraffeRace to reduce contract size and improve reusability
 *      Uses constants from GiraffeRaceStorage (except for array sizes which require literals)
 */
library ClaimLib {
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
        payout = (betAmount * uint256(decimalOddsBps)) / GiraffeRaceStorage.ODDS_SCALE;
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
        uint8[6] memory winners, // Literal 6 required by Solidity for array size
        uint8 deadHeatCount,
        uint8 lane
    ) internal pure returns (bool) {
        for (uint8 i = 0; i < deadHeatCount; ) {
            if (winners[i] == lane) return true;
            unchecked { ++i; }
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
        for (uint8 i = 0; i < race.deadHeatCount; ) {
            if (race.winners[i] == lane) return true;
            unchecked { ++i; }
        }
        return false;
    }

    /// @notice Calculate the maximum potential payout across all lanes for a race
    /// @param totalOnLane Array of total bets on each lane
    /// @param decimalOddsBps Array of decimal odds for each lane
    /// @return maxPayout The maximum potential payout
    function calculateMaxPayout(
        uint256[6] memory totalOnLane, // Literal 6 required by Solidity for array size
        uint32[6] memory decimalOddsBps
    ) internal pure returns (uint256 maxPayout) {
        for (uint8 i = 0; i < GiraffeRaceStorage.LANE_COUNT; ) {
            uint256 payoutIfWin = (totalOnLane[i] * uint256(decimalOddsBps[i])) / GiraffeRaceStorage.ODDS_SCALE;
            if (payoutIfWin > maxPayout) {
                maxPayout = payoutIfWin;
            }
            unchecked { ++i; }
        }
    }

    /// @notice Calculate projected max payout with a new bet
    /// @param totalOnLane Current totals on each lane
    /// @param decimalOddsBps Odds for each lane
    /// @param newBetLane Lane for the new bet
    /// @param newBetAmount Amount of the new bet
    /// @return maxPayout The maximum potential payout including the new bet
    function calculateProjectedMaxPayout(
        uint256[6] memory totalOnLane, // Literal 6 required by Solidity for array size
        uint32[6] memory decimalOddsBps,
        uint8 newBetLane,
        uint256 newBetAmount
    ) internal pure returns (uint256 maxPayout) {
        for (uint8 i = 0; i < GiraffeRaceStorage.LANE_COUNT; ) {
            uint256 laneTotal = totalOnLane[i];
            if (i == newBetLane) {
                laneTotal += newBetAmount;
            }
            uint256 payoutIfWin = (laneTotal * uint256(decimalOddsBps[i])) / GiraffeRaceStorage.ODDS_SCALE;
            if (payoutIfWin > maxPayout) {
                maxPayout = payoutIfWin;
            }
            unchecked { ++i; }
        }
    }

    /// @notice Calculate total liability for a settled race (sum of winning lane payouts / deadHeatCount)
    /// @param race The race storage reference
    /// @return liability Total liability for the race
    function calculateRaceLiability(
        GiraffeRaceStorage.Race storage race
    ) internal view returns (uint256 liability) {
        uint8 winnerCount = race.deadHeatCount;
        for (uint8 i = 0; i < winnerCount; ) {
            uint8 w = race.winners[i];
            uint256 lanePayout = (race.totalOnLane[w] * uint256(race.decimalOddsBps[w])) / GiraffeRaceStorage.ODDS_SCALE;
            liability += lanePayout / uint256(winnerCount);
            unchecked { ++i; }
        }
    }
}
