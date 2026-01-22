// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import { LibDiamond } from "../contracts/diamond/libraries/LibDiamond.sol";
import { GiraffeRaceDiamond } from "../contracts/diamond/Diamond.sol";
import { DiamondCutFacet } from "../contracts/diamond/facets/DiamondCutFacet.sol";
import { DiamondLoupeFacet } from "../contracts/diamond/facets/DiamondLoupeFacet.sol";
import { AdminFacet } from "../contracts/diamond/facets/AdminFacet.sol";
import { RaceLifecycleFacet } from "../contracts/diamond/facets/RaceLifecycleFacet.sol";
import { BettingFacet } from "../contracts/diamond/facets/BettingFacet.sol";
import { GiraffeSubmissionFacet } from "../contracts/diamond/facets/GiraffeSubmissionFacet.sol";
import { RaceViewsFacet } from "../contracts/diamond/facets/RaceViewsFacet.sol";

// Existing contracts
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
 * @title DeployDiamond
 * @notice Deployment script for GiraffeRace Diamond implementation
 * @dev Deploys all facets and initializes the diamond with proper function selectors
 */
contract DeployDiamond is Script {
    // Facet instances
    DiamondCutFacet diamondCutFacet;
    DiamondLoupeFacet diamondLoupeFacet;
    AdminFacet adminFacet;
    RaceLifecycleFacet raceLifecycleFacet;
    BettingFacet bettingFacet;
    GiraffeSubmissionFacet giraffeSubmissionFacet;
    RaceViewsFacet raceViewsFacet;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy supporting contracts (same as before)
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        GiraffeNFT giraffeNft = new GiraffeNFT();
        console.log("GiraffeNFT deployed at:", address(giraffeNft));

        GiraffeRaceSimulator simulator = new GiraffeRaceSimulator();
        console.log("GiraffeRaceSimulator deployed at:", address(simulator));

        HouseTreasury treasury = new HouseTreasury(address(usdc), deployer);
        console.log("HouseTreasury deployed at:", address(treasury));

        // Deploy WinProbTable shards
        WinProbTableShard0 shard0 = new WinProbTableShard0();
        WinProbTableShard1 shard1 = new WinProbTableShard1();
        WinProbTableShard2 shard2 = new WinProbTableShard2();
        WinProbTableShard3 shard3 = new WinProbTableShard3();
        WinProbTableShard4 shard4 = new WinProbTableShard4();
        WinProbTableShard5 shard5 = new WinProbTableShard5();
        WinProbTable6 winProbTable = new WinProbTable6(
            address(shard0),
            address(shard1),
            address(shard2),
            address(shard3),
            address(shard4),
            address(shard5)
        );
        console.log("WinProbTable6 deployed at:", address(winProbTable));

        // 2. Mint house giraffes
        uint256[6] memory houseGiraffeTokenIds;
        houseGiraffeTokenIds[0] = giraffeNft.mintTo(deployer, "house-1");
        houseGiraffeTokenIds[1] = giraffeNft.mintTo(deployer, "house-2");
        houseGiraffeTokenIds[2] = giraffeNft.mintTo(deployer, "house-3");
        houseGiraffeTokenIds[3] = giraffeNft.mintTo(deployer, "house-4");
        houseGiraffeTokenIds[4] = giraffeNft.mintTo(deployer, "house-5");
        houseGiraffeTokenIds[5] = giraffeNft.mintTo(deployer, "house-6");
        console.log("Minted 6 house giraffes");

        // 3. Deploy facets
        diamondCutFacet = new DiamondCutFacet();
        console.log("DiamondCutFacet deployed at:", address(diamondCutFacet));

        diamondLoupeFacet = new DiamondLoupeFacet();
        console.log("DiamondLoupeFacet deployed at:", address(diamondLoupeFacet));

        adminFacet = new AdminFacet();
        console.log("AdminFacet deployed at:", address(adminFacet));

        raceLifecycleFacet = new RaceLifecycleFacet();
        console.log("RaceLifecycleFacet deployed at:", address(raceLifecycleFacet));

        bettingFacet = new BettingFacet();
        console.log("BettingFacet deployed at:", address(bettingFacet));

        giraffeSubmissionFacet = new GiraffeSubmissionFacet();
        console.log("GiraffeSubmissionFacet deployed at:", address(giraffeSubmissionFacet));

        raceViewsFacet = new RaceViewsFacet();
        console.log("RaceViewsFacet deployed at:", address(raceViewsFacet));

        // 4. Deploy Diamond
        GiraffeRaceDiamond.DiamondArgs memory diamondArgs = GiraffeRaceDiamond.DiamondArgs({
            giraffeNft: address(giraffeNft),
            treasuryOwner: deployer,
            houseGiraffeTokenIds: houseGiraffeTokenIds,
            simulator: address(simulator),
            treasury: address(treasury),
            winProbTable: address(winProbTable)
        });

        GiraffeRaceDiamond diamond = new GiraffeRaceDiamond(
            deployer,
            address(diamondCutFacet),
            diamondArgs
        );
        console.log("GiraffeRaceDiamond deployed at:", address(diamond));

        // 5. Add facets to diamond
        _addFacets(address(diamond));

        // 6. Authorize diamond in treasury
        treasury.authorize(address(diamond));
        console.log("Diamond authorized in treasury");

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("Diamond:    ", address(diamond));
        console.log("USDC:       ", address(usdc));
        console.log("GiraffeNFT: ", address(giraffeNft));
        console.log("Treasury:   ", address(treasury));
        console.log("Simulator:  ", address(simulator));
        console.log("WinProbTable:", address(winProbTable));
    }

    function _addFacets(address diamond) internal {
        // Build cut array for all facets (except DiamondCutFacet which is added in constructor)
        LibDiamond.FacetCut[] memory cut = new LibDiamond.FacetCut[](6);

        // DiamondLoupeFacet
        cut[0] = LibDiamond.FacetCut({
            facetAddress: address(diamondLoupeFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: _getDiamondLoupeSelectors()
        });

        // AdminFacet
        cut[1] = LibDiamond.FacetCut({
            facetAddress: address(adminFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: _getAdminSelectors()
        });

        // RaceLifecycleFacet
        cut[2] = LibDiamond.FacetCut({
            facetAddress: address(raceLifecycleFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: _getRaceLifecycleSelectors()
        });

        // BettingFacet
        cut[3] = LibDiamond.FacetCut({
            facetAddress: address(bettingFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: _getBettingSelectors()
        });

        // GiraffeSubmissionFacet
        cut[4] = LibDiamond.FacetCut({
            facetAddress: address(giraffeSubmissionFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: _getGiraffeSubmissionSelectors()
        });

        // RaceViewsFacet
        cut[5] = LibDiamond.FacetCut({
            facetAddress: address(raceViewsFacet),
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: _getRaceViewsSelectors()
        });

        // Execute the diamond cut
        DiamondCutFacet(diamond).diamondCut(cut, address(0), "");
        console.log("All facets added to diamond");
    }

    function _getDiamondLoupeSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = DiamondLoupeFacet.facets.selector;
        selectors[1] = DiamondLoupeFacet.facetFunctionSelectors.selector;
        selectors[2] = DiamondLoupeFacet.facetAddresses.selector;
        selectors[3] = DiamondLoupeFacet.facetAddress.selector;
        selectors[4] = DiamondLoupeFacet.supportsInterface.selector;
        return selectors;
    }

    function _getAdminSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = AdminFacet.setHouseEdgeBps.selector;
        selectors[1] = AdminFacet.setMaxBetAmount.selector;
        selectors[2] = AdminFacet.setWinProbTable.selector;
        selectors[3] = AdminFacet.setRaceOdds.selector;
        selectors[4] = AdminFacet.treasuryOwner.selector;
        selectors[5] = AdminFacet.houseEdgeBps.selector;
        selectors[6] = AdminFacet.maxBetAmount.selector;
        selectors[7] = AdminFacet.houseGiraffeTokenIds.selector;
        return selectors;
    }

    function _getRaceLifecycleSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = RaceLifecycleFacet.createRace.selector;
        selectors[1] = RaceLifecycleFacet.finalizeRaceGiraffes.selector;
        selectors[2] = RaceLifecycleFacet.settleRace.selector;
        selectors[3] = RaceLifecycleFacet.nextRaceId.selector;
        selectors[4] = RaceLifecycleFacet.latestRaceId.selector;
        selectors[5] = RaceLifecycleFacet.getActiveRaceIdOrZero.selector;
        selectors[6] = RaceLifecycleFacet.getCreateRaceCooldown.selector;
        return selectors;
    }

    function _getBettingSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = BettingFacet.placeBet.selector;
        selectors[1] = BettingFacet.claim.selector;
        selectors[2] = BettingFacet.claimNextWinningPayout.selector;
        selectors[3] = BettingFacet.getBetById.selector;
        selectors[4] = BettingFacet.getClaimRemaining.selector;
        selectors[5] = BettingFacet.getWinningClaimRemaining.selector;
        selectors[6] = BettingFacet.getNextWinningClaim.selector;
        selectors[7] = BettingFacet.getNextClaim.selector;
        selectors[8] = BettingFacet.settledLiability.selector;
        return selectors;
    }

    function _getGiraffeSubmissionSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = GiraffeSubmissionFacet.submitGiraffe.selector;
        selectors[1] = GiraffeSubmissionFacet.getRaceEntryCount.selector;
        selectors[2] = GiraffeSubmissionFacet.hasSubmitted.selector;
        selectors[3] = GiraffeSubmissionFacet.isTokenEntered.selector;
        selectors[4] = GiraffeSubmissionFacet.getRaceEntry.selector;
        return selectors;
    }

    function _getRaceViewsSelectors() internal pure returns (bytes4[] memory) {
        // NOTE: Removed getRace(), getRaceGiraffes(), getRaceScore() - use ById versions instead
        bytes4[] memory selectors = new bytes4[](16);
        selectors[0] = RaceViewsFacet.laneCount.selector;
        selectors[1] = RaceViewsFacet.tickCount.selector;
        selectors[2] = RaceViewsFacet.speedRange.selector;
        selectors[3] = RaceViewsFacet.trackLength.selector;
        selectors[4] = RaceViewsFacet.getRaceById.selector;
        selectors[5] = RaceViewsFacet.getRaceFlagsById.selector;
        selectors[6] = RaceViewsFacet.getRaceScheduleById.selector;
        selectors[7] = RaceViewsFacet.getRaceOddsById.selector;
        selectors[8] = RaceViewsFacet.getRaceDeadHeatById.selector;
        selectors[9] = RaceViewsFacet.getRaceActionabilityById.selector;
        selectors[10] = RaceViewsFacet.getRaceGiraffesById.selector;
        selectors[11] = RaceViewsFacet.getRaceScoreById.selector;
        selectors[12] = RaceViewsFacet.simulate.selector;
        selectors[13] = RaceViewsFacet.simulateWithScore.selector;
        selectors[14] = RaceViewsFacet.giraffeNft.selector;
        selectors[15] = RaceViewsFacet.simulator.selector;
        // Note: treasury() and winProbTable() have selector conflicts, handled separately
        return selectors;
    }
}
