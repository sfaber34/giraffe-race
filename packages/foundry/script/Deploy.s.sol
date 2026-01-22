//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { DeployDiamond } from "./DeployDiamond.s.sol";

/**
 * @notice Main deployment script for all contracts
 * @dev Run this when you want to deploy multiple contracts at once
 *
 * Example: yarn deploy # runs this script(without`--file` flag)
 *
 * This script inherits from DeployDiamond to deploy the GiraffeRace Diamond.
 * The run() function is inherited from DeployDiamond.
 */
contract DeployScript is DeployDiamond {
    // Inherits run() from DeployDiamond which uses ScaffoldEthDeployerRunner modifier
}
