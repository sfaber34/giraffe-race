//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { RaffeRace } from "../contracts/RaffeRaceV2.sol";
import { RaffeNFT } from "../contracts/RaffeNFT.sol";
import { RaffeRaceSimulator } from "../contracts/RaffeRaceSimulator.sol";
import { HouseTreasury } from "../contracts/HouseTreasury.sol";
import { MockUSDC } from "../contracts/MockUSDC.sol";

/**
 * @title DeployScript
 * @notice Deployment script for RaffeRace (simplified non-Diamond version)
 * @dev Integrated with Scaffold-ETH 2 deployment system
 *
 * Environment variables:
 *   TREASURY_OWNER   - Controls treasury withdrawals AND owns house NFTs.
 *                      Should be a multisig in production.
 *   RACE_BOT         - Address that can call setOdds() to set race odds.
 *   USDC_ADDRESS     - USDC contract address. If not set, deploys MockUSDC (local testing only).
 *
 * Network-specific defaults:
 *   - Base Mainnet (8453): Uses native USDC at 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   - Base Sepolia (84532): Uses USDC at 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *   - Local (31337): Deploys MockUSDC
 */
contract DeployScript is ScaffoldETHDeploy {
    // Known USDC addresses
    address constant BASE_MAINNET_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    
    // Production treasury owner (multisig)
    address constant PRODUCTION_TREASURY_OWNER = 0x6935d26Ba98b86e07Bedf4FFBded0eA8a9eDD5Fb;
    
    // Production race bot (odds setter)
    address constant PRODUCTION_RACE_BOT = 0xbA7106581320DCCF42189682EF35ab523f4D97D1;

    function run() external ScaffoldEthDeployerRunner {
        // Treasury owner: controls treasury AND owns house NFTs.
        // Race bot: only address that can call setOdds().
        // Use the same addresses for all deployments (local and production).
        address treasuryOwner = vm.envOr("TREASURY_OWNER", PRODUCTION_TREASURY_OWNER);
        address raceBotAddress = vm.envOr("RACE_BOT", PRODUCTION_RACE_BOT);

        // USDC address - use network-specific defaults or env override.
        address usdcAddress = vm.envOr("USDC_ADDRESS", address(0));
        
        // If no env override, use network-specific defaults
        if (usdcAddress == address(0)) {
            if (block.chainid == 8453) {
                usdcAddress = BASE_MAINNET_USDC;
                console.log("Using Base Mainnet USDC:", usdcAddress);
            } else if (block.chainid == 84532) {
                usdcAddress = BASE_SEPOLIA_USDC;
                console.log("Using Base Sepolia USDC:", usdcAddress);
            }
        }

        // 1. Deploy supporting contracts
        MockUSDC mockUsdc;
        if (usdcAddress == address(0)) {
            mockUsdc = new MockUSDC();
            usdcAddress = address(mockUsdc);
            // Mint some test USDC to treasury owner for initial bankroll
            mockUsdc.mint(treasuryOwner, 100_000 * 1e6); // 100k USDC
            console.log("MockUSDC deployed at:", usdcAddress);
            deployments.push(Deployment("MockUSDC", usdcAddress));
        }

        RaffeNFT raffeNft = new RaffeNFT();
        console.log("RaffeNFT deployed at:", address(raffeNft));
        deployments.push(Deployment("RaffeNFT", address(raffeNft)));

        RaffeRaceSimulator simulator = new RaffeRaceSimulator();
        console.log("RaffeRaceSimulator deployed at:", address(simulator));
        deployments.push(Deployment("RaffeRaceSimulator", address(simulator)));

        // Deploy Treasury with deployer as initial owner (so we can authorize the race contract)
        // Ownership will be transferred to treasuryOwner at the end.
        HouseTreasury treasury = new HouseTreasury(usdcAddress, deployer);
        console.log("HouseTreasury deployed at:", address(treasury));
        deployments.push(Deployment("HouseTreasury", address(treasury)));

        // 2. Mint house raffes to treasuryOwner
        uint256[6] memory houseRaffeTokenIds;
        houseRaffeTokenIds[0] = raffeNft.mintTo(treasuryOwner, "house-1");
        houseRaffeTokenIds[1] = raffeNft.mintTo(treasuryOwner, "house-2");
        houseRaffeTokenIds[2] = raffeNft.mintTo(treasuryOwner, "house-3");
        houseRaffeTokenIds[3] = raffeNft.mintTo(treasuryOwner, "house-4");
        houseRaffeTokenIds[4] = raffeNft.mintTo(treasuryOwner, "house-5");
        houseRaffeTokenIds[5] = raffeNft.mintTo(treasuryOwner, "house-6");
        console.log("Minted 6 house raffes to treasuryOwner");

        // 3. Deploy RaffeRace (single contract - no Diamond)
        RaffeRace raffeRace = new RaffeRace(
            address(raffeNft),
            treasuryOwner,
            raceBotAddress,
            houseRaffeTokenIds,
            address(simulator),
            address(treasury)
        );
        console.log("RaffeRace deployed at:", address(raffeRace));
        deployments.push(Deployment("RaffeRace", address(raffeRace)));

        // 4. Authorize RaffeRace in treasury and set as liability tracker
        treasury.authorize(address(raffeRace));
        treasury.setLiabilityTracker(address(raffeRace));
        console.log("RaffeRace authorized in treasury and set as liability tracker");

        // 5. Transfer treasury ownership to the actual treasuryOwner (multisig)
        if (treasuryOwner != deployer) {
            treasury.transferOwnership(treasuryOwner);
            console.log("Treasury ownership transferred to:", treasuryOwner);
        }

        // 6. Configure RaffeNFT
        raffeNft.setRaceContract(address(raffeRace));
        raffeNft.setTreasury(usdcAddress, address(treasury));
        console.log("RaffeNFT configured with race contract and treasury");

        // 7. Transfer RaffeNFT ownership to treasuryOwner
        raffeNft.transferOwnership(treasuryOwner);
        console.log("RaffeNFT ownership transferred to:", treasuryOwner);

        console.log("\n=== Deployment Summary ===");
        console.log("RaffeRace:          ", address(raffeRace));
        console.log("USDC:                 ", usdcAddress);
        console.log("RaffeNFT:           ", address(raffeNft));
        console.log("Treasury:             ", address(treasury));
        console.log("Simulator:            ", address(simulator));
        console.log("Treasury Owner:       ", treasuryOwner);
        console.log("Race Bot:             ", raceBotAddress);
    }
}
