// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { DeterministicDice } from "./libraries/DeterministicDice.sol";

/// @notice Stateless simulator contract to keep `AnimalRace` deployed bytecode under the 24KB limit.
/// @dev Must stay in sync with the on-chain race rules used by AnimalRace.
contract AnimalRaceSimulator {
    using DeterministicDice for DeterministicDice.Dice;

    uint8 internal constant ANIMAL_COUNT = 4;
    uint16 internal constant TRACK_LENGTH = 1000;
    uint16 internal constant MAX_TICKS = 500;
    uint8 internal constant SPEED_RANGE = 10;

    function winnerWithReadiness(bytes32 seed, uint8[ANIMAL_COUNT] calldata readiness) external pure returns (uint8 winner) {
        (winner,) = _simulateWithReadiness(seed, readiness);
    }

    function simulate(bytes32 seed) external pure returns (uint8 winner, uint16[ANIMAL_COUNT] memory distances) {
        uint8[ANIMAL_COUNT] memory readiness = [uint8(10), 10, 10, 10];
        return _simulateWithReadiness(seed, readiness);
    }

    function simulateWithReadiness(bytes32 seed, uint8[ANIMAL_COUNT] calldata readiness)
        external
        pure
        returns (uint8 winner, uint16[ANIMAL_COUNT] memory distances)
    {
        return _simulateWithReadiness(seed, readiness);
    }

    function _readinessBps(uint8 readiness) internal pure returns (uint16) {
        // Map readiness 1..10 -> 0.70x..1.00x (basis points).
        if (readiness == 0) readiness = 10;
        if (readiness > 10) readiness = 10;
        if (readiness < 1) readiness = 1;
        return uint16(7000 + (uint256(readiness - 1) * 3000) / 9);
    }

    function _scaledSpeed(uint256 baseSpeed, uint16 multiplierBps) internal pure returns (uint16) {
        uint256 s = (baseSpeed * uint256(multiplierBps)) / 10000;
        if (s == 0) return 1;
        return uint16(s);
    }

    function _simulateWithReadiness(bytes32 seed, uint8[ANIMAL_COUNT] memory readiness)
        internal
        pure
        returns (uint8 winner, uint16[ANIMAL_COUNT] memory distances)
    {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);

        bool finished = false;

        uint16[ANIMAL_COUNT] memory bps;
        for (uint8 a = 0; a < ANIMAL_COUNT; a++) {
            bps[a] = _readinessBps(readiness[a]);
        }

        for (uint256 t = 0; t < MAX_TICKS; t++) {
            for (uint256 a = 0; a < ANIMAL_COUNT; a++) {
                (uint256 r, DeterministicDice.Dice memory updatedDice) = dice.roll(SPEED_RANGE);
                dice = updatedDice;
                uint256 baseSpeed = r + 1;
                distances[a] += _scaledSpeed(baseSpeed, bps[uint8(a)]);
            }

            if (
                distances[0] >= TRACK_LENGTH || distances[1] >= TRACK_LENGTH || distances[2] >= TRACK_LENGTH
                    || distances[3] >= TRACK_LENGTH
            ) {
                finished = true;
                break;
            }
        }

        require(finished, "AnimalRace: race did not finish");

        uint16 best = distances[0];
        uint8 leaderCount = 1;
        uint8[ANIMAL_COUNT] memory leaders;
        leaders[0] = 0;

        for (uint8 i = 1; i < ANIMAL_COUNT; i++) {
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

        (uint256 pick,) = dice.roll(leaderCount);
        return (leaders[uint8(pick)], distances);
    }
}

