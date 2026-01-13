// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/AnimalRace.sol";
import "../contracts/AnimalNFT.sol";
import { DeterministicDice } from "../contracts/libraries/DeterministicDice.sol";

contract AnimalRaceTest is Test {
    using DeterministicDice for DeterministicDice.Dice;

    AnimalRace public race;
    AnimalNFT public animalNft;
    address public owner = address(0xBEEF);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint256 internal constant ANIMAL_COUNT = 4;
    uint256 internal constant TRACK_LENGTH = 1000;
    uint256 internal constant MAX_TICKS = 500;
    uint256 internal constant SPEED_RANGE = 10;

    function setUp() public {
        animalNft = new AnimalNFT(address(this));
        uint256[4] memory houseTokenIds;
        for (uint256 i = 0; i < 4; i++) {
            houseTokenIds[i] = animalNft.mint(owner, "house");
        }

        race = new AnimalRace(owner, address(animalNft), owner, houseTokenIds);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _expectedWinner(bytes32 seed) internal pure returns (uint8) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);

        uint16[4] memory distances;
        bool finished = false;
        for (uint256 t = 0; t < MAX_TICKS; t++) {
            for (uint256 a = 0; a < ANIMAL_COUNT; a++) {
                uint256 r;
                DeterministicDice.Dice memory updatedDice1;
                (r, updatedDice1) = dice.roll(SPEED_RANGE);
                dice = updatedDice1;
                distances[a] += uint16(r + 1);
            }
            if (
                distances[0] >= TRACK_LENGTH || distances[1] >= TRACK_LENGTH || distances[2] >= TRACK_LENGTH
                    || distances[3] >= TRACK_LENGTH
            ) {
                finished = true;
                break;
            }
        }
        require(finished, "test: race did not finish");

        uint16 best = distances[0];
        uint8 leaderCount = 1;
        uint8[4] memory leaders;
        leaders[0] = 0;
        for (uint8 i = 1; i < 4; i++) {
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

        if (leaderCount == 1) return leaders[0];
        uint256 pick;
        DeterministicDice.Dice memory updatedDice2;
        (pick, updatedDice2) = dice.roll(leaderCount);
        dice = updatedDice2;
        return leaders[uint8(pick)];
    }

    function testSettleIsDeterministicFromSeed() public {
        vm.roll(100);
        vm.prank(owner);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace(raceId);

        vm.prank(alice);
        race.placeBet{value: 1 ether}(raceId, 0);
        vm.prank(bob);
        race.placeBet{value: 2 ether}(raceId, 1);

        bytes32 forcedBh = keccak256("forced blockhash");
        vm.roll(uint256(closeBlock));
        vm.setBlockhash(uint256(closeBlock), forcedBh);
        vm.roll(uint256(closeBlock) + 1);

        bytes32 seed = keccak256(abi.encodePacked(forcedBh, raceId, address(race)));
        uint8 expected = _expectedWinner(seed);

        race.settleRace(raceId);

        (, bool settled, uint8 winner, bytes32 storedSeed,,) = race.getRace(raceId);
        assertTrue(settled);
        assertEq(winner, expected);
        assertEq(storedSeed, seed);
    }

    function testCannotBetTwice() public {
        vm.roll(10);
        vm.prank(owner);
        uint256 raceId = race.createRace();

        vm.prank(alice);
        race.placeBet{ value: 1 ether }(raceId, 2);

        vm.prank(alice);
        vm.expectRevert(AnimalRace.AlreadyBet.selector);
        race.placeBet{ value: 1 ether }(raceId, 3);
    }

    function testClaimPayoutProRata() public {
        vm.roll(200);
        vm.prank(owner);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace(raceId);

        // Alice and Bob both bet on animal 0, different amounts
        vm.prank(alice);
        race.placeBet{ value: 1 ether }(raceId, 0);
        vm.prank(bob);
        race.placeBet{ value: 3 ether }(raceId, 0);

        // Force winner = 0 by forcing a seed that yields winner 0.
        // We'll brute-force by trying a few forced blockhashes (small loop acceptable in test).
        bytes32 forcedBh;
        uint8 w;
        for (uint256 i = 0; i < 50; i++) {
            forcedBh = keccak256(abi.encodePacked("bh", i));
            bytes32 seed = keccak256(abi.encodePacked(forcedBh, raceId, address(race)));
            w = _expectedWinner(seed);
            if (w == 0) break;
        }
        assertEq(w, 0);

        vm.roll(uint256(closeBlock));
        vm.setBlockhash(uint256(closeBlock), forcedBh);
        vm.roll(uint256(closeBlock) + 1);
        race.settleRace(raceId);

        uint256 aliceBalBefore = alice.balance;
        uint256 bobBalBefore = bob.balance;

        vm.prank(alice);
        uint256 alicePayout = race.claim(raceId);
        vm.prank(bob);
        uint256 bobPayout = race.claim(raceId);

        // Total pot = 4 ETH, winnersTotal = 4 ETH
        // Alice payout = 4 * 1/4 = 1 ETH
        // Bob payout   = 4 * 3/4 = 3 ETH
        assertEq(alicePayout, 1 ether);
        assertEq(bobPayout, 3 ether);
        assertEq(alice.balance, aliceBalBefore + 1 ether);
        assertEq(bob.balance, bobBalBefore + 3 ether);
    }

    function testSettleRevertsIfBlockhashUnavailable() public {
        vm.roll(1000);
        vm.prank(owner);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace(raceId);

        // Move far ahead so blockhash is unavailable (returns 0)
        vm.roll(uint256(closeBlock) + 300);

        vm.expectRevert(AnimalRace.BlockhashUnavailable.selector);
        race.settleRace(raceId);
    }
}

