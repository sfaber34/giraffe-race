// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { DeterministicDice } from "./libraries/DeterministicDice.sol";

/// @notice Stateless simulator contract to keep `GiraffeRace` deployed bytecode under the 24KB limit.
/// @dev Must stay in sync with the on-chain race rules used by GiraffeRace.
contract GiraffeRaceSimulator {
    using DeterministicDice for DeterministicDice.Dice;

    uint8 internal constant LANE_COUNT = 6;
    uint16 internal constant TRACK_LENGTH = 1000;
    uint16 internal constant MAX_TICKS = 500;
    uint8 internal constant SPEED_RANGE = 10;
    uint16 internal constant BPS_DENOM = 10000;

    /// @notice Deterministically choose a winner given a seed + lane effective score snapshot.
    /// @dev `scores` is a 1-10 value per lane (typically the rounded average of zip/moxie/hustle).
    /// @return winner The primary winner (first in tie order). For dead heats, use `winnersWithScore`.
    function winnerWithScore(bytes32 seed, uint8[LANE_COUNT] memory scores)
        external
        pure
        returns (uint8 winner)
    {
        (uint8[LANE_COUNT] memory winners,,) = _simulateWithScore(seed, scores);
        winner = winners[0];
    }

    /// @notice Deterministically simulate a race and return ALL winners (for dead heat support).
    /// @dev `scores` is a 1-10 value per lane (typically the rounded average of zip/moxie/hustle).
    /// @return winners Array of winning lane indices (length 1 = normal win, length 2+ = dead heat).
    /// @return winnerCount Number of winners (1 = normal, 2+ = dead heat).
    /// @return distances Final distances after all ticks.
    function winnersWithScore(bytes32 seed, uint8[LANE_COUNT] memory scores)
        external
        pure
        returns (uint8[LANE_COUNT] memory winners, uint8 winnerCount, uint16[LANE_COUNT] memory distances)
    {
        return _simulateWithScore(seed, scores);
    }

    function simulate(bytes32 seed) external pure returns (uint8 winner, uint16[LANE_COUNT] memory distances) {
        uint8[LANE_COUNT] memory score = [uint8(10), 10, 10, 10, 10, 10];
        (,, distances) = _simulateWithScore(seed, score);
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
        (winners,, distances) = _simulateWithScore(seed, scores);
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

    function _simulateWithScore(bytes32 seed, uint8[LANE_COUNT] memory scores)
        internal
        pure
        returns (uint8[LANE_COUNT] memory winners, uint8 winnerCount, uint16[LANE_COUNT] memory distances)
    {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);

        bool finished = false;

        uint16[LANE_COUNT] memory bps;
        for (uint8 a = 0; a < LANE_COUNT; a++) {
            bps[a] = _scoreBps(scores[a]);
        }

        for (uint256 t = 0; t < MAX_TICKS; t++) {
            for (uint256 a = 0; a < LANE_COUNT; a++) {
                uint256 r;
                (r, dice) = dice.roll(SPEED_RANGE);
                uint256 baseSpeed = r + 1;
                // Probabilistic rounding (instead of floor) to avoid a chunky handicap.
                uint256 raw = baseSpeed * uint256(bps[uint8(a)]);
                uint256 q = raw / uint256(BPS_DENOM);
                uint256 rem = raw % uint256(BPS_DENOM);
                if (rem > 0) {
                    uint256 pickBps;
                    (pickBps, dice) = dice.roll(BPS_DENOM);
                    if (pickBps < rem) q += 1;
                }
                if (q == 0) q = 1;
                distances[a] += uint16(q);
            }

            for (uint8 i = 0; i < LANE_COUNT; i++) {
                if (distances[i] >= TRACK_LENGTH) {
                    finished = true;
                    break;
                }
            }
            if (finished) break;
        }

        require(finished, "GiraffeRace: race did not finish");

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

        // Dead heat: return ALL winners, no random selection
        // winnerCount > 1 means dead heat
    }
}

