// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "./GiraffeRaceStorage.sol";
import { ClaimLib } from "./ClaimLib.sol";

/**
 * @title SettlementLib
 * @notice Library for race settlement logic
 * @dev Extracted to eliminate duplication between RaceLifecycleFacet and BettingFacet
 */
library SettlementLib {
    /// @notice Settle a race - determines winner(s) and records liability
    /// @dev Can be called from both settleRace() and on-demand during claims
    /// @param s The storage layout reference
    /// @param raceId The race ID to settle
    function settleRace(
        GiraffeRaceStorage.Layout storage s,
        uint256 raceId
    ) internal {
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        
        // Validation
        if (r.submissionCloseBlock == 0) revert GiraffeRaceStorage.InvalidRace();
        if (r.settled) revert GiraffeRaceStorage.AlreadySettled();
        if (!r.giraffesFinalized) revert GiraffeRaceStorage.RaceNotReady();
        if (r.bettingCloseBlock == 0) revert GiraffeRaceStorage.RaceNotReady();
        if (block.number <= r.bettingCloseBlock) revert GiraffeRaceStorage.RaceNotReady();
        
        // Fixed odds required only if there were bets
        if (r.totalPot != 0 && !r.oddsSet) revert GiraffeRaceStorage.OddsNotSet();

        // Get blockhash for randomness
        bytes32 bh = blockhash(r.bettingCloseBlock);
        if (bh == bytes32(0)) revert GiraffeRaceStorage.BlockhashUnavailable();

        // Generate deterministic seed
        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 simSeed = keccak256(abi.encodePacked(baseSeed, "RACE_SIM"));
        
        // Get ALL winners (supports dead heat)
        (uint8[6] memory winners, uint8 winnerCount,) = 
            s.simulator.winnersWithScore(simSeed, s.raceScore[raceId]);

        // Update race state
        r.settled = true;
        r.settledAtBlock = uint64(block.number);
        r.winner = winners[0];
        r.deadHeatCount = winnerCount;
        r.winners = winners;
        r.seed = simSeed;

        // Record liability for payouts
        if (r.totalPot != 0) {
            s.settledLiability += ClaimLib.calculateRaceLiability(r);
        }

        // Emit appropriate event
        if (winnerCount > 1) {
            emit GiraffeRaceStorage.RaceSettledDeadHeat(raceId, simSeed, winnerCount, winners);
        } else {
            emit GiraffeRaceStorage.RaceSettled(raceId, simSeed, r.winner);
        }
    }
}
