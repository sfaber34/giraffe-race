// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "../GiraffeRaceBase.sol";
import { GiraffeRaceSimulator } from "../GiraffeRaceSimulator.sol";
import { ClaimLib } from "./ClaimLib.sol";

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
        
        // Get ALL winners (supports dead heat)
        (uint8[6] memory winners, uint8 winnerCount,) = 
            simulator.winnersWithScore(simSeed, raceScore);

        // Update race state
        race.settled = true;
        race.settledAtBlock = uint64(block.number);
        race.winner = winners[0];
        race.deadHeatCount = winnerCount;
        race.winners = winners;
        race.seed = simSeed;

        // Record liability for payouts
        newSettledLiability = settledLiability;
        if (race.totalPot != 0) {
            newSettledLiability += ClaimLib.calculateRaceLiability(race);
        }

        // Emit appropriate event
        if (winnerCount > 1) {
            emit GiraffeRaceBase.RaceSettledDeadHeat(raceId, simSeed, winnerCount, winners);
        } else {
            emit GiraffeRaceBase.RaceSettled(raceId, simSeed, race.winner);
        }
    }
}
