// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "../contracts/GiraffeRace.sol";
import "../contracts/GiraffeRaceSimulator.sol";
import "../contracts/GiraffeNFT.sol";
import "../contracts/libraries/WinProbTable.sol";

/// @notice Gas measurement harness for core race operations.
/// @dev This measures EVM gas used by the calls inside Foundry tests (good for relative comparisons).
contract GasRaceOpsTest is Test {
    GiraffeRace internal race;
    GiraffeNFT internal giraffeNft;
    GiraffeRaceSimulator internal simulator;

    address internal house = address(0xBEEF);
    address internal alice = address(0xA11CE);
    uint256[6] internal houseTokenIds;

    function setUp() public {
        giraffeNft = new GiraffeNFT();
        for (uint256 i = 0; i < 6; i++) {
            houseTokenIds[i] = giraffeNft.mint(house, string(abi.encodePacked("house-", vm.toString(i))));
        }

        WinProbTable table = new WinProbTable();
        simulator = new GiraffeRaceSimulator();
        race = new GiraffeRace(address(giraffeNft), house, houseTokenIds, address(table), address(simulator));
        giraffeNft.setRaceContract(address(race));

        vm.deal(house, 200 ether);
        vm.prank(house);
        (bool ok,) = address(race).call{ value: 150 ether }("");
        require(ok, "fund race bankroll failed");

        vm.deal(alice, 10 ether);
    }

    function _prepFinalize(uint64 closeBlock, bytes32 forcedLineupBh) internal {
        uint64 submissionCloseBlock = closeBlock - 10;
        // Finalization entropy uses blockhash(submissionCloseBlock - 1).
        vm.roll(uint256(submissionCloseBlock - 1));
        vm.setBlockhash(uint256(submissionCloseBlock - 1), forcedLineupBh);
        vm.roll(uint256(submissionCloseBlock));
    }

    function _prepSettle(uint64 closeBlock, bytes32 forcedBh) internal {
        // Settlement entropy uses blockhash(closeBlock).
        vm.roll(uint256(closeBlock));
        vm.setBlockhash(uint256(closeBlock), forcedBh);
        vm.roll(uint256(closeBlock) + 1);
    }

    function _gasCallCreateRace() internal returns (uint256 gasUsed, uint256 raceId, uint64 closeBlock) {
        uint256 g0 = gasleft();
        raceId = race.createRace();
        gasUsed = g0 - gasleft();
        (closeBlock,,,,,) = race.getRaceById(raceId);
    }

    function _gasCallFinalize() internal returns (uint256 gasUsed, uint256 raceId, uint64 closeBlock) {
        (uint256 gCreate, uint256 rid, uint64 cb) = _gasCallCreateRace();
        gCreate; // caller can log create separately if desired
        raceId = rid;
        closeBlock = cb;

        _prepFinalize(closeBlock, keccak256("forced lineup blockhash gas"));
        uint256 g0 = gasleft();
        race.finalizeRaceGiraffes();
        gasUsed = g0 - gasleft();
    }

    function _gasCallSettleHouseOnly() internal returns (uint256 gasUsed, uint256 raceId, uint64 closeBlock) {
        (uint256 gFinalize, uint256 rid, uint64 cb) = _gasCallFinalize();
        gFinalize;
        raceId = rid;
        closeBlock = cb;

        _prepSettle(closeBlock, keccak256("forced settle blockhash gas"));
        uint256 g0 = gasleft();
        race.settleRace();
        gasUsed = g0 - gasleft();
    }

    function testGas_RaceOps_HouseOnly() public {
        vm.roll(1000);

        (uint256 gCreate,, uint64 closeBlock) = _gasCallCreateRace();
        _prepFinalize(closeBlock, keccak256("forced lineup blockhash gas house"));
        uint256 g0 = gasleft();
        race.finalizeRaceGiraffes();
        uint256 gFinalize = g0 - gasleft();

        _prepSettle(closeBlock, keccak256("forced settle blockhash gas house"));
        g0 = gasleft();
        race.settleRace();
        uint256 gSettle = g0 - gasleft();

        console2.log("---- Gas (house-only) ----");
        console2.log("createRace:", gCreate);
        console2.log("finalizeRaceGiraffes:", gFinalize);
        console2.log("settleRace:", gSettle);
        console2.log("total (create+finalize+settle):", gCreate + gFinalize + gSettle);
    }

    function testGas_RaceOps_50Entrants() public {
        vm.roll(2000);

        (uint256 gCreate, uint256 raceId, uint64 closeBlock) = _gasCallCreateRace();
        uint64 submissionCloseBlock = closeBlock - 10;

        // 50 unique entrants submit one token each.
        for (uint256 i = 0; i < 50; i++) {
            address entrant = address(uint160(0x1000 + i));
            vm.prank(entrant);
            uint256 tokenId = giraffeNft.mint(entrant, string(abi.encodePacked("entrant-", vm.toString(i))));

            vm.prank(entrant);
            race.submitGiraffe(tokenId);
        }

        // Finalize at submissionCloseBlock.
        vm.roll(uint256(submissionCloseBlock - 1));
        vm.setBlockhash(uint256(submissionCloseBlock - 1), keccak256("forced lineup blockhash gas 50"));
        vm.roll(uint256(submissionCloseBlock));

        uint256 g0 = gasleft();
        race.finalizeRaceGiraffes();
        uint256 gFinalize = g0 - gasleft();

        _prepSettle(closeBlock, keccak256("forced settle blockhash gas 50"));
        g0 = gasleft();
        race.settleRace();
        uint256 gSettle = g0 - gasleft();

        console2.log("---- Gas (50 entrants) ----");
        console2.log("raceId:", raceId);
        console2.log("createRace:", gCreate);
        console2.log("finalizeRaceGiraffes:", gFinalize);
        console2.log("settleRace:", gSettle);
        console2.log("total (create+finalize+settle):", gCreate + gFinalize + gSettle);
    }

    /// @notice Micro-benchmarks to help estimate per-lane scaling.
    function testGas_MicroBenchmarks() public {
        // statsOf() cost (view call).
        uint256 g0 = gasleft();
        giraffeNft.statsOf(houseTokenIds[0]);
        uint256 gStats = g0 - gasleft();

        // decreaseReadiness() cost (state write). Must be called by race contract address.
        vm.startPrank(address(race));
        g0 = gasleft();
        giraffeNft.decreaseReadiness(houseTokenIds[0]);
        uint256 gDec = g0 - gasleft();
        vm.stopPrank();

        // simulator winner cost (pure computation for 4 lanes).
        uint8[6] memory score = [uint8(10), 10, 10, 10, 10, 10];
        g0 = gasleft();
        simulator.winnerWithScore(keccak256("seed"), score);
        uint256 gSimWinner = g0 - gasleft();

        console2.log("---- Gas micro-benchmarks (6 lanes) ----");
        console2.log("GiraffeNFT.statsOf:", gStats);
        console2.log("GiraffeNFT.decreaseReadiness:", gDec);
        console2.log("Simulator.winnerWithScore:", gSimWinner);
    }
}

