// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "./GiraffeRaceStorage.sol";

/**
 * @title OddsLib
 * @notice Library for odds calculation and validation
 * @dev Extracted from GiraffeRace to reduce contract size and improve reusability
 *      Uses constants from GiraffeRaceStorage (except for array sizes which require literals)
 */
library OddsLib {
    /// @notice Convert win probability (in bps) to decimal odds with house edge
    /// @param probBps Win probability in basis points (e.g., 1667 = 16.67%)
    /// @param houseEdgeBps House edge in basis points (e.g., 500 = 5%)
    /// @return oddsDecimalBps Decimal odds in basis points (e.g., 57000 = 5.70x)
    function probabilityToOdds(
        uint16 probBps,
        uint16 houseEdgeBps
    ) internal pure returns (uint32 oddsDecimalBps) {
        // Avoid division by zero
        if (probBps == 0) probBps = 1;
        
        // Decimal odds formula: (1 - houseEdge) / probability
        // In basis points: (ODDS_SCALE * (ODDS_SCALE - houseEdgeBps)) / probBps
        uint256 odds = (uint256(GiraffeRaceStorage.ODDS_SCALE) * uint256(GiraffeRaceStorage.ODDS_SCALE - houseEdgeBps)) / uint256(probBps);
        
        // Apply minimum odds floor
        if (odds < GiraffeRaceStorage.MIN_DECIMAL_ODDS_BPS) {
            odds = GiraffeRaceStorage.MIN_DECIMAL_ODDS_BPS;
        }
        
        return uint32(odds);
    }

    /// @notice Validate that odds array meets minimum overround requirement for house edge
    /// @dev Overround formula: sum(1/O_i) >= 1/(1-edge)
    /// @param decimalOddsBps Array of decimal odds in basis points
    /// @param houseEdgeBps House edge in basis points
    /// @return valid True if odds meet the overround requirement
    function validateOverround(
        uint32[6] memory decimalOddsBps, // Literal 6 required by Solidity for array size
        uint16 houseEdgeBps
    ) internal pure returns (bool valid) {
        uint256 invSumBps = 0;
        
        for (uint8 i = 0; i < GiraffeRaceStorage.LANE_COUNT; ) {
            uint32 o = decimalOddsBps[i];
            if (o < GiraffeRaceStorage.MIN_DECIMAL_ODDS_BPS) return false;
            
            // inv in bps: (ODDS_SCALE^2 / o) with ceil division
            uint256 num = uint256(GiraffeRaceStorage.ODDS_SCALE) * uint256(GiraffeRaceStorage.ODDS_SCALE);
            invSumBps += (num + uint256(o) - 1) / uint256(o);
            unchecked { ++i; }
        }
        
        // Minimum overround: ODDS_SCALE^2 / (ODDS_SCALE - houseEdgeBps) with ceil
        uint256 minOverroundBps = (uint256(GiraffeRaceStorage.ODDS_SCALE) * uint256(GiraffeRaceStorage.ODDS_SCALE) + (GiraffeRaceStorage.ODDS_SCALE - houseEdgeBps) - 1)
            / (GiraffeRaceStorage.ODDS_SCALE - houseEdgeBps);
        
        return invSumBps >= minOverroundBps;
    }

    /// @notice Adjust probabilities for lanes with identical scores (symmetry fix)
    /// @dev Monte Carlo-estimated probabilities may differ slightly for same-score lanes
    /// @param probsBps Original probabilities from lookup table
    /// @param scores Lane scores (1-10)
    /// @return adjusted Adjusted probabilities with averaged values for same-score groups
    function adjustProbabilitiesForSymmetry(
        uint16[6] memory probsBps, // Literal 6 required by Solidity for array size
        uint8[6] memory scores
    ) internal pure returns (uint16[6] memory adjusted) {
        adjusted = probsBps;
        
        // Group lanes by score and average their probabilities
        for (uint8 i = 0; i < GiraffeRaceStorage.LANE_COUNT; ) {
            uint256 sum = uint256(probsBps[i]);
            uint8 count = 1;
            
            // Find all lanes with the same score
            for (uint8 j = 0; j < GiraffeRaceStorage.LANE_COUNT; ) {
                if (j != i && scores[j] == scores[i]) {
                    sum += uint256(probsBps[j]);
                    unchecked { ++count; }
                }
                unchecked { ++j; }
            }
            
            // Average the probabilities for this score group
            if (count > 1) {
                adjusted[i] = uint16((sum + (count / 2)) / count);
            }
            unchecked { ++i; }
        }
    }

    /// @notice Convert an array of probabilities to decimal odds
    /// @param probsBps Array of win probabilities in basis points
    /// @param houseEdgeBps House edge in basis points
    /// @return oddsDecimalBps Array of decimal odds in basis points
    function probabilitiesToOdds(
        uint16[6] memory probsBps, // Literal 6 required by Solidity for array size
        uint16 houseEdgeBps
    ) internal pure returns (uint32[6] memory oddsDecimalBps) {
        for (uint8 i = 0; i < GiraffeRaceStorage.LANE_COUNT; ) {
            oddsDecimalBps[i] = probabilityToOdds(probsBps[i], houseEdgeBps);
            unchecked { ++i; }
        }
    }

    /// @notice Calculate effective score from NFT stats
    /// @dev Equally-weighted average of zip, moxie, hustle, rounded to nearest integer
    /// @param zip Speed stat (1-10)
    /// @param moxie Spirit stat (1-10)
    /// @param hustle Effort stat (1-10)
    /// @return score Effective score (1-10)
    function calculateEffectiveScore(
        uint8 zip,
        uint8 moxie,
        uint8 hustle
    ) internal pure returns (uint8 score) {
        // Defensive clamps
        if (zip == 0 || zip > 10) zip = 10;
        if (moxie == 0 || moxie > 10) moxie = 10;
        if (hustle == 0 || hustle > 10) hustle = 10;
        
        // Equally-weighted average, rounded to nearest integer
        uint16 sum = uint16(zip) + uint16(moxie) + uint16(hustle);
        score = uint8((uint256(sum) + 1) / 3);
        
        // Clamp result
        if (score < 1) score = 1;
        if (score > 10) score = 10;
    }
}
