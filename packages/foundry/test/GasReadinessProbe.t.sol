// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/libraries/DeterministicDice.sol";

/**
 * Gas probe for readiness speed scaling.
 *
 * We compare:
 * - Floor scaling: q = floor(raw / 10000)
 * - Probabilistic rounding: q = floor(raw/10000) + Bernoulli(rem/10000)
 *
 * We run a fixed number of ticks to avoid variance from "race finishes early".
 */
contract GasReadinessProbeTest is Test {
    using DeterministicDice for DeterministicDice.Dice;

    uint16 internal constant BPS_DENOM = 10000;

    function _readinessBps(uint8 readiness) internal pure returns (uint16) {
        if (readiness == 0) readiness = 10;
        if (readiness > 10) readiness = 10;
        if (readiness < 1) readiness = 1;
        uint256 minBps = 9525;
        uint256 range = 10000 - minBps; // 475
        return uint16(minBps + (uint256(readiness - 1) * range) / 9);
    }

    function _probeFloor(bytes32 seed, uint8[4] memory readiness, uint16 ticks) internal pure returns (uint256 acc) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        uint16[4] memory bps;
        for (uint8 a = 0; a < 4; a++) bps[a] = _readinessBps(readiness[a]);

        for (uint16 t = 0; t < ticks; t++) {
            for (uint8 a = 0; a < 4; a++) {
                (uint256 r, DeterministicDice.Dice memory d2) = dice.roll(10);
                dice = d2;
                uint256 baseSpeed = r + 1; // 1..10
                uint256 raw = baseSpeed * uint256(bps[a]);
                uint256 q = raw / uint256(BPS_DENOM);
                if (q == 0) q = 1;
                acc += q;
            }
        }
    }

    function _probeProbRound(bytes32 seed, uint8[4] memory readiness, uint16 ticks) internal pure returns (uint256 acc) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        uint16[4] memory bps;
        for (uint8 a = 0; a < 4; a++) bps[a] = _readinessBps(readiness[a]);

        for (uint16 t = 0; t < ticks; t++) {
            for (uint8 a = 0; a < 4; a++) {
                (uint256 r, DeterministicDice.Dice memory d2) = dice.roll(10);
                dice = d2;
                uint256 baseSpeed = r + 1; // 1..10

                uint256 raw = baseSpeed * uint256(bps[a]);
                uint256 q = raw / uint256(BPS_DENOM);
                uint256 rem = raw % uint256(BPS_DENOM);
                if (rem > 0) {
                    (uint256 pick, DeterministicDice.Dice memory d3) = dice.roll(BPS_DENOM);
                    dice = d3;
                    if (pick < rem) q += 1;
                }
                if (q == 0) q = 1;
                acc += q;
            }
        }
    }

    function testGas_FloorScaling() public returns (uint256 acc) {
        // Use a readiness tuple that produces a remainder (i.e. triggers probabilistic rounding) and a fixed tick count.
        uint8[4] memory rr = [uint8(1), 10, 10, 10];
        acc = _probeFloor(keccak256("seed"), rr, 250);
        // prevent optimizer removing logic
        assertGt(acc, 0);
    }

    function testGas_ProbabilisticRounding() public returns (uint256 acc) {
        uint8[4] memory rr = [uint8(1), 10, 10, 10];
        acc = _probeProbRound(keccak256("seed"), rr, 250);
        assertGt(acc, 0);
    }
}

