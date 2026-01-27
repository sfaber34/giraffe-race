// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "../GiraffeRaceBase.sol";
import { GiraffeRaceSimulator } from "../GiraffeRaceSimulator.sol";
import { ClaimLib } from "./ClaimLib.sol";
import { GiraffeRaceConstants as C } from "./GiraffeRaceConstants.sol";

/**
 * @title SettlementLib
 * @notice Library for race settlement logic
 * @dev Extracted to eliminate duplication
 */
library SettlementLib {
    /// @notice Settle a race - determines winner(s) and records liability
    /// @dev Can be called from both settleRace() and on-demand during claims
    /// @param race The race struct to settle
    /// @param raceId The race ID
    /// @param raceScore The scores for each lane
    /// @param simulator The simulator contract
    /// @param settledLiability Current settled liability (will be updated)
    /// @return newSettledLiability The updated settled liability
    function settleRace(
        GiraffeRaceBase.Race storage race,
        uint256 raceId,
        uint8[6] storage raceScore,
        GiraffeRaceSimulator simulator,
        uint256 settledLiability
    ) internal returns (uint256 newSettledLiability) {
        // Validation
        if (race.bettingCloseBlock == 0) revert GiraffeRaceBase.InvalidRace();
        if (race.settled) revert GiraffeRaceBase.AlreadySettled();
        if (block.number <= race.bettingCloseBlock) revert GiraffeRaceBase.RaceNotReady();
        
        // Fixed odds required only if there were bets
        if (race.totalPot != 0 && !race.oddsSet) revert GiraffeRaceBase.OddsNotSet();

        // Get blockhash for randomness
        bytes32 bh = blockhash(race.bettingCloseBlock);
        if (bh == bytes32(0)) {
            // Blockhash not available (>256 blocks ago) - race cannot be settled
            // Admin should cancel this race for refunds
            revert GiraffeRaceBase.RaceNotReady();
        }

        // Generate deterministic seed
        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 simSeed = keccak256(abi.encodePacked(baseSeed, "RACE_SIM"));
        
        // Run full race simulation (until all racers finish)
        GiraffeRaceSimulator.FinishOrder memory finishOrder = 
            simulator.simulateFullRace(simSeed, raceScore);

        // Update race state - legacy fields for backwards compatibility
        race.settled = true;
        race.settledAtBlock = uint64(block.number);
        race.winner = finishOrder.first.lanes[0];
        race.deadHeatCount = finishOrder.first.count;
        race.seed = simSeed;
        
        // Copy first place winners to legacy winners array
        for (uint8 i = 0; i < finishOrder.first.count; i++) {
            race.winners[i] = finishOrder.first.lanes[i];
        }
        
        // Store complete finish order for Win/Place/Show
        race.firstPlace.count = finishOrder.first.count;
        race.secondPlace.count = finishOrder.second.count;
        race.thirdPlace.count = finishOrder.third.count;
        
        for (uint8 i = 0; i < 6; i++) {
            race.firstPlace.lanes[i] = finishOrder.first.lanes[i];
            race.secondPlace.lanes[i] = finishOrder.second.lanes[i];
            race.thirdPlace.lanes[i] = finishOrder.third.lanes[i];
            race.finalDistances[i] = finishOrder.distances[i];
        }

        // Record liability for payouts (Win + Place + Show)
        newSettledLiability = settledLiability;
        if (race.totalPot != 0) {
            // Win bet liability
            newSettledLiability += ClaimLib.calculateRaceLiability(race);
            // Place bet liability
            newSettledLiability += ClaimLib.calculatePlaceLiability(race, C.TEMP_FIXED_PLACE_ODDS_BPS);
            // Show bet liability
            newSettledLiability += ClaimLib.calculateShowLiability(race, C.TEMP_FIXED_SHOW_ODDS_BPS);
        }

        // Emit appropriate event
        if (finishOrder.first.count > 1) {
            emit GiraffeRaceBase.RaceSettledDeadHeat(raceId, simSeed, finishOrder.first.count, race.winners);
        } else {
            emit GiraffeRaceBase.RaceSettled(raceId, simSeed, race.winner);
        }
    }
}
