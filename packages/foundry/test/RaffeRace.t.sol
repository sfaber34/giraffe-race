// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import { RaffeRace } from "../contracts/RaffeRaceV2.sol";
import { RaffeNFT } from "../contracts/RaffeNFT.sol";
import { RaffeRaceSimulator } from "../contracts/RaffeRaceSimulator.sol";
import { HouseTreasury } from "../contracts/HouseTreasury.sol";
import { MockUSDC } from "../contracts/MockUSDC.sol";

/**
 * @title RaffeRaceTest
 * @notice Tests for the RaffeRace contract with persistent queue system
 * @dev New flow: createRace() -> setProbabilities() -> betting -> settleRace()
 */
contract RaffeRaceTest is Test {
    RaffeRace raffeRace;

    // Supporting contracts
    MockUSDC usdc;
    RaffeNFT raffeNft;
    RaffeRaceSimulator simulator;
    HouseTreasury treasury;

    // Test addresses
    address owner = address(0x1);      // treasuryOwner
    address bot = address(0x5);        // raceBot
    address user1 = address(0x2);
    address user2 = address(0x3);
    address user3 = address(0x4);

    uint256[6] houseRaffeTokenIds;
    
    // Default test probabilities (equal chances for each lane)
    // Win: ~16.67% each (sums to 100%), Place: ~33.33% each (sums to 200%), Show: 50% each (sums to 300%)
    uint16[6] defaultWinProb = [uint16(1667), 1667, 1667, 1667, 1666, 1666];   // ~10000 bps total
    uint16[6] defaultPlaceProb = [uint16(3333), 3333, 3333, 3333, 3334, 3334]; // ~20000 bps total
    uint16[6] defaultShowProb = [uint16(5000), 5000, 5000, 5000, 5000, 5000];  // 30000 bps total

    function setUp() public {
        vm.startPrank(owner);

        // Deploy supporting contracts
        usdc = new MockUSDC();
        raffeNft = new RaffeNFT();
        simulator = new RaffeRaceSimulator();
        treasury = new HouseTreasury(address(usdc), owner);

        // Mint house raffes
        houseRaffeTokenIds[0] = raffeNft.mintTo(owner, "house-1");
        houseRaffeTokenIds[1] = raffeNft.mintTo(owner, "house-2");
        houseRaffeTokenIds[2] = raffeNft.mintTo(owner, "house-3");
        houseRaffeTokenIds[3] = raffeNft.mintTo(owner, "house-4");
        houseRaffeTokenIds[4] = raffeNft.mintTo(owner, "house-5");
        houseRaffeTokenIds[5] = raffeNft.mintTo(owner, "house-6");

        // Deploy RaffeRace (single contract - no Diamond)
        raffeRace = new RaffeRace(
            address(raffeNft),
            owner,  // treasuryOwner
            bot,    // raceBot
            houseRaffeTokenIds,
            address(simulator),
            address(treasury)
        );

        // Authorize RaffeRace in treasury
        treasury.authorize(address(raffeRace));

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

    // ============ Helper Functions ============
    
    /// @notice Create a race and set probabilities (simulates bot behavior)
    function _createRaceAndSetProbabilities() internal returns (uint256 raceId) {
        raceId = raffeRace.createRace();
        // setProbabilities requires raceBot
        vm.prank(bot);
        raffeRace.setProbabilities(raceId, defaultWinProb, defaultPlaceProb, defaultShowProb);
    }

    // ============ Basic Tests ============

    function test_Deployed() public view {
        assertEq(raffeRace.treasuryOwner(), owner);
    }

    function test_Constants() public view {
        assertEq(raffeRace.LANE_COUNT(), 6);
        assertEq(raffeRace.TRACK_LENGTH(), 1000);
        assertEq(raffeRace.SPEED_RANGE(), 10);
        assertEq(raffeRace.MAX_QUEUE_SIZE(), 128);
        assertEq(raffeRace.ODDS_WINDOW_BLOCKS(), 10);
    }

    function test_AdminFunctions() public {
        // Check initial values
        assertEq(raffeRace.houseEdgeBps(), 500);
        assertEq(raffeRace.maxBetAmount(), 5_000_000);

        // Update as owner
        vm.prank(owner);
        raffeRace.setHouseEdgeBps(600);
        assertEq(raffeRace.houseEdgeBps(), 600);

        // Should revert for non-owner
        vm.prank(user1);
        vm.expectRevert();
        raffeRace.setHouseEdgeBps(700);
    }
    
    function test_RaceBotAccessControl() public {
        // Check initial raceBot
        assertEq(raffeRace.raceBot(), bot);
        
        // Create a race
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        // Non-raceBot cannot set odds
        vm.prank(user1);
        vm.expectRevert();
        raffeRace.setProbabilities(raceId, defaultWinProb, defaultPlaceProb, defaultShowProb);
        
        // treasuryOwner (not raceBot) also cannot set odds
        vm.prank(owner);
        vm.expectRevert();
        raffeRace.setProbabilities(raceId, defaultWinProb, defaultPlaceProb, defaultShowProb);
        
        // raceBot can set odds
        vm.prank(bot);
        raffeRace.setProbabilities(raceId, defaultWinProb, defaultPlaceProb, defaultShowProb);
        
        // treasuryOwner can change raceBot
        address newBot = address(0x999);
        vm.prank(owner);
        raffeRace.setRaceBot(newBot);
        assertEq(raffeRace.raceBot(), newBot);
        
        // Non-owner cannot change raceBot
        vm.prank(user1);
        vm.expectRevert();
        raffeRace.setRaceBot(address(0x888));
    }

    // ============ Queue Tests ============
    
    function test_EnterQueue() public {
        // Mint a raffe for user1
        vm.prank(owner);
        uint256 tokenId = raffeNft.mintTo(user1, "test-raffe");
        
        // Enter queue
        vm.prank(user1);
        raffeRace.enterQueue(tokenId);
        
        // Check queue state
        assertTrue(raffeRace.isUserInQueue(user1));
        assertTrue(raffeRace.isTokenInQueue(tokenId));
        assertEq(raffeRace.getActiveQueueLength(), 1);
        assertEq(raffeRace.getUserQueuedToken(user1), tokenId);
        assertEq(raffeRace.getUserQueuePosition(user1), 1);
    }
    
    function test_CannotEnterQueueTwice() public {
        vm.prank(owner);
        uint256 tokenId1 = raffeNft.mintTo(user1, "raffe-1");
        vm.prank(owner);
        uint256 tokenId2 = raffeNft.mintTo(user1, "raffe-2");
        
        vm.prank(user1);
        raffeRace.enterQueue(tokenId1);
        
        // Should fail to enter with second raffe
        vm.prank(user1);
        vm.expectRevert();
        raffeRace.enterQueue(tokenId2);
    }
    
    function test_CannotQueueHouseRaffe() public {
        // Try to queue a house raffe
        vm.prank(owner);
        vm.expectRevert();
        raffeRace.enterQueue(houseRaffeTokenIds[0]);
    }
    
    function test_QueueFIFOOrder() public {
        // Mint raffes for multiple users
        vm.prank(owner);
        uint256 token1 = raffeNft.mintTo(user1, "raffe-1");
        vm.prank(owner);
        uint256 token2 = raffeNft.mintTo(user2, "raffe-2");
        vm.prank(owner);
        uint256 token3 = raffeNft.mintTo(user3, "raffe-3");
        
        // Enter queue in order
        vm.prank(user1);
        raffeRace.enterQueue(token1);
        vm.prank(user2);
        raffeRace.enterQueue(token2);
        vm.prank(user3);
        raffeRace.enterQueue(token3);
        
        // Check positions
        assertEq(raffeRace.getUserQueuePosition(user1), 1);
        assertEq(raffeRace.getUserQueuePosition(user2), 2);
        assertEq(raffeRace.getUserQueuePosition(user3), 3);
    }

    // ============ Race Creation Tests ============

    function test_CreateRace() public {
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        assertEq(raceId, 0);
        assertEq(raffeRace.nextRaceId(), 1);
        
        // Check race is in AWAITING_ODDS state
        (bool settled, bool oddsSet, bool cancelled) = raffeRace.getRaceFlagsById(raceId);
        assertFalse(settled);
        assertFalse(oddsSet);
        assertFalse(cancelled);
    }
    
    function test_SetProbabilities() public {
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        // Set probabilities (as raceBot) - contract converts to odds with house edge
        vm.prank(bot);
        raffeRace.setProbabilities(raceId, defaultWinProb, defaultPlaceProb, defaultShowProb);
        
        // Check odds are set
        (bool settled, bool oddsSet, bool cancelled) = raffeRace.getRaceFlagsById(raceId);
        assertFalse(settled);
        assertTrue(oddsSet);
        assertFalse(cancelled);
        
        // Check betting window is open
        (uint64 oddsDeadline, uint64 bettingCloseBlock,) = raffeRace.getRaceScheduleById(raceId);
        assertTrue(bettingCloseBlock > block.number);
    }
    
    function test_SetProbabilitiesFailsAfterDeadline() public {
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        // Roll past odds deadline (10 blocks)
        vm.roll(block.number + 11);
        
        // Should fail to set probabilities (even as raceBot, deadline has passed)
        vm.prank(bot);
        vm.expectRevert();
        raffeRace.setProbabilities(raceId, defaultWinProb, defaultPlaceProb, defaultShowProb);
    }
    
    function test_CreateRaceWithQueuedRaffes() public {
        // Mint and queue raffes
        vm.prank(owner);
        uint256 token1 = raffeNft.mintTo(user1, "raffe-1");
        vm.prank(owner);
        uint256 token2 = raffeNft.mintTo(user2, "raffe-2");
        
        vm.prank(user1);
        raffeRace.enterQueue(token1);
        vm.prank(user2);
        raffeRace.enterQueue(token2);
        
        assertEq(raffeRace.getActiveQueueLength(), 2);
        
        // Create race - should pick both queued raffes
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        // Check users removed from queue
        assertFalse(raffeRace.isUserInQueue(user1));
        assertFalse(raffeRace.isUserInQueue(user2));
        assertEq(raffeRace.getActiveQueueLength(), 0);
        
        // Check race lineup
        (uint8 assignedCount, uint256[6] memory tokenIds, address[6] memory originalOwners) = 
            raffeRace.getRaceRaffesById(raceId);
        
        assertEq(assignedCount, 6);
        assertEq(tokenIds[0], token1);
        assertEq(originalOwners[0], user1);
        assertEq(tokenIds[1], token2);
        assertEq(originalOwners[1], user2);
        // Remaining lanes filled with house raffes
        assertEq(originalOwners[2], owner);
        assertEq(originalOwners[3], owner);
        assertEq(originalOwners[4], owner);
        assertEq(originalOwners[5], owner);
    }
    
    function test_CreateRaceEmptyQueue() public {
        // Create race with empty queue - should be all house raffes
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        (uint8 assignedCount,, address[6] memory originalOwners) = 
            raffeRace.getRaceRaffesById(raceId);
        
        assertEq(assignedCount, 6);
        // All lanes should be house raffes
        for (uint8 i = 0; i < 6; i++) {
            assertEq(originalOwners[i], owner);
        }
    }

    // ============ Full Lifecycle Tests ============

    function test_FullRaceLifecycle() public {
        // Queue some raffes
        vm.prank(owner);
        uint256 token1 = raffeNft.mintTo(user1, "racer-1");
        vm.prank(user1);
        raffeRace.enterQueue(token1);
        
        // Create race
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();

        // Check flags - race awaiting odds
        (bool settled, bool oddsSet, bool cancelled) = raffeRace.getRaceFlagsById(raceId);
        assertFalse(settled);
        assertFalse(oddsSet);
        assertFalse(cancelled);
        
        // Set odds (as raceBot)
        vm.prank(bot);
        raffeRace.setProbabilities(raceId, defaultWinProb, defaultPlaceProb, defaultShowProb);
        
        // Check flags - odds set, betting open
        (settled, oddsSet, cancelled) = raffeRace.getRaceFlagsById(raceId);
        assertFalse(settled);
        assertTrue(oddsSet);
        assertFalse(cancelled);

        // Get betting close block
        (, uint64 bettingCloseBlock,) = raffeRace.getRaceScheduleById(raceId);

        // Place bet during betting window (Win bet on lane 0)
        vm.prank(user1);
        raffeRace.placeBet(0, 1_000_000, 0); // 1 USDC Win bet on lane 0

        // Mine to just past betting close block
        vm.roll(bettingCloseBlock + 1);

        // Settle race
        raffeRace.settleRace();

        (settled,,) = raffeRace.getRaceFlagsById(raceId);
        assertTrue(settled);
    }
    
    // ============ Cancellation Tests ============
    
    function test_CancelRaceNoOdds() public {
        // Create race
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        // Roll past odds deadline
        vm.roll(block.number + 11);
        
        // Cancel race
        raffeRace.cancelRaceNoOdds(raceId);
        
        // Check flags
        (bool settled, bool oddsSet, bool cancelled) = raffeRace.getRaceFlagsById(raceId);
        assertFalse(settled);
        assertFalse(oddsSet);
        assertTrue(cancelled);
    }
    
    function test_CancelRaceNoOddsFailsBeforeDeadline() public {
        // Create race
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        // Try to cancel before deadline
        vm.expectRevert();
        raffeRace.cancelRaceNoOdds(raceId);
    }
    
    function test_CancelRaceNoOddsFailsIfOddsSet() public {
        // Create race and set odds
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        vm.prank(bot);
        raffeRace.setProbabilities(raceId, defaultWinProb, defaultPlaceProb, defaultShowProb);
        
        // Roll past original deadline (doesn't matter since odds are set)
        vm.roll(block.number + 11);
        
        // Try to cancel - should fail
        vm.expectRevert();
        raffeRace.cancelRaceNoOdds(raceId);
    }
    
    function test_AutoCancelOnCreateRace() public {
        // Queue a raffe
        vm.prank(owner);
        uint256 token1 = raffeNft.mintTo(user1, "raffe-1");
        vm.prank(user1);
        raffeRace.enterQueue(token1);
        
        // Create first race
        vm.prank(owner);
        uint256 raceId1 = raffeRace.createRace();
        
        // User should be out of queue (selected for race)
        assertFalse(raffeRace.isUserInQueue(user1));
        
        // Roll past odds deadline without setting odds
        vm.roll(block.number + 11);
        
        // Create second race - should auto-cancel first
        vm.prank(owner);
        uint256 raceId2 = raffeRace.createRace();
        
        // First race should be cancelled
        (,, bool cancelled) = raffeRace.getRaceFlagsById(raceId1);
        assertTrue(cancelled);
        
        // User should be in race 2's lineup (restored to priority queue, then selected again)
        // They go priority queue -> race 2 lineup immediately
        assertFalse(raffeRace.isUserInQueue(user1)); // Already consumed into race 2
        
        // Check user is in race 2 lineup
        (uint8 assignedCount, uint256[6] memory tokenIds, address[6] memory originalOwners) = 
            raffeRace.getRaceRaffesById(raceId2);
        assertEq(assignedCount, 6);
        assertEq(tokenIds[0], token1);
        assertEq(originalOwners[0], user1);
        
        // Second race should exist
        assertEq(raceId2, 1);
    }
    
    function test_QueueEntriesRestoredOnCancel() public {
        // Queue raffes
        vm.prank(owner);
        uint256 token1 = raffeNft.mintTo(user1, "raffe-1");
        vm.prank(owner);
        uint256 token2 = raffeNft.mintTo(user2, "raffe-2");
        
        vm.prank(user1);
        raffeRace.enterQueue(token1);
        vm.prank(user2);
        raffeRace.enterQueue(token2);
        
        // Create race
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        // Users should be out of queue
        assertFalse(raffeRace.isUserInQueue(user1));
        assertFalse(raffeRace.isUserInQueue(user2));
        
        // Roll past deadline and cancel
        vm.roll(block.number + 11);
        raffeRace.cancelRaceNoOdds(raceId);
        
        // Users should be back in queue (in priority queue)
        assertTrue(raffeRace.isUserInQueue(user1));
        assertTrue(raffeRace.isUserInQueue(user2));
        assertTrue(raffeRace.isUserInPriorityQueue(user1));
        assertTrue(raffeRace.isUserInPriorityQueue(user2));
    }
    
    function test_InvalidQueueEntrySkipped() public {
        // Mint and queue a raffe
        vm.prank(owner);
        uint256 token1 = raffeNft.mintTo(user1, "raffe-1");
        vm.prank(user1);
        raffeRace.enterQueue(token1);
        
        // Transfer the NFT away (making queue entry invalid)
        vm.prank(user1);
        raffeNft.transferFrom(user1, user2, token1);
        
        // Create race - should skip invalid entry and use house raffes
        vm.prank(owner);
        uint256 raceId = raffeRace.createRace();
        
        // user1 should be removed from queue (entry was invalid)
        assertFalse(raffeRace.isUserInQueue(user1));
        
        // All lanes should be house raffes since the only queue entry was invalid
        (,, address[6] memory originalOwners) = raffeRace.getRaceRaffesById(raceId);
        for (uint8 i = 0; i < 6; i++) {
            assertEq(originalOwners[i], owner);
        }
    }
    
    // ============ Bot Dashboard Tests ============
    
    function test_BotDashboardCreateRace() public {
        // No races - should indicate CREATE_RACE
        (uint8 action, uint256 raceId,,,) = raffeRace.getBotDashboard();
        assertEq(action, raffeRace.BOT_ACTION_CREATE_RACE());
    }
    
    function test_BotDashboardSetProbabilities() public {
        // Create race
        vm.prank(owner);
        raffeRace.createRace();
        
        // Should indicate SET_PROBABILITIES
        (uint8 action, uint256 raceId, uint64 blocksRemaining, uint8[6] memory scores,) = raffeRace.getBotDashboard();
        assertEq(action, raffeRace.BOT_ACTION_SET_PROBABILITIES());
        assertEq(raceId, 0);
        assertTrue(blocksRemaining > 0);
    }
    
    function test_BotDashboardSettleRace() public {
        // Create race and set odds
        vm.prank(owner);
        uint256 raceId = _createRaceAndSetProbabilities();
        
        // Roll past betting window
        (, uint64 bettingCloseBlock,) = raffeRace.getRaceScheduleById(raceId);
        vm.roll(bettingCloseBlock + 1);
        
        // Should indicate SETTLE_RACE
        (uint8 action,,,,) = raffeRace.getBotDashboard();
        assertEq(action, raffeRace.BOT_ACTION_SETTLE_RACE());
    }
    
    function test_BotDashboardCancelRace() public {
        // Create race
        vm.prank(owner);
        raffeRace.createRace();
        
        // Roll past odds deadline without setting odds
        vm.roll(block.number + 11);
        
        // Should indicate CANCEL_RACE
        (uint8 action,,,,) = raffeRace.getBotDashboard();
        assertEq(action, raffeRace.BOT_ACTION_CANCEL_RACE());
    }

    // ============ View Function Tests ============

    function test_ViewFunctions() public view {
        assertEq(address(raffeRace.raffeNft()), address(raffeNft));
        assertEq(address(raffeRace.simulator()), address(simulator));
        assertEq(address(raffeRace.treasury()), address(treasury));
    }

    function test_Simulation() public view {
        bytes32 seed = keccak256("test seed");
        (uint8 winner, uint16[6] memory distances) = raffeRace.simulate(seed);
        
        // Winner should be valid lane
        assertTrue(winner < 6);
        
        // At least one lane should have crossed the finish line
        uint16 maxDist = 0;
        for (uint8 i = 0; i < 6; i++) {
            if (distances[i] > maxDist) maxDist = distances[i];
        }
        assertTrue(maxDist >= 1000);
    }

    function test_AdminCancelRace() public {
        // Create race and set odds
        vm.prank(owner);
        uint256 raceId = _createRaceAndSetProbabilities();

        // Admin cancels the race
        vm.prank(owner);
        raffeRace.adminCancelRace(raceId);

        // Check flags
        (bool settled,, bool cancelled) = raffeRace.getRaceFlagsById(raceId);
        assertTrue(settled);
        assertTrue(cancelled);
    }

    function test_HouseRaffeTokenIds() public view {
        uint256[6] memory ids = raffeRace.getHouseRaffeTokenIds();
        for (uint256 i = 0; i < 6; i++) {
            assertEq(ids[i], houseRaffeTokenIds[i]);
        }
    }
    
    function test_QueuePersistsAcrossRaces() public {
        // Mint raffes for 8 users (more than 6 lanes)
        address[8] memory users;
        uint256[8] memory tokens;
        for (uint8 i = 0; i < 8; i++) {
            users[i] = address(uint160(100 + i));
            vm.prank(owner);
            tokens[i] = raffeNft.mintTo(users[i], string(abi.encodePacked("raffe-", i)));
            vm.prank(users[i]);
            raffeRace.enterQueue(tokens[i]);
        }
        
        assertEq(raffeRace.getActiveQueueLength(), 8);
        
        // Create first race and set odds - takes first 6
        vm.prank(owner);
        uint256 raceId1 = _createRaceAndSetProbabilities();
        
        // First 6 users should be out of queue
        for (uint8 i = 0; i < 6; i++) {
            assertFalse(raffeRace.isUserInQueue(users[i]));
        }
        
        // Last 2 users should still be in queue
        assertTrue(raffeRace.isUserInQueue(users[6]));
        assertTrue(raffeRace.isUserInQueue(users[7]));
        assertEq(raffeRace.getActiveQueueLength(), 2);
        
        // Settle the race
        (, uint64 bettingCloseBlock,) = raffeRace.getRaceScheduleById(raceId1);
        vm.roll(bettingCloseBlock + 1);
        raffeRace.settleRace();
        
        // Wait for cooldown
        vm.roll(block.number + 31);
        
        // Create second race and set odds - takes remaining 2 from queue
        vm.prank(owner);
        uint256 raceId2 = _createRaceAndSetProbabilities();
        
        // All users should be out of queue now
        assertFalse(raffeRace.isUserInQueue(users[6]));
        assertFalse(raffeRace.isUserInQueue(users[7]));
        assertEq(raffeRace.getActiveQueueLength(), 0);
        
        // Check second race lineup - first 2 lanes are queued users, rest are house
        (uint8 assignedCount, uint256[6] memory tokenIds,) = raffeRace.getRaceRaffesById(raceId2);
        assertEq(assignedCount, 6);
        assertEq(tokenIds[0], tokens[6]);
        assertEq(tokenIds[1], tokens[7]);
    }
    
}
