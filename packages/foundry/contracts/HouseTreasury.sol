// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title HouseTreasury
 * @notice Centralized treasury for the giraffe race betting platform.
 * @dev Holds USDC bankroll and allows authorized contracts (race contracts) to:
 *      - Collect bets from users
 *      - Pay winners
 *      Only the multisig owner can authorize/deauthorize contracts and withdraw profits.
 */
contract HouseTreasury {
    IERC20 public immutable usdc;
    address public owner; // Multisig

    // Contracts authorized to collect bets and pay winners
    mapping(address => bool) public authorizedContracts;

    // Emergency pause - stops all payouts
    bool public paused;

    event ContractAuthorized(address indexed contractAddr);
    event ContractDeauthorized(address indexed contractAddr);
    event BetCollected(address indexed from, uint256 amount, address indexed collector);
    event WinnerPaid(address indexed to, uint256 amount, address indexed payer);
    event Withdrawn(address indexed to, uint256 amount);
    event Deposited(address indexed from, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    error NotOwner();
    error NotAuthorized();
    error IsPaused();
    error TransferFailed();
    error ZeroAddress();
    error ZeroAmount();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorized() {
        if (!authorizedContracts[msg.sender]) revert NotAuthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(address _usdc, address _owner) {
        if (_usdc == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        owner = _owner;
    }

    // ============ Owner Functions ============

    /// @notice Authorize a contract (e.g., GiraffeRace) to collect bets and pay winners.
    function authorize(address contractAddr) external onlyOwner {
        if (contractAddr == address(0)) revert ZeroAddress();
        authorizedContracts[contractAddr] = true;
        emit ContractAuthorized(contractAddr);
    }

    /// @notice Deauthorize a contract (emergency or deprecation).
    function deauthorize(address contractAddr) external onlyOwner {
        authorizedContracts[contractAddr] = false;
        emit ContractDeauthorized(contractAddr);
    }

    /// @notice Transfer ownership to a new multisig.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /// @notice Emergency pause - stops all payouts.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause - resume normal operations.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Withdraw USDC to owner (for profit extraction or emergency).
    function withdraw(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        bool success = usdc.transfer(owner, amount);
        if (!success) revert TransferFailed();
        emit Withdrawn(owner, amount);
    }

    /// @notice Withdraw all USDC to owner.
    function withdrawAll() external onlyOwner {
        uint256 bal = usdc.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        bool success = usdc.transfer(owner, bal);
        if (!success) revert TransferFailed();
        emit Withdrawn(owner, bal);
    }

    // ============ Authorized Contract Functions ============

    /// @notice Collect a bet from a user. Called by authorized race contracts.
    /// @dev User must have approved this treasury contract to spend their USDC.
    function collectBet(address from, uint256 amount) external onlyAuthorized whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        bool success = usdc.transferFrom(from, address(this), amount);
        if (!success) revert TransferFailed();
        emit BetCollected(from, amount, msg.sender);
    }

    /// @notice Pay a winner. Called by authorized race contracts.
    function payWinner(address to, uint256 amount) external onlyAuthorized whenNotPaused {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        bool success = usdc.transfer(to, amount);
        if (!success) revert TransferFailed();
        emit WinnerPaid(to, amount, msg.sender);
    }

    // ============ Public Functions ============

    /// @notice Deposit USDC into the treasury (anyone can fund it).
    /// @dev Caller must have approved this treasury contract.
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        bool success = usdc.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();
        emit Deposited(msg.sender, amount);
    }

    /// @notice Check the treasury balance.
    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
