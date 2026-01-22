// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import { LibDiamond } from "../contracts/diamond/libraries/LibDiamond.sol";
import { GiraffeRaceDiamond } from "../contracts/diamond/Diamond.sol";
import { DiamondCutFacet } from "../contracts/diamond/facets/DiamondCutFacet.sol";
import { DiamondLoupeFacet } from "../contracts/diamond/facets/DiamondLoupeFacet.sol";
import { AdminFacet } from "../contracts/diamond/facets/AdminFacet.sol";
import { RaceLifecycleFacet } from "../contracts/diamond/facets/RaceLifecycleFacet.sol";
import { BettingFacet } from "../contracts/diamond/facets/BettingFacet.sol";
import { GiraffeSubmissionFacet } from "../contracts/diamond/facets/GiraffeSubmissionFacet.sol";
import { RaceViewsFacet } from "../contracts/diamond/facets/RaceViewsFacet.sol";

import { GiraffeNFT } from "../contracts/GiraffeNFT.sol";
import { GiraffeRaceSimulator } from "../contracts/GiraffeRaceSimulator.sol";
import { HouseTreasury } from "../contracts/HouseTreasury.sol";
import { MockUSDC } from "../contracts/MockUSDC.sol";
import { WinProbTable6 } from "../contracts/libraries/WinProbTable6.sol";
import { WinProbTableShard0 } from "../contracts/libraries/WinProbTableShard0.sol";
import { WinProbTableShard1 } from "../contracts/libraries/WinProbTableShard1.sol";
import { WinProbTableShard2 } from "../contracts/libraries/WinProbTableShard2.sol";
import { WinProbTableShard3 } from "../contracts/libraries/WinProbTableShard3.sol";
import { WinProbTableShard4 } from "../contracts/libraries/WinProbTableShard4.sol";
import { WinProbTableShard5 } from "../contracts/libraries/WinProbTableShard5.sol";

/**
 * @title GiraffeRaceDiamondTest
 * @notice Tests for the Diamond implementation of GiraffeRace
 */
contract GiraffeRaceDiamondTest is Test {
    // Diamond and facets
    GiraffeRaceDiamond diamond;
    DiamondCutFacet diamondCutFacet;
    DiamondLoupeFacet diamondLoupeFacet;
    AdminFacet adminFacet;
    RaceLifecycleFacet raceLifecycleFacet;
    BettingFacet bettingFacet;
    GiraffeSubmissionFacet giraffeSubmissionFacet;
    RaceViewsFacet raceViewsFacet;

    // Supporting contracts
    MockUSDC usdc;
    GiraffeNFT giraffeNft;
    GiraffeRaceSimulator simulator;
    HouseTreasury treasury;
    WinProbTable6 winProbTable;

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
        
        // Deploy WinProbTable shards
        WinProbTableShard0 shard0 = new WinProbTableShard0();
        WinProbTableShard1 shard1 = new WinProbTableShard1();
        WinProbTableShard2 shard2 = new WinProbTableShard2();
        WinProbTableShard3 shard3 = new WinProbTableShard3();
        WinProbTableShard4 shard4 = new WinProbTableShard4();
        WinProbTableShard5 shard5 = new WinProbTableShard5();
        winProbTable = new WinProbTable6(
            address(shard0),
            address(shard1),
            address(shard2),
            address(shard3),
            address(shard4),
            address(shard5)
        );

        // Mint house giraffes
        houseGiraffeTokenIds[0] = giraffeNft.mintTo(owner, "house-1");
        houseGiraffeTokenIds[1] = giraffeNft.mintTo(owner, "house-2");
        houseGiraffeTokenIds[2] = giraffeNft.mintTo(owner, "house-3");
        houseGiraffeTokenIds[3] = giraffeNft.mintTo(owner, "house-4");
        houseGiraffeTokenIds[4] = giraffeNft.mintTo(owner, "house-5");
        houseGiraffeTokenIds[5] = giraffeNft.mintTo(owner, "house-6");

        // Deploy facets
        diamondCutFacet = new DiamondCutFacet();
        diamondLoupeFacet = new DiamondLoupeFacet();
        adminFacet = new AdminFacet();
        raceLifecycleFacet = new RaceLifecycleFacet();
        bettingFacet = new BettingFacet();
        giraffeSubmissionFacet = new GiraffeSubmissionFacet();
        raceViewsFacet = new RaceViewsFacet();

        // Deploy diamond
        GiraffeRaceDiamond.DiamondArgs memory args = GiraffeRaceDiamond.DiamondArgs({
            giraffeNft: address(giraffeNft),
            treasuryOwner: owner,
            houseGiraffeTokenIds: houseGiraffeTokenIds,
            simulator: address(simulator),
            treasury: address(treasury),
            winProbTable: address(winProbTable)
        });

        diamond = new GiraffeRaceDiamond(owner, address(diamondCutFacet), args);

        // Add facets
        _addFacets();

        // Authorize diamond in treasury
        treasury.authorize(address(diamond));

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

    function _addFacets() internal {
        LibDiamond.FacetCut[] memory cut = new LibDiamond.FacetCut[](6);

        // DiamondLoupeFacet
        bytes4[] memory loupeSelectors = new bytes4[](5);
        loupeSelectors[0] = DiamondLoupeFacet.facets.selector;
        loupeSelectors[1] = DiamondLoupeFacet.facetFunctionSelectors.selector;
        loupeSelectors[2] = DiamondLoupeFacet.facetAddresses.selector;
        loupeSelectors[3] = DiamondLoupeFacet.facetAddress.selector;
        loupeSelectors[4] = DiamondLoupeFacet.supportsInterface.selector;
        cut[0] = LibDiamond.FacetCut({
            facetAddress: address(diamondLoupeFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: loupeSelectors
        });

        // AdminFacet
        bytes4[] memory adminSelectors = new bytes4[](8);
        adminSelectors[0] = AdminFacet.setHouseEdgeBps.selector;
        adminSelectors[1] = AdminFacet.setMaxBetAmount.selector;
        adminSelectors[2] = AdminFacet.setWinProbTable.selector;
        adminSelectors[3] = AdminFacet.setRaceOdds.selector;
        adminSelectors[4] = AdminFacet.treasuryOwner.selector;
        adminSelectors[5] = AdminFacet.houseEdgeBps.selector;
        adminSelectors[6] = AdminFacet.maxBetAmount.selector;
        adminSelectors[7] = AdminFacet.houseGiraffeTokenIds.selector;
        cut[1] = LibDiamond.FacetCut({
            facetAddress: address(adminFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: adminSelectors
        });

        // RaceLifecycleFacet
        bytes4[] memory lifecycleSelectors = new bytes4[](7);
        lifecycleSelectors[0] = RaceLifecycleFacet.createRace.selector;
        lifecycleSelectors[1] = RaceLifecycleFacet.finalizeRaceGiraffes.selector;
        lifecycleSelectors[2] = RaceLifecycleFacet.settleRace.selector;
        lifecycleSelectors[3] = RaceLifecycleFacet.nextRaceId.selector;
        lifecycleSelectors[4] = RaceLifecycleFacet.latestRaceId.selector;
        lifecycleSelectors[5] = RaceLifecycleFacet.getActiveRaceIdOrZero.selector;
        lifecycleSelectors[6] = RaceLifecycleFacet.getCreateRaceCooldown.selector;
        cut[2] = LibDiamond.FacetCut({
            facetAddress: address(raceLifecycleFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: lifecycleSelectors
        });

        // BettingFacet (NOTE: getBet removed - use getBetById instead)
        bytes4[] memory bettingSelectors = new bytes4[](9);
        bettingSelectors[0] = BettingFacet.placeBet.selector;
        bettingSelectors[1] = BettingFacet.claim.selector;
        bettingSelectors[2] = BettingFacet.claimNextWinningPayout.selector;
        bettingSelectors[3] = BettingFacet.getBetById.selector;
        bettingSelectors[4] = BettingFacet.getClaimRemaining.selector;
        bettingSelectors[5] = BettingFacet.getWinningClaimRemaining.selector;
        bettingSelectors[6] = BettingFacet.getNextWinningClaim.selector;
        bettingSelectors[7] = BettingFacet.getNextClaim.selector;
        bettingSelectors[8] = BettingFacet.settledLiability.selector;
        cut[3] = LibDiamond.FacetCut({
            facetAddress: address(bettingFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: bettingSelectors
        });

        // GiraffeSubmissionFacet
        bytes4[] memory submissionSelectors = new bytes4[](5);
        submissionSelectors[0] = GiraffeSubmissionFacet.submitGiraffe.selector;
        submissionSelectors[1] = GiraffeSubmissionFacet.getRaceEntryCount.selector;
        submissionSelectors[2] = GiraffeSubmissionFacet.hasSubmitted.selector;
        submissionSelectors[3] = GiraffeSubmissionFacet.isTokenEntered.selector;
        submissionSelectors[4] = GiraffeSubmissionFacet.getRaceEntry.selector;
        cut[4] = LibDiamond.FacetCut({
            facetAddress: address(giraffeSubmissionFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: submissionSelectors
        });

        // RaceViewsFacet (NOTE: getRace, getRaceGiraffes, getRaceScore removed - use ById versions)
        bytes4[] memory viewsSelectors = new bytes4[](16);
        viewsSelectors[0] = RaceViewsFacet.laneCount.selector;
        viewsSelectors[1] = RaceViewsFacet.tickCount.selector;
        viewsSelectors[2] = RaceViewsFacet.speedRange.selector;
        viewsSelectors[3] = RaceViewsFacet.trackLength.selector;
        viewsSelectors[4] = RaceViewsFacet.getRaceById.selector;
        viewsSelectors[5] = RaceViewsFacet.getRaceFlagsById.selector;
        viewsSelectors[6] = RaceViewsFacet.getRaceScheduleById.selector;
        viewsSelectors[7] = RaceViewsFacet.getRaceOddsById.selector;
        viewsSelectors[8] = RaceViewsFacet.getRaceDeadHeatById.selector;
        viewsSelectors[9] = RaceViewsFacet.getRaceActionabilityById.selector;
        viewsSelectors[10] = RaceViewsFacet.getRaceGiraffesById.selector;
        viewsSelectors[11] = RaceViewsFacet.getRaceScoreById.selector;
        viewsSelectors[12] = RaceViewsFacet.simulate.selector;
        viewsSelectors[13] = RaceViewsFacet.simulateWithScore.selector;
        viewsSelectors[14] = RaceViewsFacet.giraffeNft.selector;
        viewsSelectors[15] = RaceViewsFacet.simulator.selector;
        cut[5] = LibDiamond.FacetCut({
            facetAddress: address(raceViewsFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: viewsSelectors
        });

        DiamondCutFacet(address(diamond)).diamondCut(cut, address(0), "");
    }

    // ============ Diamond Tests ============

    function test_DiamondDeployed() public view {
        assertEq(AdminFacet(address(diamond)).treasuryOwner(), owner);
    }

    function test_FacetsAdded() public view {
        address[] memory facetAddresses = DiamondLoupeFacet(address(diamond)).facetAddresses();
        // Should have 7 facets: DiamondCut + 6 we added
        assertEq(facetAddresses.length, 7);
    }

    function test_AdminFunctions() public {
        // Check initial values
        assertEq(AdminFacet(address(diamond)).houseEdgeBps(), 500);
        assertEq(AdminFacet(address(diamond)).maxBetAmount(), 5_000_000);

        // Update as owner
        vm.prank(owner);
        AdminFacet(address(diamond)).setHouseEdgeBps(600);
        assertEq(AdminFacet(address(diamond)).houseEdgeBps(), 600);

        // Should revert for non-owner
        vm.prank(user1);
        vm.expectRevert();
        AdminFacet(address(diamond)).setHouseEdgeBps(700);
    }

    function test_CreateRace() public {
        vm.prank(owner);
        uint256 raceId = RaceLifecycleFacet(address(diamond)).createRace();
        assertEq(raceId, 0);
        assertEq(RaceLifecycleFacet(address(diamond)).nextRaceId(), 1);
    }

    function test_FullRaceLifecycle() public {
        // Create race
        vm.prank(owner);
        uint256 raceId = RaceLifecycleFacet(address(diamond)).createRace();

        // Get submission close block
        (, uint64 submissionCloseBlock,) = RaceViewsFacet(address(diamond)).getRaceScheduleById(raceId);

        // Mine blocks past submission window - need exact block for blockhash
        vm.roll(submissionCloseBlock);

        // Finalize giraffes
        RaceLifecycleFacet(address(diamond)).finalizeRaceGiraffes();

        // Check flags
        (bool settled, bool giraffesFinalized, bool oddsSet) = 
            RaceViewsFacet(address(diamond)).getRaceFlagsById(raceId);
        assertFalse(settled);
        assertTrue(giraffesFinalized);
        assertTrue(oddsSet);

        // Get betting close block
        (uint64 bettingCloseBlock,,) = RaceViewsFacet(address(diamond)).getRaceScheduleById(raceId);

        // Place bet during betting window
        vm.prank(user1);
        BettingFacet(address(diamond)).placeBet(0, 1_000_000); // 1 USDC on lane 0

        // Mine to just past betting close block - need to be within 256 blocks for blockhash
        vm.roll(bettingCloseBlock + 1);

        // Settle race
        RaceLifecycleFacet(address(diamond)).settleRace();

        (settled,,) = RaceViewsFacet(address(diamond)).getRaceFlagsById(raceId);
        assertTrue(settled);
    }

    function test_GiraffeSubmission() public {
        // Mint a giraffe for user1
        vm.prank(owner);
        uint256 tokenId = giraffeNft.mintTo(user1, "test-giraffe");

        // Create race
        vm.prank(owner);
        RaceLifecycleFacet(address(diamond)).createRace();

        // Submit giraffe
        vm.prank(user1);
        GiraffeSubmissionFacet(address(diamond)).submitGiraffe(tokenId);

        // Check submission
        assertTrue(GiraffeSubmissionFacet(address(diamond)).hasSubmitted(0, user1));
        assertTrue(GiraffeSubmissionFacet(address(diamond)).isTokenEntered(0, tokenId));
        assertEq(GiraffeSubmissionFacet(address(diamond)).getRaceEntryCount(0), 1);
    }

    function test_ViewFunctions() public view {
        assertEq(RaceViewsFacet(address(diamond)).laneCount(), 6);
        assertEq(RaceViewsFacet(address(diamond)).trackLength(), 1000);
        assertEq(RaceViewsFacet(address(diamond)).speedRange(), 10);
        assertEq(RaceViewsFacet(address(diamond)).giraffeNft(), address(giraffeNft));
        assertEq(RaceViewsFacet(address(diamond)).simulator(), address(simulator));
    }

    function test_Simulation() public view {
        bytes32 seed = keccak256("test seed");
        (uint8 winner, uint16[6] memory distances) = RaceViewsFacet(address(diamond)).simulate(seed);
        
        // Winner should be valid lane
        assertTrue(winner < 6);
        
        // At least one lane should have crossed the finish line
        uint16 maxDist = 0;
        for (uint8 i = 0; i < 6; i++) {
            if (distances[i] > maxDist) maxDist = distances[i];
        }
        assertTrue(maxDist >= 1000);
    }
}
