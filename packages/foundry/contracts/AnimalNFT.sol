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

    constructor(address initialOwner) ERC721("Animal", "ANML") Ownable(initialOwner) {}

    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
    }

    function mint(address to, string calldata animalName) external onlyOwner returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _animalNames[tokenId] = animalName;
        _safeMint(to, tokenId);
    }

    function nameOf(uint256 tokenId) external view returns (string memory) {
        return _animalNames[tokenId];
    }
}

