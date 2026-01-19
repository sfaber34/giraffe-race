// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "../lib/openzeppelin-contracts/contracts/access/Ownable.sol";

/**
 * @title GiraffeNFT
 * @notice Minimal ERC-721 for race giraffes.
 * @dev Token IDs are sequential starting at 1.
 */
contract GiraffeNFT is ERC721, Ownable {
    uint256 public nextTokenId = 1;
    mapping(uint256 => string) private _giraffeNames;
    // Readiness is a simple 1-10 attribute that affects race performance.
    // New mints start at 10 and decrease by 1 (floored at 1) after running a race.
    mapping(uint256 => uint8) private _readiness; // 0 = legacy/uninitialized (treated as 10)
    // Additional 1-10 attributes that affect race performance (equally weighted with readiness).
    // 0 = legacy/uninitialized (treated as 10)
    mapping(uint256 => uint8) private _conditioning;
    mapping(uint256 => uint8) private _speed;
    address public raceContract;

    // Owner index (lightweight "enumerable" for UX/testing):
    // - Allows the frontend to list all tokenIds owned by an address without brute-forcing `ownerOf`.
    // - Maintained on mint + transfer.
    mapping(address => uint256[]) private _ownedTokens;
    mapping(uint256 => uint256) private _ownedTokensIndex; // tokenId => index in _ownedTokens[owner]

    constructor() ERC721("Giraffe", "GRF") Ownable(msg.sender) {}

    modifier onlyRace() {
        require(msg.sender == raceContract, "GiraffeNFT: not race");
        _;
    }

    modifier onlyLocalTesting() {
        // Allow anyone to use testing helpers on anvil/hardhat local chain.
        require(block.chainid == 31337, "GiraffeNFT: local testing only");
        _;
    }

    function setRaceContract(address _race) external onlyOwner {
        raceContract = _race;
    }

    function _clampStat(uint8 stat) internal pure returns (uint8) {
        uint8 s = stat;
        if (s == 0) s = 10;
        if (s > 10) s = 10;
        if (s < 1) s = 1;
        return s;
    }

    function readinessOf(uint256 tokenId) external view returns (uint8) {
        require(_ownerOf(tokenId) != address(0), "GiraffeNFT: nonexistent token");
        return _clampStat(_readiness[tokenId]);
    }

    function conditioningOf(uint256 tokenId) external view returns (uint8) {
        require(_ownerOf(tokenId) != address(0), "GiraffeNFT: nonexistent token");
        return _clampStat(_conditioning[tokenId]);
    }

    function speedOf(uint256 tokenId) external view returns (uint8) {
        require(_ownerOf(tokenId) != address(0), "GiraffeNFT: nonexistent token");
        return _clampStat(_speed[tokenId]);
    }

    function statsOf(uint256 tokenId) external view returns (uint8 readiness, uint8 conditioning, uint8 speed) {
        require(_ownerOf(tokenId) != address(0), "GiraffeNFT: nonexistent token");
        readiness = _clampStat(_readiness[tokenId]);
        conditioning = _clampStat(_conditioning[tokenId]);
        speed = _clampStat(_speed[tokenId]);
    }

    /// @notice Decrease readiness after an NFT runs a race (floored at 1).
    /// @dev Callable only by the configured `raceContract`.
    function decreaseReadiness(uint256 tokenId) external onlyRace {
        require(_ownerOf(tokenId) != address(0), "GiraffeNFT: nonexistent token");
        uint8 r = _clampStat(_readiness[tokenId]);
        if (r > 1) {
            unchecked {
                r -= 1;
            }
        }
        _readiness[tokenId] = r;
    }

    function _mintGiraffe(address to, string memory giraffeName, uint8 readiness) internal returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        if (bytes(giraffeName).length != 0) {
            _giraffeNames[tokenId] = giraffeName;
        }
        // All stats are [1..10] (0 treated as 10 for backwards compatibility).
        // New mints should be full stats (10), but we keep an explicit readiness parameter for local testing.
        _readiness[tokenId] = _clampStat(readiness);
        _conditioning[tokenId] = 10;
        _speed[tokenId] = 10;
        _safeMint(to, tokenId);
    }

    /// @notice Mint an GiraffeNFT to an arbitrary address (permissionless).
    function mint(address to) external returns (uint256 tokenId) {
        return _mintGiraffe(to, "", 10);
    }

    /// @notice Mint an GiraffeNFT with a name to an arbitrary address (permissionless).
    function mint(address to, string calldata giraffeName) external returns (uint256 tokenId) {
        return _mintGiraffe(to, giraffeName, 10);
    }

    /// @notice Convenience: mint to yourself with a name.
    function mint(string calldata giraffeName) external returns (uint256 tokenId) {
        return _mintGiraffe(msg.sender, giraffeName, 10);
    }

    /// @notice Mint an GiraffeNFT with an explicit readiness (testing helper).
    /// @dev Permissionless on local chain only (chainid 31337).
    function mintWithReadiness(address to, uint8 readiness, string calldata giraffeName)
        external
        onlyLocalTesting
        returns (uint256 tokenId)
    {
        return _mintGiraffe(to, giraffeName, readiness);
    }

    /// @notice Permissionless local testing helper to set readiness directly on an existing token.
    function setReadinessForTesting(uint256 tokenId, uint8 readiness) external onlyLocalTesting {
        require(_ownerOf(tokenId) != address(0), "GiraffeNFT: nonexistent token");
        _readiness[tokenId] = _clampStat(readiness);
    }

    /// @notice Permissionless local testing helper to set all stats directly on an existing token.
    function setForTesting(uint256 tokenId, uint8 readiness, uint8 conditioning, uint8 speed) external onlyLocalTesting {
        require(_ownerOf(tokenId) != address(0), "GiraffeNFT: nonexistent token");
        _readiness[tokenId] = _clampStat(readiness);
        _conditioning[tokenId] = _clampStat(conditioning);
        _speed[tokenId] = _clampStat(speed);
    }

    function nameOf(uint256 tokenId) external view returns (string memory) {
        return _giraffeNames[tokenId];
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

