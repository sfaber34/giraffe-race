// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/GiraffeRace.sol";
import "../contracts/GiraffeRaceSimulator.sol";
import "../contracts/GiraffeNFT.sol";
import "../contracts/HouseTreasury.sol";
import "../contracts/MockUSDC.sol";

/**
 * @notice Deploy script for GiraffeRace contract
 * @dev Example:
 *      yarn deploy --file DeployGiraffeRace.s.sol  # local anvil chain
 *
 * Environment variables:
 *   TREASURY_OWNER   - Controls treasury withdrawals AND owns house NFTs.
 *                      Should be a multisig in production.
 *   ODDS_ADMIN       - Can set race odds. Can be a hot wallet for frequent operations.
 *                      Defaults to TREASURY_OWNER for local testing.
 *   USDC_ADDRESS     - USDC contract address. If not set, deploys MockUSDC (local testing only).
 *   WIN_PROB_TABLE   - Address of the deployed WinProbTable6 contract. If not set, 
 *                      uses fallback fixed odds (for local testing without generating the table).
 */
contract DeployGiraffeRace is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // Treasury owner: controls treasury AND owns house NFTs.
        // In production, this should be a multisig (e.g., Gnosis Safe).
        address treasuryOwner = vm.envOr("TREASURY_OWNER", address(0x668887c62AF23E42aB10105CB4124CF2C656F331));
        
        // Odds admin: can set race odds (can be a hot wallet for frequent operations).
        // Defaults to treasuryOwner for local testing simplicity.
        address oddsAdmin = vm.envOr("ODDS_ADMIN", treasuryOwner);

        // USDC address - if not set, deploy MockUSDC for local testing.
        address usdcAddress = vm.envOr("USDC_ADDRESS", address(0));

        // WinProbTable6 address - if not set, uses fallback fixed odds.
        // To use the probability table, first deploy WinProbTable6 (and its shards), then pass the address here.
        address winProbTable = vm.envOr("WIN_PROB_TABLE", address(0));

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

        // Mint the initial "house giraffes" to treasuryOwner (the multisig)
        uint256[6] memory houseTokenIds;
        houseTokenIds[0] = giraffeNft.mintTo(treasuryOwner, "house-1");
        houseTokenIds[1] = giraffeNft.mintTo(treasuryOwner, "house-2");
        houseTokenIds[2] = giraffeNft.mintTo(treasuryOwner, "house-3");
        houseTokenIds[3] = giraffeNft.mintTo(treasuryOwner, "house-4");
        houseTokenIds[4] = giraffeNft.mintTo(treasuryOwner, "house-5");
        houseTokenIds[5] = giraffeNft.mintTo(treasuryOwner, "house-6");

        // Deploy the race contract with treasury
        GiraffeRace race = new GiraffeRace(
            address(giraffeNft),
            treasuryOwner,  // house: owns house NFTs (multisig)
            oddsAdmin,      // oddsAdmin: can set odds (hot wallet)
            houseTokenIds,
            address(simulator),
            address(treasury),
            winProbTable    // probability table for odds (address(0) = fallback to fixed odds)
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
