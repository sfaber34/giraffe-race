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

    /// @notice THE SINGLE SOURCE OF TRUTH for payout calculation
    /// @dev This function is used for BOTH settlement liability AND claim payouts
    ///      to ensure they NEVER diverge. Any change here affects both.
    /// @param amount The amount (bet amount for claims, totalOnLane for settlement)
    /// @param oddsBps The decimal odds in basis points
    /// @param deadHeatDivisor Number to divide by for dead heat (1 = no dead heat)
    /// @return payout The calculated payout amount
    function calculatePayout(
        uint256 amount,
        uint32 oddsBps,
        uint8 deadHeatDivisor
    ) internal pure returns (uint256 payout) {
        // CRITICAL: This exact calculation must be used everywhere
        // payout = (amount * odds) / ODDS_SCALE / deadHeatDivisor
        payout = (amount * uint256(oddsBps)) / ODDS_SCALE;
        if (deadHeatDivisor > 1) {
            payout = payout / uint256(deadHeatDivisor);
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
    /// @dev Uses calculatePayout for consistency
    /// @param totalOnLane Array of total bets on each lane
    /// @param decimalOddsBps Array of decimal odds for each lane
    /// @return maxPayout The maximum potential payout
    function calculateMaxPayout(
        uint256[6] memory totalOnLane,
        uint32[6] memory decimalOddsBps
    ) internal pure returns (uint256 maxPayout) {
        for (uint8 i = 0; i < LANE_COUNT; ) {
            // Use calculatePayout with deadHeatDivisor=1 (worst case - no dead heat)
            uint256 payoutIfWin = calculatePayout(totalOnLane[i], decimalOddsBps[i], 1);
            if (payoutIfWin > maxPayout) {
                maxPayout = payoutIfWin;
            }
            unchecked { ++i; }
        }
    }

    /// @notice Calculate projected max payout with a new bet
    /// @dev Uses calculatePayout for consistency
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
            // Use calculatePayout with deadHeatDivisor=1 (worst case - no dead heat)
            uint256 payoutIfWin = calculatePayout(laneTotal, decimalOddsBps[i], 1);
            if (payoutIfWin > maxPayout) {
                maxPayout = payoutIfWin;
            }
            unchecked { ++i; }
        }
    }

    /// @notice Calculate total liability for Win bets
    /// @dev Uses calculatePayout to ensure consistency with claim calculations
    /// @param race The race struct
    /// @return liability Total liability for Win bets
    function calculateRaceLiability(
        RaffeRaceBase.Race storage race
    ) internal view returns (uint256 liability) {
        uint8 winnerCount = race.deadHeatCount;
        for (uint8 i = 0; i < winnerCount; ) {
            uint8 lane = race.winners[i];
            // Use the SAME calculatePayout function used at claim time
            liability += calculatePayout(
                race.totalOnLane[lane],
                race.decimalOddsBps[lane],
                winnerCount
            );
            unchecked { ++i; }
        }
    }

    /// @notice Calculate total liability for Place bets (1st or 2nd place)
    /// @dev Uses calculatePayout to ensure consistency with claim calculations
    /// @param race The race struct
    /// @return liability Total Place bet liability
    function calculatePlaceLiability(
        RaffeRaceBase.Race storage race
    ) internal view returns (uint256 liability) {
        // 1st place lanes get full payout (no dead heat divisor)
        for (uint8 i = 0; i < race.firstPlace.count; ) {
            uint8 lane = race.firstPlace.lanes[i];
            // Use the SAME calculatePayout function used at claim time
            liability += calculatePayout(
                race.totalPlaceOnLane[lane],
                race.placeOddsBps[lane],
                1 // No dead heat division for 1st place in Place bets
            );
            unchecked { ++i; }
        }
        
        // 2nd place lanes: split if dead heat for 2nd
        uint8 secondCount = race.secondPlace.count;
        uint8 secondDivisor = secondCount > 1 ? secondCount : 1;
        for (uint8 i = 0; i < secondCount; ) {
            uint8 lane = race.secondPlace.lanes[i];
            // Use the SAME calculatePayout function used at claim time
            liability += calculatePayout(
                race.totalPlaceOnLane[lane],
                race.placeOddsBps[lane],
                secondDivisor
            );
            unchecked { ++i; }
        }
    }

    /// @notice Calculate total liability for Show bets (1st, 2nd, or 3rd place)
    /// @dev Uses calculatePayout to ensure consistency with claim calculations
    /// @param race The race struct
    /// @return liability Total Show bet liability
    function calculateShowLiability(
        RaffeRaceBase.Race storage race
    ) internal view returns (uint256 liability) {
        // 1st place lanes get full payout (no dead heat divisor)
        for (uint8 i = 0; i < race.firstPlace.count; ) {
            uint8 lane = race.firstPlace.lanes[i];
            // Use the SAME calculatePayout function used at claim time
            liability += calculatePayout(
                race.totalShowOnLane[lane],
                race.showOddsBps[lane],
                1 // No dead heat division for 1st place in Show bets
            );
            unchecked { ++i; }
        }
        
        // 2nd place lanes get full payout (no dead heat divisor)
        for (uint8 i = 0; i < race.secondPlace.count; ) {
            uint8 lane = race.secondPlace.lanes[i];
            // Use the SAME calculatePayout function used at claim time
            liability += calculatePayout(
                race.totalShowOnLane[lane],
                race.showOddsBps[lane],
                1 // No dead heat division for 2nd place in Show bets
            );
            unchecked { ++i; }
        }
        
        // 3rd place lanes: split if dead heat for 3rd
        uint8 thirdCount = race.thirdPlace.count;
        uint8 thirdDivisor = thirdCount > 1 ? thirdCount : 1;
        for (uint8 i = 0; i < thirdCount; ) {
            uint8 lane = race.thirdPlace.lanes[i];
            // Use the SAME calculatePayout function used at claim time
            liability += calculatePayout(
                race.totalShowOnLane[lane],
                race.showOddsBps[lane],
                thirdDivisor
            );
            unchecked { ++i; }
        }
    }
}
