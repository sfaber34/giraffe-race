// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { RaffeRaceBase } from "../RaffeRaceBase.sol";
import { RaffeRaceConstants as C } from "./RaffeRaceConstants.sol";

/**
 * @title ClaimLib
 * @notice Library for claim-related calculations and winner detection
 * @dev Extracted to reduce contract size and improve reusability.
 *      Uses literals for array sizes (Solidity requirement) - verified via _checkConstants().
 */
library ClaimLib {
    // Literals required for array sizes in function signatures
    uint8 internal constant LANE_COUNT = 6;
    uint16 internal constant ODDS_SCALE = 10000;

    /// @dev Verify constants match central source. Called in tests.
    function _checkConstants() internal pure {
        assert(LANE_COUNT == C.LANE_COUNT);
        assert(ODDS_SCALE == C.ODDS_SCALE);
    }

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
        uint8[6] memory winners,
        uint8 deadHeatCount,
        uint8 lane
    ) internal pure returns (bool) {
        for (uint8 i = 0; i < deadHeatCount; ) {
            if (winners[i] == lane) return true;
            unchecked { ++i; }
        }
        return false;
    }

    /// @notice Check if a lane is a winner using race struct
    /// @param race The race struct
    /// @param lane The lane to check
    /// @return True if the lane is a winner
    function isWinnerFromRace(
        RaffeRaceBase.Race storage race,
        uint8 lane
    ) internal view returns (bool) {
        for (uint8 i = 0; i < race.deadHeatCount; ) {
            if (race.winners[i] == lane) return true;
            unchecked { ++i; }
        }
        return false;
    }

    /// @notice Check if a lane is in a specific position (1st, 2nd, or 3rd)
    /// @param position The position info struct
    /// @param lane The lane to check
    /// @return True if the lane is in this position
    function isLaneInPosition(
        RaffeRaceBase.PositionInfo storage position,
        uint8 lane
    ) internal view returns (bool) {
        for (uint8 i = 0; i < position.count; ) {
            if (position.lanes[i] == lane) return true;
            unchecked { ++i; }
        }
        return false;
    }

    /// @notice Check if a lane is in a specific position (memory version)
    /// @param position The position info struct
    /// @param lane The lane to check
    /// @return True if the lane is in this position
    function isLaneInPositionMemory(
        RaffeRaceBase.PositionInfo memory position,
        uint8 lane
    ) internal pure returns (bool) {
        for (uint8 i = 0; i < position.count; ) {
            if (position.lanes[i] == lane) return true;
            unchecked { ++i; }
        }
        return false;
    }

    /// @notice Calculate the maximum potential payout across all lanes for a race
    /// @param totalOnLane Array of total bets on each lane
    /// @param decimalOddsBps Array of decimal odds for each lane
    /// @return maxPayout The maximum potential payout
    function calculateMaxPayout(
        uint256[6] memory totalOnLane,
        uint32[6] memory decimalOddsBps
    ) internal pure returns (uint256 maxPayout) {
        for (uint8 i = 0; i < LANE_COUNT; ) {
            uint256 payoutIfWin = (totalOnLane[i] * uint256(decimalOddsBps[i])) / ODDS_SCALE;
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
        uint256[6] memory totalOnLane,
        uint32[6] memory decimalOddsBps,
        uint8 newBetLane,
        uint256 newBetAmount
    ) internal pure returns (uint256 maxPayout) {
        for (uint8 i = 0; i < LANE_COUNT; ) {
            uint256 laneTotal = totalOnLane[i];
            if (i == newBetLane) {
                laneTotal += newBetAmount;
            }
            uint256 payoutIfWin = (laneTotal * uint256(decimalOddsBps[i])) / ODDS_SCALE;
            if (payoutIfWin > maxPayout) {
                maxPayout = payoutIfWin;
            }
            unchecked { ++i; }
        }
    }

    /// @notice Calculate total liability for a settled race (Win bets only - legacy)
    /// @param race The race struct
    /// @return liability Total liability for the race
    function calculateRaceLiability(
        RaffeRaceBase.Race storage race
    ) internal view returns (uint256 liability) {
        uint8 winnerCount = race.deadHeatCount;
        for (uint8 i = 0; i < winnerCount; ) {
            uint8 w = race.winners[i];
            uint256 lanePayout = (race.totalOnLane[w] * uint256(race.decimalOddsBps[w])) / ODDS_SCALE;
            liability += lanePayout / uint256(winnerCount);
            unchecked { ++i; }
        }
    }

    /// @notice Calculate total liability for Place bets (1st or 2nd place)
    /// @param race The race struct
    /// @param placeOddsBps Fixed odds for Place bets
    /// @return liability Total Place bet liability
    function calculatePlaceLiability(
        RaffeRaceBase.Race storage race,
        uint32 placeOddsBps
    ) internal view returns (uint256 liability) {
        // 1st place lanes get full payout
        for (uint8 i = 0; i < race.firstPlace.count; ) {
            uint8 lane = race.firstPlace.lanes[i];
            uint256 lanePayout = (race.totalPlaceOnLane[lane] * uint256(placeOddsBps)) / ODDS_SCALE;
            liability += lanePayout;
            unchecked { ++i; }
        }
        
        // 2nd place lanes: split if dead heat
        uint8 secondCount = race.secondPlace.count;
        for (uint8 i = 0; i < secondCount; ) {
            uint8 lane = race.secondPlace.lanes[i];
            uint256 lanePayout = (race.totalPlaceOnLane[lane] * uint256(placeOddsBps)) / ODDS_SCALE;
            // Split payout if dead heat for 2nd
            liability += lanePayout / uint256(secondCount > 1 ? secondCount : 1);
            unchecked { ++i; }
        }
    }

    /// @notice Calculate total liability for Show bets (1st, 2nd, or 3rd place)
    /// @param race The race struct
    /// @param showOddsBps Fixed odds for Show bets
    /// @return liability Total Show bet liability
    function calculateShowLiability(
        RaffeRaceBase.Race storage race,
        uint32 showOddsBps
    ) internal view returns (uint256 liability) {
        // 1st place lanes get full payout
        for (uint8 i = 0; i < race.firstPlace.count; ) {
            uint8 lane = race.firstPlace.lanes[i];
            uint256 lanePayout = (race.totalShowOnLane[lane] * uint256(showOddsBps)) / ODDS_SCALE;
            liability += lanePayout;
            unchecked { ++i; }
        }
        
        // 2nd place lanes get full payout
        for (uint8 i = 0; i < race.secondPlace.count; ) {
            uint8 lane = race.secondPlace.lanes[i];
            uint256 lanePayout = (race.totalShowOnLane[lane] * uint256(showOddsBps)) / ODDS_SCALE;
            liability += lanePayout;
            unchecked { ++i; }
        }
        
        // 3rd place lanes: split if dead heat
        uint8 thirdCount = race.thirdPlace.count;
        for (uint8 i = 0; i < thirdCount; ) {
            uint8 lane = race.thirdPlace.lanes[i];
            uint256 lanePayout = (race.totalShowOnLane[lane] * uint256(showOddsBps)) / ODDS_SCALE;
            // Split payout if dead heat for 3rd
            liability += lanePayout / uint256(thirdCount > 1 ? thirdCount : 1);
            unchecked { ++i; }
        }
    }
}
