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

    // Owner index (lightweight "enumerable" for UX/testing):
    // - Allows the frontend to list all tokenIds owned by an address without brute-forcing `ownerOf`.
    // - Maintained on mint + transfer.
    mapping(address => uint256[]) private _ownedTokens;
    mapping(uint256 => uint256) private _ownedTokensIndex; // tokenId => index in _ownedTokens[owner]

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

