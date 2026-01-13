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
        // For local testing, it's often useful to have a stable "owner" address regardless of which account deploys.
        // You can override this by setting `ANIMAL_RACE_OWNER` in your env.
        address ownerForGame = vm.envOr("ANIMAL_RACE_OWNER", address(0x668887c62AF23E42aB10105CB4124CF2C656F331));
        address houseForGame = ownerForGame;

        // Deploy the AnimalNFT collection (permissionless mint).
        // We'll mint the initial "house animals" to `houseForGame`.
        AnimalNFT animalNft = new AnimalNFT();

        uint256[4] memory houseTokenIds;
        houseTokenIds[0] = animalNft.mint(houseForGame, "foo");
        houseTokenIds[1] = animalNft.mint(houseForGame, "bar");
        houseTokenIds[2] = animalNft.mint(houseForGame, "bok");
        houseTokenIds[3] = animalNft.mint(houseForGame, "chow");

        // Deploy the race contract with the NFT + house configuration.
        new AnimalRace(ownerForGame, address(animalNft), houseForGame, houseTokenIds);
    }
}

