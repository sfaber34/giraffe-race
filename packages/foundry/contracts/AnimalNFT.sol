// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";

/**
 * @title AnimalNFT
 * @notice Minimal ERC-721 for race animals.
 * @dev Token IDs are sequential starting at 1.
 */
contract AnimalNFT is ERC721 {
    uint256 public nextTokenId = 1;
    mapping(uint256 => string) private _animalNames;

    constructor() ERC721("Animal", "ANML") {}

    /// @notice Mint an AnimalNFT to an arbitrary address (permissionless).
    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
    }

    /// @notice Mint an AnimalNFT with a name to an arbitrary address (permissionless).
    function mint(address to, string calldata animalName) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _animalNames[tokenId] = animalName;
        _safeMint(to, tokenId);
    }

    /// @notice Convenience: mint to yourself with a name.
    function mint(string calldata animalName) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _animalNames[tokenId] = animalName;
        _safeMint(msg.sender, tokenId);
    }

    function nameOf(uint256 tokenId) external view returns (string memory) {
        return _animalNames[tokenId];
    }
}

