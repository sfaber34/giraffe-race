// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "../lib/openzeppelin-contracts/contracts/access/Ownable.sol";

/**
 * @title AnimalNFT
 * @notice Minimal ERC-721 for race animals.
 * @dev Token IDs are sequential starting at 1.
 */
contract AnimalNFT is ERC721, Ownable {
    uint256 public nextTokenId = 1;
    mapping(uint256 => string) private _animalNames;
    // Readiness is a simple 1-10 attribute that affects race performance.
    // New mints start at 10 and decrease by 1 (floored at 1) after running a race.
    mapping(uint256 => uint8) private _readiness; // 0 = legacy/uninitialized (treated as 10)
    address public raceContract;

    // Owner index (lightweight "enumerable" for UX/testing):
    // - Allows the frontend to list all tokenIds owned by an address without brute-forcing `ownerOf`.
    // - Maintained on mint + transfer.
    mapping(address => uint256[]) private _ownedTokens;
    mapping(uint256 => uint256) private _ownedTokensIndex; // tokenId => index in _ownedTokens[owner]

    constructor() ERC721("Animal", "ANML") Ownable(msg.sender) {}

    modifier onlyRace() {
        require(msg.sender == raceContract, "AnimalNFT: not race");
        _;
    }

    function setRaceContract(address _race) external onlyOwner {
        raceContract = _race;
    }

    function readinessOf(uint256 tokenId) external view returns (uint8) {
        require(_ownerOf(tokenId) != address(0), "AnimalNFT: nonexistent token");
        uint8 r = _readiness[tokenId];
        if (r == 0) return 10;
        return r;
    }

    /// @notice Decrease readiness after an NFT runs a race (floored at 1).
    /// @dev Callable only by the configured `raceContract`.
    function decreaseReadiness(uint256 tokenId) external onlyRace {
        require(_ownerOf(tokenId) != address(0), "AnimalNFT: nonexistent token");
        uint8 r = _readiness[tokenId];
        if (r == 0) r = 10;
        if (r > 1) {
            unchecked {
                r -= 1;
            }
        }
        _readiness[tokenId] = r;
    }

    function _mintAnimal(address to, string memory animalName) internal returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        if (bytes(animalName).length != 0) {
            _animalNames[tokenId] = animalName;
        }
        _readiness[tokenId] = 10;
        _safeMint(to, tokenId);
    }

    /// @notice Mint an AnimalNFT to an arbitrary address (permissionless).
    function mint(address to) external returns (uint256 tokenId) {
        return _mintAnimal(to, "");
    }

    /// @notice Mint an AnimalNFT with a name to an arbitrary address (permissionless).
    function mint(address to, string calldata animalName) external returns (uint256 tokenId) {
        return _mintAnimal(to, animalName);
    }

    /// @notice Convenience: mint to yourself with a name.
    function mint(string calldata animalName) external returns (uint256 tokenId) {
        return _mintAnimal(msg.sender, animalName);
    }

    function nameOf(uint256 tokenId) external view returns (string memory) {
        return _animalNames[tokenId];
    }

    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);

        // Remove from previous owner (transfers + burns)
        if (from != address(0)) {
            uint256 lastIndex = _ownedTokens[from].length - 1;
            uint256 tokenIndex = _ownedTokensIndex[tokenId];
            if (tokenIndex != lastIndex) {
                uint256 lastTokenId = _ownedTokens[from][lastIndex];
                _ownedTokens[from][tokenIndex] = lastTokenId;
                _ownedTokensIndex[lastTokenId] = tokenIndex;
            }
            _ownedTokens[from].pop();
        }

        // Add to new owner (transfers + mints)
        if (to != address(0)) {
            _ownedTokensIndex[tokenId] = _ownedTokens[to].length;
            _ownedTokens[to].push(tokenId);
        }
    }
}

