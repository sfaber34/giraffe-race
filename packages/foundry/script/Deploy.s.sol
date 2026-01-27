//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { GiraffeRace } from "../contracts/GiraffeRaceV2.sol";
import { GiraffeNFT } from "../contracts/GiraffeNFT.sol";
import { GiraffeRaceSimulator } from "../contracts/GiraffeRaceSimulator.sol";
import { HouseTreasury } from "../contracts/HouseTreasury.sol";
import { MockUSDC } from "../contracts/MockUSDC.sol";

/**
 * @title DeployScript
 * @notice Deployment script for GiraffeRace (simplified non-Diamond version)
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

        GiraffeNFT giraffeNft = new GiraffeNFT();
        console.log("GiraffeNFT deployed at:", address(giraffeNft));
        deployments.push(Deployment("GiraffeNFT", address(giraffeNft)));

        GiraffeRaceSimulator simulator = new GiraffeRaceSimulator();
        console.log("GiraffeRaceSimulator deployed at:", address(simulator));
        deployments.push(Deployment("GiraffeRaceSimulator", address(simulator)));

        // Deploy Treasury with deployer as initial owner (so we can authorize the race contract)
        // Ownership will be transferred to treasuryOwner at the end.
        HouseTreasury treasury = new HouseTreasury(usdcAddress, deployer);
        console.log("HouseTreasury deployed at:", address(treasury));
        deployments.push(Deployment("HouseTreasury", address(treasury)));

        // 2. Mint house giraffes to treasuryOwner
        uint256[6] memory houseGiraffeTokenIds;
        houseGiraffeTokenIds[0] = giraffeNft.mintTo(treasuryOwner, "house-1");
        houseGiraffeTokenIds[1] = giraffeNft.mintTo(treasuryOwner, "house-2");
        houseGiraffeTokenIds[2] = giraffeNft.mintTo(treasuryOwner, "house-3");
        houseGiraffeTokenIds[3] = giraffeNft.mintTo(treasuryOwner, "house-4");
        houseGiraffeTokenIds[4] = giraffeNft.mintTo(treasuryOwner, "house-5");
        houseGiraffeTokenIds[5] = giraffeNft.mintTo(treasuryOwner, "house-6");
        console.log("Minted 6 house giraffes to treasuryOwner");

        // 3. Deploy GiraffeRace (single contract - no Diamond)
        GiraffeRace giraffeRace = new GiraffeRace(
            address(giraffeNft),
            treasuryOwner,
            raceBotAddress,
            houseGiraffeTokenIds,
            address(simulator),
            address(treasury)
        );
        console.log("GiraffeRace deployed at:", address(giraffeRace));
        deployments.push(Deployment("GiraffeRace", address(giraffeRace)));

        // 4. Authorize GiraffeRace in treasury
        treasury.authorize(address(giraffeRace));
        console.log("GiraffeRace authorized in treasury");

        // 5. Transfer treasury ownership to the actual treasuryOwner (multisig)
        if (treasuryOwner != deployer) {
            treasury.transferOwnership(treasuryOwner);
            console.log("Treasury ownership transferred to:", treasuryOwner);
        }

        // 6. Configure GiraffeNFT
        giraffeNft.setRaceContract(address(giraffeRace));
        giraffeNft.setTreasury(usdcAddress, address(treasury));
        console.log("GiraffeNFT configured with race contract and treasury");

        // 7. Transfer GiraffeNFT ownership to treasuryOwner
        giraffeNft.transferOwnership(treasuryOwner);
        console.log("GiraffeNFT ownership transferred to:", treasuryOwner);

        console.log("\n=== Deployment Summary ===");
        console.log("GiraffeRace:          ", address(giraffeRace));
        console.log("USDC:                 ", usdcAddress);
        console.log("GiraffeNFT:           ", address(giraffeNft));
        console.log("Treasury:             ", address(treasury));
        console.log("Simulator:            ", address(simulator));
        console.log("Treasury Owner:       ", treasuryOwner);
        console.log("Race Bot:             ", raceBotAddress);
    }
}
