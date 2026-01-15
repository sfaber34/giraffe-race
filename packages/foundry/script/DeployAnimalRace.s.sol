// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/AnimalRace.sol";
import "../contracts/AnimalNFT.sol";

/**
 * @notice Deploy script for AnimalRace contract
 * @dev Example:
 *      yarn deploy --file DeployAnimalRace.s.sol  # local anvil chain
 */
contract DeployAnimalRace is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // House address: owns the 4 house animals used to fill empty lanes.
        // You can override this by setting `ANIMAL_RACE_HOUSE` in your env.
        address houseForGame = vm.envOr("ANIMAL_RACE_HOUSE", address(0x668887c62AF23E42aB10105CB4124CF2C656F331));

        // Deploy the AnimalNFT collection (permissionless mint).
        // We'll mint the initial "house animals" to `houseForGame`.
        AnimalNFT animalNft = new AnimalNFT();

        uint256[4] memory houseTokenIds;
        houseTokenIds[0] = animalNft.mint(houseForGame, "house-1");
        houseTokenIds[1] = animalNft.mint(houseForGame, "house-2");
        houseTokenIds[2] = animalNft.mint(houseForGame, "house-3");
        houseTokenIds[3] = animalNft.mint(houseForGame, "house-4");

        // Deploy the race contract with the NFT + house configuration.
        new AnimalRace(address(animalNft), houseForGame, houseTokenIds);
    }
}

