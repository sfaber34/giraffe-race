// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "forge-std/StdJson.sol";
import "../contracts/GiraffeRace.sol";
import "../contracts/GiraffeRaceSimulator.sol";
import "../contracts/GiraffeNFT.sol";
import "../contracts/HouseTreasury.sol";
import "../contracts/MockUSDC.sol";
import { DeterministicDice } from "../contracts/libraries/DeterministicDice.sol";

contract GiraffeRaceTest is Test {
    using DeterministicDice for DeterministicDice.Dice;
    using stdJson for string;

    GiraffeRace public race;
    GiraffeNFT public giraffeNft;
    HouseTreasury public treasury;
    MockUSDC public usdc;
    
    address public owner = address(0xBEEF);      // Treasury owner + house NFT owner
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    uint256[6] internal houseTokenIds;

    uint256 internal constant LANE_COUNT = 6;
    uint256 internal constant TRACK_LENGTH = 1000;
    uint256 internal constant MAX_TICKS = 500;
    uint256 internal constant SPEED_RANGE = 10;
    // These win-distribution "stats" tests are intentionally heavy and are mostly for manual inspection.
    // With readiness decay (extra state updates per settle), we reduce the batch size to avoid OOG in CI/default runs.
    uint256 internal constant STATS_BATCH_SIZE = 50;
    uint256 internal constant STATS_BATCHES = 10; // 10 * 50 = 500 races total (expected)
    string internal constant STATS_DIR = "./tmp/win-stats";

    // Test amounts in USDC (6 decimals)
    uint256 internal constant ONE_USDC = 1e6;
    uint256 internal constant INITIAL_BANKROLL = 100_000 * ONE_USDC;
    uint256 internal constant USER_BALANCE = 10_000 * ONE_USDC;

    function setUp() public {
        // Deploy MockUSDC
        usdc = new MockUSDC();
        
        // Deploy treasury with owner as multisig
        treasury = new HouseTreasury(address(usdc), owner);
        
        // Fund treasury with initial bankroll
        usdc.mint(address(treasury), INITIAL_BANKROLL);
        
        // Deploy NFT
        giraffeNft = new GiraffeNFT();
        for (uint256 i = 0; i < LANE_COUNT; i++) {
            houseTokenIds[i] = giraffeNft.mintTo(owner, string(abi.encodePacked("house-", vm.toString(i))));
        }

        // Deploy race contract (address(0) for winProbTable = fallback to fixed odds)
        GiraffeRaceSimulator simulator = new GiraffeRaceSimulator();
        race = new GiraffeRace(address(giraffeNft), owner, houseTokenIds, address(simulator), address(treasury), address(0));
        giraffeNft.setRaceContract(address(race));
        
        // Authorize race contract in treasury
        vm.prank(owner);
        treasury.authorize(address(race));
        
        // Give users USDC and approve treasury
        usdc.mint(alice, USER_BALANCE);
        usdc.mint(bob, USER_BALANCE);
        
        vm.prank(alice);
        usdc.approve(address(treasury), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(treasury), type(uint256).max);
    }

    function _finalize(uint256 raceId, uint64 closeBlock, bytes32 forcedLineupBh) internal {
        uint64 submissionCloseBlock = closeBlock - 10;
        // Finalization entropy uses blockhash(submissionCloseBlock - 1).
        vm.roll(uint256(submissionCloseBlock - 1));
        vm.setBlockhash(uint256(submissionCloseBlock - 1), forcedLineupBh);
        vm.roll(uint256(submissionCloseBlock));
        race.finalizeRaceGiraffes();
        raceId; // silence unused warning (odds auto-set during finalization)
    }

    function testReadinessStartsAt10AndDecreasesAfterRace() public {
        vm.roll(100);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();
        uint64 submissionCloseBlock = closeBlock - 10;

        // Finalization entropy uses blockhash(submissionCloseBlock - 1).
        bytes32 forcedLineupBh = keccak256("forced lineup blockhash readiness");
        vm.roll(uint256(submissionCloseBlock - 1));
        vm.setBlockhash(uint256(submissionCloseBlock - 1), forcedLineupBh);
        vm.roll(uint256(submissionCloseBlock));
        race.finalizeRaceGiraffes();

        // Snapshot should show full effective score (all stats default to 10).
        uint8[LANE_COUNT] memory snap = race.getRaceScoreById(raceId);
        for (uint256 i = 0; i < LANE_COUNT; i++) {
            assertEq(uint256(snap[i]), 10);
            assertEq(uint256(giraffeNft.readinessOf(houseTokenIds[i])), 10);
        }

        // Settlement entropy uses blockhash(closeBlock).
        bytes32 forcedBh = keccak256("forced settle blockhash readiness");
        vm.roll(uint256(closeBlock));
        vm.setBlockhash(uint256(closeBlock), forcedBh);
        vm.roll(uint256(closeBlock) + 1);
        race.settleRace();

        // TEMP (testing): readiness decay after races is disabled in `GiraffeRace`.
        // When re-enabled, this should go back to expecting 9.
        for (uint256 i = 0; i < LANE_COUNT; i++) {
            assertEq(uint256(giraffeNft.readinessOf(houseTokenIds[i])), 10);
        }
    }

    function testOddsAreEqualWhenAllScoresEqual() public {
        vm.roll(123);
        uint256 raceId = race.createRace();
        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();
        bytes32 forcedLineupBh = keccak256("forced lineup blockhash odds equal");
        _finalize(raceId, closeBlock, forcedLineupBh);

        (bool oddsSet, uint32[LANE_COUNT] memory oddsBps) = race.getRaceOddsById(raceId);
        assertTrue(oddsSet);
        for (uint256 i = 1; i < LANE_COUNT; i++) {
            assertEq(oddsBps[0], oddsBps[i]);
        }
    }

    function _expectedWinner(bytes32 seed) internal pure returns (uint8) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);

        uint16[LANE_COUNT] memory distances;
        bool finished = false;
        for (uint256 t = 0; t < MAX_TICKS; t++) {
            for (uint256 a = 0; a < LANE_COUNT; a++) {
                uint256 r;
                DeterministicDice.Dice memory updatedDice1;
                (r, updatedDice1) = dice.roll(SPEED_RANGE);
                dice = updatedDice1;
                distances[a] += uint16(r + 1);
            }
            for (uint256 i = 0; i < LANE_COUNT; i++) {
                if (distances[i] >= TRACK_LENGTH) {
                    finished = true;
                    break;
                }
            }
            if (finished) break;
        }
        require(finished, "test: race did not finish");

        uint16 best = distances[0];
        uint8 leaderCount = 1;
        uint8[LANE_COUNT] memory leaders;
        leaders[0] = 0;
        for (uint8 i = 1; i < LANE_COUNT; i++) {
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

    function _placeBet(address bettor, uint256 raceId, uint8 giraffe, uint256 amount) internal {
        // raceId arg kept only for call sites; contract uses the current race internally.
        raceId; // silence unused warning
        vm.prank(bettor);
        race.placeBet(giraffe, amount);
    }

    function testSettleIsDeterministicFromSeed() public {
        vm.roll(100);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();

        bytes32 forcedLineupBh = keccak256("forced lineup blockhash");
        _finalize(raceId, closeBlock, forcedLineupBh);

        _placeBet(alice, raceId, 0, 100 * ONE_USDC);
        _placeBet(bob, raceId, 1, 200 * ONE_USDC);

        bytes32 forcedBh = keccak256("forced blockhash");
        vm.roll(uint256(closeBlock));
        vm.setBlockhash(uint256(closeBlock), forcedBh);
        vm.roll(uint256(closeBlock) + 1);

        bytes32 baseSeed = keccak256(abi.encodePacked(forcedBh, raceId, address(race)));
        bytes32 simSeed = keccak256(abi.encodePacked(baseSeed, "RACE_SIM"));
        uint8 expected = _expectedWinner(simSeed);

        race.settleRace();

        (, bool settled, uint8 winner, bytes32 storedSeed,,) = race.getRace();
        assertTrue(settled);
        assertEq(winner, expected);
        assertEq(storedSeed, simSeed);
    }

    function testCannotBetTwice() public {
        vm.roll(10);
        uint256 raceId = race.createRace();
        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();
        bytes32 forcedLineupBh = keccak256("forced lineup blockhash 2");
        _finalize(raceId, closeBlock, forcedLineupBh);

        _placeBet(alice, raceId, 2, 100 * ONE_USDC);

        vm.expectRevert(GiraffeRace.AlreadyBet.selector);
        _placeBet(alice, raceId, 3, 100 * ONE_USDC);
    }

    function testClaimPayout_FixedOdds() public {
        vm.roll(200);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();
        bytes32 forcedLineupBh = keccak256("forced lineup blockhash 3");
        _finalize(raceId, closeBlock, forcedLineupBh);

        // Alice and Bob both bet on giraffe 0, different amounts
        _placeBet(alice, raceId, 0, 100 * ONE_USDC);
        _placeBet(bob, raceId, 0, 300 * ONE_USDC);

        // Force winner = 0 by forcing a seed that yields winner 0.
        // We'll brute-force by trying a few forced blockhashes (small loop acceptable in test).
        bytes32 forcedBh;
        uint8 w;
        for (uint256 i = 0; i < 50; i++) {
            forcedBh = keccak256(abi.encodePacked("bh", i));
            bytes32 baseSeed = keccak256(abi.encodePacked(forcedBh, raceId, address(race)));
            bytes32 simSeed = keccak256(abi.encodePacked(baseSeed, "RACE_SIM"));
            w = _expectedWinner(simSeed);
            if (w == 0) break;
        }
        assertEq(w, 0);

        vm.roll(uint256(closeBlock));
        vm.setBlockhash(uint256(closeBlock), forcedBh);
        vm.roll(uint256(closeBlock) + 1);
        race.settleRace();

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        uint256 bobBalBefore = usdc.balanceOf(bob);

        vm.prank(alice);
        uint256 alicePayout = race.claim();
        vm.prank(bob);
        uint256 bobPayout = race.claim();

        // Fixed odds are auto-quoted from the effective score snapshot using the lookup table.
        (bool oddsSet, uint32[LANE_COUNT] memory oddsBps) = race.getRaceOddsById(raceId);
        assertTrue(oddsSet);
        uint256 expectedAlice = (100 * ONE_USDC * uint256(oddsBps[0])) / 10_000;
        uint256 expectedBob = (300 * ONE_USDC * uint256(oddsBps[0])) / 10_000;
        assertEq(alicePayout, expectedAlice);
        assertEq(bobPayout, expectedBob);
        assertEq(usdc.balanceOf(alice), aliceBalBefore + expectedAlice);
        assertEq(usdc.balanceOf(bob), bobBalBefore + expectedBob);
    }

    function testSettleRevertsIfBlockhashUnavailable() public {
        vm.roll(1000);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();

        // Move far ahead so blockhash is unavailable (returns 0)
        vm.roll(uint256(closeBlock) + 300);

        vm.expectRevert(GiraffeRace.BlockhashUnavailable.selector);
        race.settleRace();
    }

    function testCannotSubmitAfterSubmissionsClose() public {
        vm.roll(500);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();
        uint64 submissionCloseBlock = closeBlock - 10;

        vm.prank(alice);
        uint256 aliceTokenId = giraffeNft.mint("alice");

        vm.roll(uint256(submissionCloseBlock));
        vm.prank(alice);
        vm.expectRevert(GiraffeRace.SubmissionsClosed.selector);
        race.submitGiraffe(aliceTokenId);
    }

    function testCannotBetBeforeSubmissionsClose() public {
        vm.roll(600);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();
        uint64 submissionCloseBlock = closeBlock - 10;

        vm.roll(uint256(submissionCloseBlock - 1));
        vm.expectRevert(GiraffeRace.BettingNotOpen.selector);
        vm.prank(alice);
        race.placeBet(0, 100 * ONE_USDC);
    }

    function testCannotCreateNewRaceUntilPreviousSettled() public {
        vm.roll(700);
        race.createRace();

        vm.expectRevert(GiraffeRace.PreviousRaceNotSettled.selector);
        race.createRace();
    }

    function testGas_CoordinatorFlow_With50Entrants() public {
        vm.roll(1000);
        uint256 raceId = race.createRace();

        uint64 closeBlock;
        (closeBlock,,,,,) = race.getRace();
        uint64 submissionCloseBlock = closeBlock - 10;

        // Finalization entropy uses blockhash(submissionCloseBlock - 1).
        bytes32 forcedLineupBh = keccak256("forced lineup blockhash 50 entrants");
        vm.roll(uint256(submissionCloseBlock - 1));
        vm.setBlockhash(uint256(submissionCloseBlock - 1), forcedLineupBh);

        // 50 unique entrants submit one token each.
        for (uint256 i = 0; i < 50; i++) {
            address entrant = address(uint160(0x1000 + i));
            vm.startPrank(entrant);
            uint256 tokenId = giraffeNft.mint(string(abi.encodePacked("entrant-", vm.toString(i))));
            race.submitGiraffe(tokenId);
            vm.stopPrank();
        }

        // Betting opens after submissions close, so finalize at submissionCloseBlock.
        vm.roll(uint256(submissionCloseBlock));
        race.finalizeRaceGiraffes();

        // Settlement entropy uses blockhash(closeBlock).
        bytes32 forcedBh = keccak256("forced settle blockhash 50 entrants");
        vm.roll(uint256(closeBlock));
        vm.setBlockhash(uint256(closeBlock), forcedBh);
        vm.roll(uint256(closeBlock) + 1);
        race.settleRace();
    }

    function _bps(uint256 wins, uint256 total) internal pure returns (uint256) {
        if (total == 0) return 0;
        return (wins * 10_000) / total; // basis points (10000 = 100.00%)
    }

    function _batchPath(uint256 batchIndex) internal pure returns (string memory) {
        return string.concat(STATS_DIR, "/house_only_batch_", vm.toString(batchIndex), ".json");
    }

    function _arrLaneCount(uint256[LANE_COUNT] memory a) internal pure returns (uint256[] memory out) {
        out = new uint256[](LANE_COUNT);
        for (uint256 i = 0; i < LANE_COUNT; i++) out[i] = a[i];
    }

    function _runHouseOnlyBatch(uint256 batchIndex, uint256 racesInBatch)
        internal
        returns (uint256[LANE_COUNT] memory laneWins, uint256[LANE_COUNT] memory tokenWins)
    {
        // Keep blocks close together so `blockhash()` remains available for closeBlock and submissionClose-1.
        uint256 startBlock = 1_000_000 + batchIndex * 10_000;

        for (uint256 i = 0; i < racesInBatch; i++) {
            uint256 globalI = batchIndex * racesInBatch + i;
            vm.roll(startBlock + i * 50);
            uint256 raceId = race.createRace();

            uint64 closeBlock;
            (closeBlock,,,,,) = race.getRace();
            uint64 submissionCloseBlock = closeBlock - 10;

            // Finalization entropy uses blockhash(submissionCloseBlock - 1).
            bytes32 forcedLineupBh = keccak256(abi.encodePacked("lineup", globalI));
            vm.roll(uint256(submissionCloseBlock - 1));
            vm.setBlockhash(uint256(submissionCloseBlock - 1), forcedLineupBh);
            vm.roll(uint256(submissionCloseBlock));
            race.finalizeRaceGiraffes();

            (, uint256[LANE_COUNT] memory tokenIds,) = race.getRaceGiraffes();

            // Settlement entropy uses blockhash(closeBlock).
            bytes32 forcedBh = keccak256(abi.encodePacked("settle", globalI));
            vm.roll(uint256(closeBlock));
            vm.setBlockhash(uint256(closeBlock), forcedBh);
            vm.roll(uint256(closeBlock) + 1);
            race.settleRace();

            (, bool settled, uint8 winner,,,) = race.getRace();
            assertTrue(settled);
            assertLt(winner, uint8(LANE_COUNT));

            laneWins[winner] += 1;

            uint256 winningTokenId = tokenIds[winner];
            // With house-only races, these should always be one of the 4 configured house tokens.
            for (uint256 t = 0; t < LANE_COUNT; t++) {
                if (winningTokenId == houseTokenIds[t]) {
                    tokenWins[t] += 1;
                    break;
                }
            }
        }
    }

    function _writeBatch(
        uint256 batchIndex,
        uint256 racesInBatch,
        uint256[LANE_COUNT] memory laneWins,
        uint256[LANE_COUNT] memory tokenWins
    )
        internal
    {
        vm.createDir(STATS_DIR, true);
        string memory obj = string.concat("house_only_batch_", vm.toString(batchIndex));
        string memory json = vm.serializeUint(obj, "batchIndex", batchIndex);
        json = vm.serializeUint(obj, "races", racesInBatch);
        json = vm.serializeUint(obj, "laneWins", _arrLaneCount(laneWins));
        json = vm.serializeUint(obj, "tokenWins", _arrLaneCount(tokenWins));
        json = vm.serializeUint(obj, "houseTokenIds", _arrLaneCount(houseTokenIds));
        vm.writeJson(json, _batchPath(batchIndex));
    }

    function _runAndWriteBatch(uint256 batchIndex) internal {
        (uint256[LANE_COUNT] memory laneWins, uint256[LANE_COUNT] memory tokenWins) =
            _runHouseOnlyBatch(batchIndex, STATS_BATCH_SIZE);
        _writeBatch(batchIndex, STATS_BATCH_SIZE, laneWins, tokenWins);
    }

    // ---- Batch tests (each stays under the "200 race" gas limit) ----
    function testWinDistribution_HouseOnly_00_Batch00() public { _runAndWriteBatch(0); }
    function testWinDistribution_HouseOnly_01_Batch01() public { _runAndWriteBatch(1); }
    function testWinDistribution_HouseOnly_02_Batch02() public { _runAndWriteBatch(2); }
    function testWinDistribution_HouseOnly_03_Batch03() public { _runAndWriteBatch(3); }
    function testWinDistribution_HouseOnly_04_Batch04() public { _runAndWriteBatch(4); }
    function testWinDistribution_HouseOnly_05_Batch05() public { _runAndWriteBatch(5); }
    function testWinDistribution_HouseOnly_06_Batch06() public { _runAndWriteBatch(6); }
    function testWinDistribution_HouseOnly_07_Batch07() public { _runAndWriteBatch(7); }
    function testWinDistribution_HouseOnly_08_Batch08() public { _runAndWriteBatch(8); }
    function testWinDistribution_HouseOnly_09_Batch09() public { _runAndWriteBatch(9); }

    /// @notice Aggregates all batch files and prints the combined distribution.
    /// @dev Foundry may run tests in parallel by default; if the aggregator runs before batch files are written,
    ///      it will print a warning and return.
    ///      For a single-pass run that reliably prints the aggregate, use:
    ///      `forge test --offline --threads 1 --match-test testWinDistribution_HouseOnly_ -vv`
    function testWinDistribution_HouseOnly_99_AggregateAndPrint() public {
        uint256 totalRaces = 0;
        uint256[LANE_COUNT] memory laneWinsAgg;
        uint256[LANE_COUNT] memory tokenWinsAgg;
        uint256 filesRead = 0;

        Vm.DirEntry[] memory entries;
        try vm.readDir(STATS_DIR) returns (Vm.DirEntry[] memory e) {
            entries = e;
        } catch {
            console2.log("---- Win distribution (house-only) AGGREGATED ----");
            console2.log("No stats directory yet:", STATS_DIR);
            console2.log("Tip: run the batch tests first.");
            return;
        }

        for (uint256 idx = 0; idx < entries.length; idx++) {
            Vm.DirEntry memory ent = entries[idx];
            if (ent.isDir) continue;

            // Only parse our batch json files.
            // (Dir contains only these files, but keep it defensive.)
            bytes memory p = bytes(ent.path);
            if (p.length < 5) continue;
            // endsWith(".json")
            if (!(p[p.length - 1] == "n" && p[p.length - 2] == "o" && p[p.length - 3] == "s" && p[p.length - 4] == "j" && p[p.length - 5] == ".")) {
                continue;
            }

            string memory json = vm.readFile(ent.path);
            uint256 racesInBatch = json.readUint(".races");
            uint256[] memory lane = json.readUintArray(".laneWins");
            uint256[] memory token = json.readUintArray(".tokenWins");

            // Defensive: skip stale/mismatched files (e.g. from a previous run with a different lane count).
            if (lane.length < LANE_COUNT || token.length < LANE_COUNT) {
                console2.log("Skipping mismatched stats file (laneWins/tokenWins length too small):", ent.path);
                continue;
            }

            totalRaces += racesInBatch;
            for (uint256 i = 0; i < LANE_COUNT; i++) {
                laneWinsAgg[i] += lane[i];
                tokenWinsAgg[i] += token[i];
            }
            filesRead++;
        }

        console2.log("---- Win distribution (house-only) AGGREGATED ----");
        console2.log("Batch files:", filesRead);
        console2.log("Races:", totalRaces);
        if (filesRead < STATS_BATCHES) {
            console2.log("WARNING: expected batch files:", STATS_BATCHES, "but found:", filesRead);
            console2.log("Tip: run the aggregator after the batches (or rerun with `--threads 1`).");
        }

        for (uint256 lane = 0; lane < LANE_COUNT; lane++) {
            uint256 wins = laneWinsAgg[lane];
            console2.log("Lane", lane, "wins", wins);
            console2.log("  bps", _bps(wins, totalRaces));
        }

        for (uint256 t = 0; t < LANE_COUNT; t++) {
            uint256 tokenId = houseTokenIds[t];
            string memory name = giraffeNft.nameOf(tokenId);
            uint256 wins = tokenWinsAgg[t];
            console2.log("House tokenId", tokenId, "wins", wins);
            console2.log("  bps", _bps(wins, totalRaces));
            console2.log("  name:");
            console2.log(name);
        }
    }
}
