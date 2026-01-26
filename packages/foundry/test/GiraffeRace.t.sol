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
 * @notice Tests for the GiraffeRace contract with persistent queue system
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
    address user3 = address(0x4);

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
        usdc.mint(user3, 10_000_000_000);
        vm.stopPrank();

        vm.prank(user1);
        usdc.approve(address(treasury), type(uint256).max);

        vm.prank(user2);
        usdc.approve(address(treasury), type(uint256).max);
        
        vm.prank(user3);
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
        assertEq(giraffeRace.MAX_QUEUE_SIZE(), 128);
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

    // ============ Queue Tests ============
    
    function test_EnterQueue() public {
        // Mint a giraffe for user1
        vm.prank(owner);
        uint256 tokenId = giraffeNft.mintTo(user1, "test-giraffe");
        
        // Enter queue
        vm.prank(user1);
        giraffeRace.enterQueue(tokenId);
        
        // Check queue state
        assertTrue(giraffeRace.isUserInQueue(user1));
        assertTrue(giraffeRace.isTokenInQueue(tokenId));
        assertEq(giraffeRace.getActiveQueueLength(), 1);
        assertEq(giraffeRace.getUserQueuedToken(user1), tokenId);
        assertEq(giraffeRace.getUserQueuePosition(user1), 1);
    }
    
    function test_LeaveQueue() public {
        // Mint a giraffe for user1
        vm.prank(owner);
        uint256 tokenId = giraffeNft.mintTo(user1, "test-giraffe");
        
        // Enter queue
        vm.prank(user1);
        giraffeRace.enterQueue(tokenId);
        assertTrue(giraffeRace.isUserInQueue(user1));
        
        // Leave queue
        vm.prank(user1);
        giraffeRace.leaveQueue();
        
        // Check queue state
        assertFalse(giraffeRace.isUserInQueue(user1));
        assertFalse(giraffeRace.isTokenInQueue(tokenId));
        assertEq(giraffeRace.getActiveQueueLength(), 0);
    }
    
    function test_CannotEnterQueueTwice() public {
        vm.prank(owner);
        uint256 tokenId1 = giraffeNft.mintTo(user1, "giraffe-1");
        vm.prank(owner);
        uint256 tokenId2 = giraffeNft.mintTo(user1, "giraffe-2");
        
        vm.prank(user1);
        giraffeRace.enterQueue(tokenId1);
        
        // Should fail to enter with second giraffe
        vm.prank(user1);
        vm.expectRevert();
        giraffeRace.enterQueue(tokenId2);
    }
    
    function test_CannotQueueHouseGiraffe() public {
        // Try to queue a house giraffe
        vm.prank(owner);
        vm.expectRevert();
        giraffeRace.enterQueue(houseGiraffeTokenIds[0]);
    }
    
    function test_QueueFIFOOrder() public {
        // Mint giraffes for multiple users
        vm.prank(owner);
        uint256 token1 = giraffeNft.mintTo(user1, "giraffe-1");
        vm.prank(owner);
        uint256 token2 = giraffeNft.mintTo(user2, "giraffe-2");
        vm.prank(owner);
        uint256 token3 = giraffeNft.mintTo(user3, "giraffe-3");
        
        // Enter queue in order
        vm.prank(user1);
        giraffeRace.enterQueue(token1);
        vm.prank(user2);
        giraffeRace.enterQueue(token2);
        vm.prank(user3);
        giraffeRace.enterQueue(token3);
        
        // Check positions
        assertEq(giraffeRace.getUserQueuePosition(user1), 1);
        assertEq(giraffeRace.getUserQueuePosition(user2), 2);
        assertEq(giraffeRace.getUserQueuePosition(user3), 3);
    }

    // ============ Race Creation Tests ============

    function test_CreateRace() public {
        vm.prank(owner);
        uint256 raceId = giraffeRace.createRace();
        assertEq(raceId, 0);
        assertEq(giraffeRace.nextRaceId(), 1);
    }
    
    function test_CreateRaceWithQueuedGiraffes() public {
        // Mint and queue giraffes
        vm.prank(owner);
        uint256 token1 = giraffeNft.mintTo(user1, "giraffe-1");
        vm.prank(owner);
        uint256 token2 = giraffeNft.mintTo(user2, "giraffe-2");
        
        vm.prank(user1);
        giraffeRace.enterQueue(token1);
        vm.prank(user2);
        giraffeRace.enterQueue(token2);
        
        assertEq(giraffeRace.getActiveQueueLength(), 2);
        
        // Create race - should pick both queued giraffes
        vm.prank(owner);
        uint256 raceId = giraffeRace.createRace();
        
        // Check users removed from queue
        assertFalse(giraffeRace.isUserInQueue(user1));
        assertFalse(giraffeRace.isUserInQueue(user2));
        assertEq(giraffeRace.getActiveQueueLength(), 0);
        
        // Check race lineup
        (uint8 assignedCount, uint256[6] memory tokenIds, address[6] memory originalOwners) = 
            giraffeRace.getRaceGiraffesById(raceId);
        
        assertEq(assignedCount, 6);
        assertEq(tokenIds[0], token1);
        assertEq(originalOwners[0], user1);
        assertEq(tokenIds[1], token2);
        assertEq(originalOwners[1], user2);
        // Remaining lanes filled with house giraffes
        assertEq(originalOwners[2], owner);
        assertEq(originalOwners[3], owner);
        assertEq(originalOwners[4], owner);
        assertEq(originalOwners[5], owner);
    }
    
    function test_CreateRaceEmptyQueue() public {
        // Create race with empty queue - should be all house giraffes
        vm.prank(owner);
        uint256 raceId = giraffeRace.createRace();
        
        (uint8 assignedCount,, address[6] memory originalOwners) = 
            giraffeRace.getRaceGiraffesById(raceId);
        
        assertEq(assignedCount, 6);
        // All lanes should be house giraffes
        for (uint8 i = 0; i < 6; i++) {
            assertEq(originalOwners[i], owner);
        }
    }

    function test_FullRaceLifecycle() public {
        // Queue some giraffes
        vm.prank(owner);
        uint256 token1 = giraffeNft.mintTo(user1, "racer-1");
        vm.prank(user1);
        giraffeRace.enterQueue(token1);
        
        // Create race - opens betting immediately
        vm.prank(owner);
        uint256 raceId = giraffeRace.createRace();

        // Get betting close block
        (uint64 bettingCloseBlock,) = giraffeRace.getRaceScheduleById(raceId);

        // Check flags - race is ready for betting immediately
        (bool settled, bool oddsSet, bool cancelled) = 
            giraffeRace.getRaceFlagsById(raceId);
        assertFalse(settled);
        assertTrue(oddsSet);
        assertFalse(cancelled);

        // Place bet during betting window
        vm.prank(user1);
        giraffeRace.placeBet(0, 1_000_000); // 1 USDC on lane 0

        // Mine to just past betting close block
        vm.roll(bettingCloseBlock + 1);

        // Settle race
        giraffeRace.settleRace();

        (settled,,) = giraffeRace.getRaceFlagsById(raceId);
        assertTrue(settled);
    }
    
    function test_InvalidQueueEntrySkipped() public {
        // Mint and queue a giraffe
        vm.prank(owner);
        uint256 token1 = giraffeNft.mintTo(user1, "giraffe-1");
        vm.prank(user1);
        giraffeRace.enterQueue(token1);
        
        // Transfer the NFT away (making queue entry invalid)
        vm.prank(user1);
        giraffeNft.transferFrom(user1, user2, token1);
        
        // Create race - should skip invalid entry and use house giraffes
        vm.prank(owner);
        uint256 raceId = giraffeRace.createRace();
        
        // user1 should be removed from queue (entry was invalid)
        assertFalse(giraffeRace.isUserInQueue(user1));
        
        // All lanes should be house giraffes since the only queue entry was invalid
        (,, address[6] memory originalOwners) = giraffeRace.getRaceGiraffesById(raceId);
        for (uint8 i = 0; i < 6; i++) {
            assertEq(originalOwners[i], owner);
        }
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
        (bool settled,, bool cancelled) = giraffeRace.getRaceFlagsById(raceId);
        assertTrue(settled);
        assertTrue(cancelled);
    }

    function test_HouseGiraffeTokenIds() public view {
        uint256[6] memory ids = giraffeRace.getHouseGiraffeTokenIds();
        for (uint256 i = 0; i < 6; i++) {
            assertEq(ids[i], houseGiraffeTokenIds[i]);
        }
    }
    
    function test_QueuePersistsAcrossRaces() public {
        // Mint giraffes for 8 users (more than 6 lanes)
        address[8] memory users;
        uint256[8] memory tokens;
        for (uint8 i = 0; i < 8; i++) {
            users[i] = address(uint160(100 + i));
            vm.prank(owner);
            tokens[i] = giraffeNft.mintTo(users[i], string(abi.encodePacked("giraffe-", i)));
            vm.prank(users[i]);
            giraffeRace.enterQueue(tokens[i]);
        }
        
        assertEq(giraffeRace.getActiveQueueLength(), 8);
        
        // Create first race - takes first 6
        vm.prank(owner);
        giraffeRace.createRace();
        
        // First 6 users should be out of queue
        for (uint8 i = 0; i < 6; i++) {
            assertFalse(giraffeRace.isUserInQueue(users[i]));
        }
        
        // Last 2 users should still be in queue
        assertTrue(giraffeRace.isUserInQueue(users[6]));
        assertTrue(giraffeRace.isUserInQueue(users[7]));
        assertEq(giraffeRace.getActiveQueueLength(), 2);
        
        // Settle the race
        (uint64 bettingCloseBlock,) = giraffeRace.getRaceScheduleById(0);
        vm.roll(bettingCloseBlock + 1);
        giraffeRace.settleRace();
        
        // Wait for cooldown
        vm.roll(block.number + 31);
        
        // Create second race - takes remaining 2 from queue
        vm.prank(owner);
        giraffeRace.createRace();
        
        // All users should be out of queue now
        assertFalse(giraffeRace.isUserInQueue(users[6]));
        assertFalse(giraffeRace.isUserInQueue(users[7]));
        assertEq(giraffeRace.getActiveQueueLength(), 0);
        
        // Check second race lineup - first 2 lanes are queued users, rest are house
        (uint8 assignedCount, uint256[6] memory tokenIds,) = giraffeRace.getRaceGiraffesById(1);
        assertEq(assignedCount, 6);
        assertEq(tokenIds[0], tokens[6]);
        assertEq(tokenIds[1], tokens[7]);
    }
}
