// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import { GiraffeRace } from "../contracts/GiraffeRaceV2.sol";
import { GiraffeNFT } from "../contracts/GiraffeNFT.sol";
import { GiraffeRaceSimulator } from "../contracts/GiraffeRaceSimulator.sol";
import { HouseTreasury } from "../contracts/HouseTreasury.sol";
import { MockUSDC } from "../contracts/MockUSDC.sol";

/**
 * @title GiraffeRaceTest
 * @notice Tests for the simplified (non-Diamond) GiraffeRace contract
 */
contract GiraffeRaceTest is Test {
    GiraffeRace giraffeRace;

    // Supporting contracts
    MockUSDC usdc;
    GiraffeNFT giraffeNft;
    GiraffeRaceSimulator simulator;
    HouseTreasury treasury;

    // Test addresses
    address owner = address(0x1);
    address user1 = address(0x2);
    address user2 = address(0x3);

    uint256[6] houseGiraffeTokenIds;

    function setUp() public {
        vm.startPrank(owner);

        // Deploy supporting contracts
        usdc = new MockUSDC();
        giraffeNft = new GiraffeNFT();
        simulator = new GiraffeRaceSimulator();
        treasury = new HouseTreasury(address(usdc), owner);

        // Mint house giraffes
        houseGiraffeTokenIds[0] = giraffeNft.mintTo(owner, "house-1");
        houseGiraffeTokenIds[1] = giraffeNft.mintTo(owner, "house-2");
        houseGiraffeTokenIds[2] = giraffeNft.mintTo(owner, "house-3");
        houseGiraffeTokenIds[3] = giraffeNft.mintTo(owner, "house-4");
        houseGiraffeTokenIds[4] = giraffeNft.mintTo(owner, "house-5");
        houseGiraffeTokenIds[5] = giraffeNft.mintTo(owner, "house-6");

        // Deploy GiraffeRace (single contract - no Diamond)
        giraffeRace = new GiraffeRace(
            address(giraffeNft),
            owner,
            houseGiraffeTokenIds,
            address(simulator),
            address(treasury)
        );

        // Authorize GiraffeRace in treasury
        treasury.authorize(address(giraffeRace));

        // Fund treasury
        usdc.mint(address(treasury), 1_000_000_000_000); // 1M USDC

        vm.stopPrank();

        // Setup users
        vm.startPrank(owner);
        usdc.mint(user1, 10_000_000_000); // 10k USDC
        usdc.mint(user2, 10_000_000_000);
        vm.stopPrank();

        vm.prank(user1);
        usdc.approve(address(treasury), type(uint256).max);

        vm.prank(user2);
        usdc.approve(address(treasury), type(uint256).max);
    }

    // ============ Basic Tests ============

    function test_Deployed() public view {
        assertEq(giraffeRace.treasuryOwner(), owner);
    }

    function test_Constants() public view {
        assertEq(giraffeRace.LANE_COUNT(), 6);
        assertEq(giraffeRace.TRACK_LENGTH(), 1000);
        assertEq(giraffeRace.SPEED_RANGE(), 10);
    }

    function test_AdminFunctions() public {
        // Check initial values
        assertEq(giraffeRace.houseEdgeBps(), 500);
        assertEq(giraffeRace.maxBetAmount(), 5_000_000);

        // Update as owner
        vm.prank(owner);
        giraffeRace.setHouseEdgeBps(600);
        assertEq(giraffeRace.houseEdgeBps(), 600);

        // Should revert for non-owner
        vm.prank(user1);
        vm.expectRevert();
        giraffeRace.setHouseEdgeBps(700);
    }

    function test_CreateRace() public {
        vm.prank(owner);
        uint256 raceId = giraffeRace.createRace();
        assertEq(raceId, 0);
        assertEq(giraffeRace.nextRaceId(), 1);
    }

    function test_FullRaceLifecycle() public {
        // Create race
        vm.prank(owner);
        uint256 raceId = giraffeRace.createRace();

        // Get submission close block
        (, uint64 submissionCloseBlock,) = giraffeRace.getRaceScheduleById(raceId);

        // Mine blocks past submission window - need exact block for blockhash
        vm.roll(submissionCloseBlock);

        // Finalize giraffes
        giraffeRace.finalizeRaceGiraffes();

        // Check flags
        (bool settled, bool giraffesFinalized, bool oddsSet, bool cancelled) = 
            giraffeRace.getRaceFlagsById(raceId);
        assertFalse(settled);
        assertTrue(giraffesFinalized);
        assertTrue(oddsSet);
        assertFalse(cancelled);

        // Get betting close block
        (uint64 bettingCloseBlock,,) = giraffeRace.getRaceScheduleById(raceId);

        // Place bet during betting window
        vm.prank(user1);
        giraffeRace.placeBet(0, 1_000_000); // 1 USDC on lane 0

        // Mine to just past betting close block - need to be within 256 blocks for blockhash
        vm.roll(bettingCloseBlock + 1);

        // Settle race
        giraffeRace.settleRace();

        (settled,,,) = giraffeRace.getRaceFlagsById(raceId);
        assertTrue(settled);
    }

    function test_GiraffeSubmission() public {
        // Mint a giraffe for user1
        vm.prank(owner);
        uint256 tokenId = giraffeNft.mintTo(user1, "test-giraffe");

        // Create race
        vm.prank(owner);
        giraffeRace.createRace();

        // Submit giraffe
        vm.prank(user1);
        giraffeRace.submitGiraffe(tokenId);

        // Check submission
        assertTrue(giraffeRace.hasSubmitted(0, user1));
        assertTrue(giraffeRace.isTokenEntered(0, tokenId));
        assertEq(giraffeRace.getRaceEntryCount(0), 1);
    }

    function test_ViewFunctions() public view {
        assertEq(address(giraffeRace.giraffeNft()), address(giraffeNft));
        assertEq(address(giraffeRace.simulator()), address(simulator));
        assertEq(address(giraffeRace.treasury()), address(treasury));
    }

    function test_Simulation() public view {
        bytes32 seed = keccak256("test seed");
        (uint8 winner, uint16[6] memory distances) = giraffeRace.simulate(seed);
        
        // Winner should be valid lane
        assertTrue(winner < 6);
        
        // At least one lane should have crossed the finish line
        uint16 maxDist = 0;
        for (uint8 i = 0; i < 6; i++) {
            if (distances[i] > maxDist) maxDist = distances[i];
        }
        assertTrue(maxDist >= 1000);
    }

    function test_CancelRace() public {
        // Create race
        vm.prank(owner);
        uint256 raceId = giraffeRace.createRace();

        // Admin cancels the race
        vm.prank(owner);
        giraffeRace.adminCancelRace(raceId);

        // Check flags
        (bool settled,,, bool cancelled) = giraffeRace.getRaceFlagsById(raceId);
        assertTrue(settled);
        assertTrue(cancelled);
    }

    function test_HouseGiraffeTokenIds() public view {
        uint256[6] memory ids = giraffeRace.getHouseGiraffeTokenIds();
        for (uint256 i = 0; i < 6; i++) {
            assertEq(ids[i], houseGiraffeTokenIds[i]);
        }
    }
}
