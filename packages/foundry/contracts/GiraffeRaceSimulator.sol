// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { DeterministicDice } from "./libraries/DeterministicDice.sol";

/// @notice Stateless simulator contract to keep `GiraffeRace` deployed bytecode under the 24KB limit.
/// @dev Must stay in sync with the on-chain race rules used by GiraffeRace.
contract GiraffeRaceSimulator {
    using DeterministicDice for DeterministicDice.Dice;

    uint8 internal constant LANE_COUNT = 4;
    uint16 internal constant TRACK_LENGTH = 1000;
    uint16 internal constant MAX_TICKS = 500;
    uint8 internal constant SPEED_RANGE = 10;
    uint16 internal constant BPS_DENOM = 10000;

    /// @notice Deterministically choose a winner given a seed + lane effective score snapshot.
    /// @dev `scores` is a 1-10 value per lane (typically the rounded average of readiness/conditioning/speed).
    function winnerWithScore(bytes32 seed, uint8[4] memory scores)
        external
        pure
        returns (uint8 winner)
    {
        (winner,) = _simulateWithScore(seed, scores);
    }

    function simulate(bytes32 seed) external pure returns (uint8 winner, uint16[4] memory distances) {
        uint8[4] memory score = [uint8(10), 10, 10, 10];
        return _simulateWithScore(seed, score);
    }

    /// @notice Deterministically simulate a race given a seed + lane effective score snapshot.
    /// @dev `scores` is a 1-10 value per lane (typically the rounded average of readiness/conditioning/speed).
    function simulateWithScore(bytes32 seed, uint8[4] memory scores)
        external
        pure
        returns (uint8 winner, uint16[4] memory distances)
    {
        return _simulateWithScore(seed, scores);
    }

    function _scoreBps(uint8 score) internal pure returns (uint16) {
        // Map score 1..10 -> 0.9525x..1.00x (basis points).
        // Tuned so that a worst-case tuple like [1,10,10,10] yields ~20x implied odds (not hundreds-x),
        // while 9 vs 10 is only a small effect (when combined with probabilistic rounding below).
        if (score == 0) score = 10;
        if (score > 10) score = 10;
        if (score < 1) score = 1;
        uint256 minBps = 9525;
        uint256 range = 10000 - minBps; // 475
        return uint16(minBps + (uint256(score - 1) * range) / 9);
    }

    function _simulateWithScore(bytes32 seed, uint8[4] memory scores)
        internal
        pure
        returns (uint8 winner, uint16[4] memory distances)
    {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);

        bool finished = false;

        uint16[4] memory bps;
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

            if (
                distances[0] >= TRACK_LENGTH || distances[1] >= TRACK_LENGTH || distances[2] >= TRACK_LENGTH
                    || distances[3] >= TRACK_LENGTH
            ) {
                finished = true;
                break;
            }
        }

        require(finished, "GiraffeRace: race did not finish");

        uint16 best = distances[0];
        uint8 leaderCount = 1;
        uint8[4] memory leaders;
        leaders[0] = 0;

        for (uint8 i = 1; i < LANE_COUNT; i++) {
            uint16 d = distances[i];
            if (d > best) {
                best = d;
                leaderCount = 1;
                leaders[0] = i;
            } else if (d == best) {
                leaders[leaderCount] = i;
                leaderCount++;
            }
        }

        if (leaderCount == 1) {
            return (leaders[0], distances);
        }

        uint256 pick;
        (pick, dice) = dice.roll(leaderCount);
        return (leaders[uint8(pick)], distances);
    }
}

