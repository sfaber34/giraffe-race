// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC20 } from "../lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Simple mock USDC for local testing (6 decimals like real USDC).
 * @dev Anyone can mint - ONLY FOR TESTING.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint tokens to any address (testing only).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Mint tokens to yourself (testing convenience).
    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
