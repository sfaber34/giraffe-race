// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "../contracts/GiraffeRace.sol";
import "../contracts/GiraffeRaceSimulator.sol";
import "../contracts/GiraffeNFT.sol";
import "../contracts/HouseTreasury.sol";
import "../contracts/MockUSDC.sol";

/// @notice Gas measurement harness for core race operations.
/// @dev This measures EVM gas used by the calls inside Foundry tests (good for relative comparisons).
contract GasRaceOpsTest is Test {
    GiraffeRace internal race;
    GiraffeNFT internal giraffeNft;
    GiraffeRaceSimulator internal simulator;
    HouseTreasury internal treasury;
    MockUSDC internal usdc;

    address internal treasuryOwner = address(0xBEEF);  // Treasury owner + house NFT owner
    address internal alice = address(0xA11CE);
    uint256[6] internal houseTokenIds;

    uint256 internal constant INITIAL_BANKROLL = 100_000 * 1e6; // 100k USDC

    function setUp() public {
        // Deploy MockUSDC and Treasury
        usdc = new MockUSDC();
        treasury = new HouseTreasury(address(usdc), treasuryOwner);
        usdc.mint(address(treasury), INITIAL_BANKROLL);

        giraffeNft = new GiraffeNFT();
        for (uint256 i = 0; i < 6; i++) {
            houseTokenIds[i] = giraffeNft.mintTo(treasuryOwner, string(abi.encodePacked("house-", vm.toString(i))));
        }

        simulator = new GiraffeRaceSimulator();
        race = new GiraffeRace(address(giraffeNft), treasuryOwner, houseTokenIds, address(simulator), address(treasury), address(0));
        giraffeNft.setRaceContract(address(race));

        // Authorize race contract in treasury
        vm.prank(treasuryOwner);
        treasury.authorize(address(race));
    }

    function _prepFinalize(uint256 raceId, bytes32 forcedLineupBh) internal returns (uint64 submissionCloseBlock) {
        // Get submissionCloseBlock from schedule
        (, submissionCloseBlock,) = race.getRaceScheduleById(raceId);
        // Finalization entropy uses blockhash(submissionCloseBlock - 1).
        vm.roll(uint256(submissionCloseBlock - 1));
        vm.setBlockhash(uint256(submissionCloseBlock - 1), forcedLineupBh);
        vm.roll(uint256(submissionCloseBlock));
    }

    function _prepSettle(uint256 raceId, bytes32 forcedBh) internal returns (uint64 bettingCloseBlock) {
        // Get bettingCloseBlock from schedule (should be set after finalization)
        (bettingCloseBlock,,) = race.getRaceScheduleById(raceId);
        require(bettingCloseBlock > 0, "bettingCloseBlock not set - finalization required first");
        // Settlement entropy uses blockhash(bettingCloseBlock).
        vm.roll(uint256(bettingCloseBlock));
        vm.setBlockhash(uint256(bettingCloseBlock), forcedBh);
        vm.roll(uint256(bettingCloseBlock) + 1);
    }

    function _gasCallCreateRace() internal returns (uint256 gasUsed, uint256 raceId) {
        uint256 g0 = gasleft();
        raceId = race.createRace();
        gasUsed = g0 - gasleft();
    }

    function _gasCallFinalize() internal returns (uint256 gasUsed, uint256 raceId) {
        (uint256 gCreate, uint256 rid) = _gasCallCreateRace();
        gCreate; // caller can log create separately if desired
        raceId = rid;

        _prepFinalize(raceId, keccak256("forced lineup blockhash gas"));
        uint256 g0 = gasleft();
        race.finalizeRaceGiraffes();
        gasUsed = g0 - gasleft();
    }

    function _gasCallSettleHouseOnly() internal returns (uint256 gasUsed, uint256 raceId) {
        (uint256 gFinalize, uint256 rid) = _gasCallFinalize();
        gFinalize;
        raceId = rid;

        _prepSettle(raceId, keccak256("forced settle blockhash gas"));
        uint256 g0 = gasleft();
        race.settleRace();
        gasUsed = g0 - gasleft();
    }

    function testGas_RaceOps_HouseOnly() public {
        vm.roll(1000);

        (uint256 gCreate, uint256 raceId) = _gasCallCreateRace();
        _prepFinalize(raceId, keccak256("forced lineup blockhash gas house"));
        uint256 g0 = gasleft();
        race.finalizeRaceGiraffes();
        uint256 gFinalize = g0 - gasleft();

        _prepSettle(raceId, keccak256("forced settle blockhash gas house"));
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

        (uint256 gCreate, uint256 raceId) = _gasCallCreateRace();
        
        // Get the schedule - submissionCloseBlock is set at creation
        (, uint64 submissionCloseBlock,) = race.getRaceScheduleById(raceId);

        // 50 unique entrants submit one token each.
        for (uint256 i = 0; i < 50; i++) {
            address entrant = address(uint160(0x1000 + i));
            vm.startPrank(entrant);
            uint256 tokenId = giraffeNft.mint(string(abi.encodePacked("entrant-", vm.toString(i))));
            race.submitGiraffe(tokenId);
            vm.stopPrank();
        }

        // Finalize at submissionCloseBlock.
        vm.roll(uint256(submissionCloseBlock - 1));
        vm.setBlockhash(uint256(submissionCloseBlock - 1), keccak256("forced lineup blockhash gas 50"));
        vm.roll(uint256(submissionCloseBlock));

        uint256 g0 = gasleft();
        race.finalizeRaceGiraffes();
        uint256 gFinalize = g0 - gasleft();

        _prepSettle(raceId, keccak256("forced settle blockhash gas 50"));
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

        // simulator winner cost (pure computation for 4 lanes).
        uint8[6] memory score = [uint8(10), 10, 10, 10, 10, 10];
        g0 = gasleft();
        simulator.winnerWithScore(keccak256("seed"), score);
        uint256 gSimWinner = g0 - gasleft();

        console2.log("---- Gas micro-benchmarks (6 lanes) ----");
        console2.log("GiraffeNFT.statsOf:", gStats);
        console2.log("Simulator.winnerWithScore:", gSimWinner);
    }
}
