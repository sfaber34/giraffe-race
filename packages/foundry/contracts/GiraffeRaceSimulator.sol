// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceConstants as C } from "./libraries/GiraffeRaceConstants.sol";

/// @notice Stateless simulator contract for GiraffeRace
/// @dev OPTIMIZED: Uses direct modulo instead of rejection sampling for ~97% gas savings.
///      
///      NOTE: Solidity requires literal values for array sizes in function signatures.
///      Constants here use literals that MUST match GiraffeRaceConstants. The constructor
///      verifies this at deployment time.
contract GiraffeRaceSimulator {
    // Race constants - literals required for array sizes in function signatures
    // These MUST match GiraffeRaceConstants (verified in constructor)
    uint8 internal constant LANE_COUNT = 6;
    uint16 internal constant TRACK_LENGTH = 1000;
    uint16 internal constant MAX_TICKS = 500;
    uint8 internal constant SPEED_RANGE = 10;
    uint16 internal constant BPS_DENOM = 10000;
    uint16 internal constant FINISH_OVERSHOOT = 10; // Run until last place is 10 units past finish
    
    /// @notice Finish position info for a single position (1st, 2nd, or 3rd)
    /// @dev lanes array holds the lane indices that finished in this position
    /// @dev count indicates how many lanes tied for this position (dead heat)
    struct PositionInfo {
        uint8[6] lanes;  // Lane indices in this position (only first `count` are valid)
        uint8 count;     // Number of lanes in this position (1 = normal, 2+ = dead heat)
    }
    
    /// @notice Complete finish order for a race
    struct FinishOrder {
        PositionInfo first;
        PositionInfo second;
        PositionInfo third;
        uint16[6] distances;  // Final distances for all lanes
    }

    constructor() {
        // Verify constants match the central source at deployment time
        assert(LANE_COUNT == C.LANE_COUNT);
        assert(TRACK_LENGTH == C.TRACK_LENGTH);
        assert(MAX_TICKS == C.MAX_TICKS);
        assert(SPEED_RANGE == C.SPEED_RANGE);
        assert(BPS_DENOM == C.ODDS_SCALE);
    }

    // Gas profiling event
    event SimulationGasProfile(
        uint256 totalTicks,
        uint256 setupGas,
        uint256 mainLoopGas,
        uint256 winnerCalcGas,
        uint256 hashCount
    );

    /// @notice Deterministically choose a winner given a seed + lane effective score snapshot.
    /// @dev `scores` is a 1-10 value per lane (typically the rounded average of zip/moxie/hustle).
    /// @return winner The primary winner (first in tie order). For dead heats, use `winnersWithScore`.
    function winnerWithScore(bytes32 seed, uint8[LANE_COUNT] memory scores)
        external
        pure
        returns (uint8 winner)
    {
        (uint8[LANE_COUNT] memory winners,,) = _simulateOptimized(seed, scores);
        winner = winners[0];
    }

    /// @notice Deterministically simulate a race and return ALL winners (for dead heat support).
    /// @dev `scores` is a 1-10 value per lane (typically the rounded average of zip/moxie/hustle).
    /// @return winners Array of winning lane indices (length 1 = normal win, length 2+ = dead heat).
    /// @return winnerCount Number of winners (1 = normal, 2+ = dead heat).
    /// @return distances Final distances after all ticks.
    function winnersWithScore(bytes32 seed, uint8[LANE_COUNT] memory scores)
        external
        returns (uint8[LANE_COUNT] memory winners, uint8 winnerCount, uint16[LANE_COUNT] memory distances)
    {
        return _simulateOptimizedProfiled(seed, scores);
    }
    
    /// @notice Simulate a race and return complete finish order (1st, 2nd, 3rd with dead heat support)
    /// @dev Runs until all racers are 10 units past the finish line
    /// @param seed The deterministic seed for the race
    /// @param scores Lane scores (1-10)
    /// @return finishOrder Complete finish order with dead heat info
    function simulateFullRace(bytes32 seed, uint8[LANE_COUNT] memory scores)
        external
        pure
        returns (FinishOrder memory finishOrder)
    {
        return _simulateFullRace(seed, scores);
    }

    function simulate(bytes32 seed) external pure returns (uint8 winner, uint16[LANE_COUNT] memory distances) {
        uint8[LANE_COUNT] memory score = [uint8(10), 10, 10, 10, 10, 10];
        (,, distances) = _simulateOptimized(seed, score);
        // For backwards compatibility, return first winner
        uint16 best = distances[0];
        winner = 0;
        for (uint8 i = 1; i < LANE_COUNT; i++) {
            if (distances[i] > best) {
                best = distances[i];
                winner = i;
            }
        }
    }

    /// @notice Deterministically simulate a race given a seed + lane effective score snapshot.
    /// @dev `scores` is a 1-10 value per lane (typically the rounded average of zip/moxie/hustle).
    function simulateWithScore(bytes32 seed, uint8[LANE_COUNT] memory scores)
        external
        pure
        returns (uint8 winner, uint16[LANE_COUNT] memory distances)
    {
        uint8[LANE_COUNT] memory winners;
        (winners,, distances) = _simulateOptimized(seed, scores);
        winner = winners[0]; // Return first winner for backwards compatibility
    }

    function _scoreBps(uint8 score) internal pure returns (uint16) {
        // Map score 1..10 -> multiplier in basis points.
        // Clamp score to [1, 10]
        if (score < 1) score = 1;
        if (score > 10) score = 10;
        uint256 minBps = 9585;
        uint256 range = 10000 - minBps; // 415
        return uint16(minBps + (uint256(score - 1) * range) / 9);
    }

    // ============ OPTIMIZED SIMULATION (Direct Modulo) ============
    // Uses one keccak256 per tick instead of expensive DeterministicDice.
    // Entropy layout per tick (32 bytes):
    //   Bytes 0-5:   Speed rolls for lanes 0-5 (1 byte each, % 10)
    //   Bytes 6-17:  Rounding rolls for lanes 0-5 (2 bytes each, % 10000)
    //   Bytes 18-31: Reserved/unused

    /// @notice Profiled version that emits gas usage
    function _simulateOptimizedProfiled(bytes32 seed, uint8[LANE_COUNT] memory scores)
        internal
        returns (uint8[LANE_COUNT] memory winners, uint8 winnerCount, uint16[LANE_COUNT] memory distances)
    {
        uint256 gasStart = gasleft();
        uint256 gasCheckpoint;

        // Pre-calculate BPS multipliers
        uint16[LANE_COUNT] memory bps;
        for (uint8 a = 0; a < LANE_COUNT; a++) {
            bps[a] = _scoreBps(scores[a]);
        }

        gasCheckpoint = gasleft();
        uint256 setupGas = gasStart - gasCheckpoint;
        gasStart = gasleft();

        bool finished = false;
        uint256 tickCount = 0;

        for (uint256 t = 0; t < MAX_TICKS; t++) {
            tickCount++;
            
            // One hash per tick - all entropy we need
            bytes32 tickEntropy = keccak256(abi.encodePacked(seed, t));

            for (uint256 a = 0; a < LANE_COUNT; a++) {
                // Speed roll: 1 byte, % 10, gives 0-9, then +1 for 1-10
                uint256 baseSpeed = (uint8(tickEntropy[a]) % SPEED_RANGE) + 1;
                
                // Apply handicap
                uint256 raw = baseSpeed * uint256(bps[a]);
                uint256 q = raw / uint256(BPS_DENOM);
                uint256 rem = raw % uint256(BPS_DENOM);
                
                // Probabilistic rounding using 2 bytes for rounding decision
                if (rem > 0) {
                    // Extract 2 bytes for this lane's rounding roll (bytes 6-17)
                    uint256 roundingRoll = (uint256(uint8(tickEntropy[6 + a * 2])) << 8) 
                                         | uint256(uint8(tickEntropy[7 + a * 2]));
                    // % BPS_DENOM gives 0-9999
                    if ((roundingRoll % BPS_DENOM) < rem) {
                        q += 1;
                    }
                }
                
                if (q == 0) q = 1;
                distances[a] += uint16(q);
            }

            // Check for finish
            for (uint8 i = 0; i < LANE_COUNT; i++) {
                if (distances[i] >= TRACK_LENGTH) {
                    finished = true;
                    break;
                }
            }
            if (finished) break;
        }

        require(finished, "GiraffeRace: race did not finish");

        gasCheckpoint = gasleft();
        uint256 mainLoopGas = gasStart - gasCheckpoint;
        gasStart = gasleft();

        // Determine winner(s)
        (winners, winnerCount) = _findWinners(distances);

        uint256 winnerCalcGas = gasCheckpoint - gasleft();

        emit SimulationGasProfile(
            tickCount,
            setupGas,
            mainLoopGas,
            winnerCalcGas,
            tickCount  // hashCount = 1 per tick
        );
    }

    /// @notice Pure optimized simulation (no gas profiling)
    function _simulateOptimized(bytes32 seed, uint8[LANE_COUNT] memory scores)
        internal
        pure
        returns (uint8[LANE_COUNT] memory winners, uint8 winnerCount, uint16[LANE_COUNT] memory distances)
    {
        // Pre-calculate BPS multipliers
        uint16[LANE_COUNT] memory bps;
        for (uint8 a = 0; a < LANE_COUNT; a++) {
            bps[a] = _scoreBps(scores[a]);
        }

        bool finished = false;

        for (uint256 t = 0; t < MAX_TICKS; t++) {
            // One hash per tick - all entropy we need
            bytes32 tickEntropy = keccak256(abi.encodePacked(seed, t));

            for (uint256 a = 0; a < LANE_COUNT; a++) {
                // Speed roll: 1 byte, % 10, gives 0-9, then +1 for 1-10
                uint256 baseSpeed = (uint8(tickEntropy[a]) % SPEED_RANGE) + 1;
                
                // Apply handicap
                uint256 raw = baseSpeed * uint256(bps[a]);
                uint256 q = raw / uint256(BPS_DENOM);
                uint256 rem = raw % uint256(BPS_DENOM);
                
                // Probabilistic rounding using 2 bytes for rounding decision
                if (rem > 0) {
                    // Extract 2 bytes for this lane's rounding roll (bytes 6-17)
                    uint256 roundingRoll = (uint256(uint8(tickEntropy[6 + a * 2])) << 8) 
                                         | uint256(uint8(tickEntropy[7 + a * 2]));
                    // % BPS_DENOM gives 0-9999
                    if ((roundingRoll % BPS_DENOM) < rem) {
                        q += 1;
                    }
                }
                
                if (q == 0) q = 1;
                distances[a] += uint16(q);
            }

            // Check for finish
            for (uint8 i = 0; i < LANE_COUNT; i++) {
                if (distances[i] >= TRACK_LENGTH) {
                    finished = true;
                    break;
                }
            }
            if (finished) break;
        }

        require(finished, "GiraffeRace: race did not finish");

        // Determine winner(s)
        (winners, winnerCount) = _findWinners(distances);
    }

    /// @notice Find all winners (supports dead heat)
    function _findWinners(uint16[LANE_COUNT] memory distances)
        internal
        pure
        returns (uint8[LANE_COUNT] memory winners, uint8 winnerCount)
    {
        uint16 best = distances[0];
        winnerCount = 1;
        winners[0] = 0;

        for (uint8 i = 1; i < LANE_COUNT; i++) {
            uint16 d = distances[i];
            if (d > best) {
                best = d;
                winnerCount = 1;
                winners[0] = i;
            } else if (d == best) {
                winners[winnerCount] = i;
                winnerCount++;
            }
        }
    }
    
    /// @notice Simulate a full race until all racers are 10 units past the finish line
    /// @dev Returns complete finish order with dead heat support for 1st, 2nd, 3rd
    function _simulateFullRace(bytes32 seed, uint8[LANE_COUNT] memory scores)
        internal
        pure
        returns (FinishOrder memory finishOrder)
    {
        // Pre-calculate BPS multipliers
        uint16[LANE_COUNT] memory bps;
        for (uint8 a = 0; a < LANE_COUNT; a++) {
            bps[a] = _scoreBps(scores[a]);
        }

        uint16[LANE_COUNT] memory distances;
        uint16 finishTarget = TRACK_LENGTH + FINISH_OVERSHOOT;
        bool allFinished = false;

        for (uint256 t = 0; t < MAX_TICKS; t++) {
            // One hash per tick - all entropy we need
            bytes32 tickEntropy = keccak256(abi.encodePacked(seed, t));

            for (uint256 a = 0; a < LANE_COUNT; a++) {
                // Speed roll: 1 byte, % 10, gives 0-9, then +1 for 1-10
                uint256 baseSpeed = (uint8(tickEntropy[a]) % SPEED_RANGE) + 1;
                
                // Apply handicap
                uint256 raw = baseSpeed * uint256(bps[a]);
                uint256 q = raw / uint256(BPS_DENOM);
                uint256 rem = raw % uint256(BPS_DENOM);
                
                // Probabilistic rounding using 2 bytes for rounding decision
                if (rem > 0) {
                    // Extract 2 bytes for this lane's rounding roll (bytes 6-17)
                    uint256 roundingRoll = (uint256(uint8(tickEntropy[6 + a * 2])) << 8) 
                                         | uint256(uint8(tickEntropy[7 + a * 2]));
                    // % BPS_DENOM gives 0-9999
                    if ((roundingRoll % BPS_DENOM) < rem) {
                        q += 1;
                    }
                }
                
                if (q == 0) q = 1;
                distances[a] += uint16(q);
            }

            // Check if ALL lanes have passed the finish target (finish line + 10)
            allFinished = true;
            for (uint8 i = 0; i < LANE_COUNT; i++) {
                if (distances[i] < finishTarget) {
                    allFinished = false;
                    break;
                }
            }
            if (allFinished) break;
        }

        require(allFinished, "GiraffeRace: race did not finish");
        
        finishOrder.distances = distances;
        
        // Determine finish order (1st, 2nd, 3rd with dead heat support)
        _calculateFinishOrder(distances, finishOrder);
    }
    
    /// @notice Calculate finish positions from final distances
    /// @dev Handles dead heats - multiple lanes can tie for any position
    function _calculateFinishOrder(uint16[LANE_COUNT] memory distances, FinishOrder memory finishOrder) internal pure {
        // Sort lanes by distance (descending) while tracking original indices
        // We need to identify distinct distance values and group lanes by them
        
        // Find unique distances in descending order
        uint16[LANE_COUNT] memory sortedDistances;
        uint8[LANE_COUNT] memory sortedLanes;
        
        // Copy and sort using simple bubble sort (small fixed size)
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            sortedDistances[i] = distances[i];
            sortedLanes[i] = i;
        }
        
        // Bubble sort descending by distance
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            for (uint8 j = i + 1; j < LANE_COUNT; j++) {
                if (sortedDistances[j] > sortedDistances[i]) {
                    // Swap distances
                    uint16 tmpDist = sortedDistances[i];
                    sortedDistances[i] = sortedDistances[j];
                    sortedDistances[j] = tmpDist;
                    // Swap lane indices
                    uint8 tmpLane = sortedLanes[i];
                    sortedLanes[i] = sortedLanes[j];
                    sortedLanes[j] = tmpLane;
                }
            }
        }
        
        // Now extract 1st, 2nd, 3rd positions accounting for dead heats
        uint8 positionIdx = 0; // 0 = filling 1st, 1 = filling 2nd, 2 = filling 3rd
        uint8 sortIdx = 0;
        
        while (sortIdx < LANE_COUNT && positionIdx < 3) {
            uint16 currentDist = sortedDistances[sortIdx];
            
            // Count how many lanes have this same distance (dead heat)
            uint8 tieCount = 0;
            uint8 tieStartIdx = sortIdx;
            while (sortIdx < LANE_COUNT && sortedDistances[sortIdx] == currentDist) {
                tieCount++;
                sortIdx++;
            }
            
            // Assign to the current position
            if (positionIdx == 0) {
                finishOrder.first.count = tieCount;
                for (uint8 k = 0; k < tieCount; k++) {
                    finishOrder.first.lanes[k] = sortedLanes[tieStartIdx + k];
                }
                positionIdx++;
                // If there was a dead heat for 1st, we skip to 3rd (no 2nd place)
                if (tieCount >= 2) {
                    positionIdx++; // Skip 2nd position
                }
                if (tieCount >= 3) {
                    positionIdx++; // Skip 3rd position too
                }
            } else if (positionIdx == 1) {
                finishOrder.second.count = tieCount;
                for (uint8 k = 0; k < tieCount; k++) {
                    finishOrder.second.lanes[k] = sortedLanes[tieStartIdx + k];
                }
                positionIdx++;
                // If there was a dead heat for 2nd, we skip 3rd
                if (tieCount >= 2) {
                    positionIdx++; // Skip 3rd position
                }
            } else if (positionIdx == 2) {
                finishOrder.third.count = tieCount;
                for (uint8 k = 0; k < tieCount; k++) {
                    finishOrder.third.lanes[k] = sortedLanes[tieStartIdx + k];
                }
                positionIdx++;
            }
        }
    }
}

