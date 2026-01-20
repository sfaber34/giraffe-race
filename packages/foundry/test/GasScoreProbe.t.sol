// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/libraries/DeterministicDice.sol";

/**
 * Gas probe for effective score speed scaling.
 *
 * We compare:
 * - Floor scaling: q = floor(raw / 10000)
 * - Probabilistic rounding: q = floor(raw/10000) + Bernoulli(rem/10000)
 *
 * We run a fixed number of ticks to avoid variance from "race finishes early".
 */
contract GasScoreProbeTest is Test {
    using DeterministicDice for DeterministicDice.Dice;

    uint16 internal constant BPS_DENOM = 10000;

    function _scoreBps(uint8 score) internal pure returns (uint16) {
        if (score == 0) score = 10;
        if (score > 10) score = 10;
        if (score < 1) score = 1;
        // Tuning: keep consistent with GiraffeRaceSimulator / TS sim.
        uint256 minBps = 9585;
        uint256 range = 10000 - minBps; // 415
        return uint16(minBps + (uint256(score - 1) * range) / 9);
    }

    function _probeFloor(bytes32 seed, uint8[4] memory score, uint16 ticks) internal pure returns (uint256 acc) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        uint16[4] memory bps;
        for (uint8 a = 0; a < 4; a++) bps[a] = _scoreBps(score[a]);

        for (uint16 t = 0; t < ticks; t++) {
            for (uint8 a = 0; a < 4; a++) {
                uint256 r;
                (r, dice) = dice.roll(10);
                uint256 baseSpeed = r + 1; // 1..10
                uint256 raw = baseSpeed * uint256(bps[a]);
                uint256 q = raw / uint256(BPS_DENOM);
                if (q == 0) q = 1;
                acc += q;
            }
        }
    }

    function _probeProbRound(bytes32 seed, uint8[4] memory score, uint16 ticks) internal pure returns (uint256 acc) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);
        uint16[4] memory bps;
        for (uint8 a = 0; a < 4; a++) bps[a] = _scoreBps(score[a]);

        for (uint16 t = 0; t < ticks; t++) {
            for (uint8 a = 0; a < 4; a++) {
                uint256 r;
                (r, dice) = dice.roll(10);
                uint256 baseSpeed = r + 1; // 1..10

                uint256 raw = baseSpeed * uint256(bps[a]);
                uint256 q = raw / uint256(BPS_DENOM);
                uint256 rem = raw % uint256(BPS_DENOM);
                if (rem > 0) {
                    uint256 pick;
                    (pick, dice) = dice.roll(BPS_DENOM);
                    if (pick < rem) q += 1;
                }
                if (q == 0) q = 1;
                acc += q;
            }
        }
    }

    function testGas_FloorScaling() public returns (uint256 acc) {
        // Use a score tuple that produces a remainder (i.e. triggers probabilistic rounding) and a fixed tick count.
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

