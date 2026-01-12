// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/AnimalRace.sol";

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
        new AnimalRace(ownerForGame);
    }
}

