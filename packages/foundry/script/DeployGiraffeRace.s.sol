// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/GiraffeRace.sol";
import "../contracts/GiraffeRaceSimulator.sol";
import "../contracts/GiraffeNFT.sol";
import "../contracts/libraries/WinProbTable.sol";

/**
 * @notice Deploy script for GiraffeRace contract
 * @dev Example:
 *      yarn deploy --file DeployGiraffeRace.s.sol  # local anvil chain
 */
contract DeployGiraffeRace is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // House address: owns the house giraffes used to fill empty lanes.
        // You can override this by setting `GIRAFFE_RACE_HOUSE` in your env.
        address houseForGame = vm.envOr("GIRAFFE_RACE_HOUSE", address(0x668887c62AF23E42aB10105CB4124CF2C656F331));

        // Deploy the GiraffeNFT collection (permissionless mint).
        // We'll mint the initial "house giraffes" to `houseForGame`.
        GiraffeNFT giraffeNft = new GiraffeNFT();
        WinProbTable table = new WinProbTable();
        GiraffeRaceSimulator simulator = new GiraffeRaceSimulator();

        uint256[6] memory houseTokenIds;
        houseTokenIds[0] = giraffeNft.mint(houseForGame, "house-1");
        houseTokenIds[1] = giraffeNft.mint(houseForGame, "house-2");
        houseTokenIds[2] = giraffeNft.mint(houseForGame, "house-3");
        houseTokenIds[3] = giraffeNft.mint(houseForGame, "house-4");
        houseTokenIds[4] = giraffeNft.mint(houseForGame, "house-5");
        houseTokenIds[5] = giraffeNft.mint(houseForGame, "house-6");

        // Deploy the race contract with the NFT + house configuration.
        GiraffeRace race = new GiraffeRace(address(giraffeNft), houseForGame, houseTokenIds, address(table), address(simulator));

        // Allow the race contract to update readiness after races.
        giraffeNft.setRaceContract(address(race));
    }
}

