// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/GiraffeRace.sol";
import "../contracts/GiraffeRaceSimulator.sol";
import "../contracts/GiraffeNFT.sol";
import "../contracts/HouseTreasury.sol";
import "../contracts/MockUSDC.sol";
import "../contracts/libraries/WinProbTableShard0.sol";
import "../contracts/libraries/WinProbTableShard1.sol";
import "../contracts/libraries/WinProbTableShard2.sol";
import "../contracts/libraries/WinProbTableShard3.sol";
import "../contracts/libraries/WinProbTableShard4.sol";
import "../contracts/libraries/WinProbTableShard5.sol";
import "../contracts/libraries/WinProbTable6.sol";

/**
 * @notice Deploy script for GiraffeRace contract
 * @dev Example:
 *      yarn deploy --file DeployGiraffeRace.s.sol  # local anvil chain
 *
 * Environment variables:
 *   TREASURY_OWNER   - Controls treasury withdrawals AND owns house NFTs.
 *                      Should be a multisig in production.
 *   USDC_ADDRESS     - USDC contract address. If not set, deploys MockUSDC (local testing only).
 */
contract DeployGiraffeRace is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // Treasury owner: controls treasury AND owns house NFTs.
        // In production, this should be a multisig (e.g., Gnosis Safe).
        address treasuryOwner = vm.envOr("TREASURY_OWNER", address(0x668887c62AF23E42aB10105CB4124CF2C656F331));

        // USDC address - if not set, deploy MockUSDC for local testing.
        address usdcAddress = vm.envOr("USDC_ADDRESS", address(0));

        // Deploy MockUSDC if needed (local testing)
        MockUSDC mockUsdc;
        if (usdcAddress == address(0)) {
            mockUsdc = new MockUSDC();
            usdcAddress = address(mockUsdc);
            
            // Mint some test USDC to treasury owner for initial bankroll
            mockUsdc.mint(treasuryOwner, 100_000 * 1e6); // 100k USDC
        }

        // Get the deployer address (the account running this script)
        (, address deployer,) = vm.readCallers();

        // Deploy Treasury with DEPLOYER as initial owner (so we can authorize the race contract)
        // Ownership will be transferred to treasuryOwner at the end.
        HouseTreasury treasury = new HouseTreasury(usdcAddress, deployer);

        // Deploy the GiraffeNFT collection
        GiraffeNFT giraffeNft = new GiraffeNFT();
        GiraffeRaceSimulator simulator = new GiraffeRaceSimulator();

        // Deploy the WinProbTable contracts (6 shards + router)
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

        // Mint the initial "house giraffes" to treasuryOwner (the multisig)
        uint256[6] memory houseTokenIds;
        houseTokenIds[0] = giraffeNft.mintTo(treasuryOwner, "house-1");
        houseTokenIds[1] = giraffeNft.mintTo(treasuryOwner, "house-2");
        houseTokenIds[2] = giraffeNft.mintTo(treasuryOwner, "house-3");
        houseTokenIds[3] = giraffeNft.mintTo(treasuryOwner, "house-4");
        houseTokenIds[4] = giraffeNft.mintTo(treasuryOwner, "house-5");
        houseTokenIds[5] = giraffeNft.mintTo(treasuryOwner, "house-6");

        // Deploy the race contract with treasury and win probability table
        GiraffeRace race = new GiraffeRace(
            address(giraffeNft),
            treasuryOwner,  // treasuryOwner: owns house NFTs (multisig)
            houseTokenIds,
            address(simulator),
            address(treasury),
            address(winProbTable)  // on-chain probability table for odds
        );

        // Authorize race contract to collect bets and pay winners (we're still owner at this point)
        treasury.authorize(address(race));

        // Transfer treasury ownership to the actual treasuryOwner (multisig)
        treasury.transferOwnership(treasuryOwner);

        // Allow the race contract to update readiness after races.
        giraffeNft.setRaceContract(address(race));

        // Configure mint fee: 1 USDC goes to treasury
        giraffeNft.setTreasury(usdcAddress, address(treasury));
    }
}
