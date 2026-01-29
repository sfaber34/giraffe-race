// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "../lib/openzeppelin-contracts/contracts/access/Ownable.sol";
import { IERC20 } from "../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title RaffeNFT
 * @notice Minimal ERC-721 for race raffes with commit-reveal minting.
 * @dev Token IDs are sequential starting at 1.
 *      Uses commit-reveal pattern to prevent seed gaming.
 *      Minting costs 1 USDC which goes to the treasury.
 */
contract RaffeNFT is ERC721, Ownable {
    uint256 public nextTokenId = 1;
    /// @notice Base token URI used by OZ's ERC721 `tokenURI`.
    /// @dev Set this to your Next.js route, e.g. "https://yourdomain.com/api/nft/".
    string public baseTokenURI;

    /// @notice USDC token address for mint fees.
    IERC20 public usdc;
    /// @notice Treasury address where mint fees are sent.
    address public treasury;
    /// @notice Mint fee in USDC (1 USDC = 1e6 with 6 decimals).
    uint256 public constant MINT_FEE = 1e6;

    mapping(uint256 => string) private _raffeNames;
    mapping(uint256 => bytes32) private _seeds;
    // Name collision protection: track which name hashes are used
    mapping(bytes32 => bool) private _usedNames; // nameHash => isUsed
    // Zip is a simple 1-10 attribute that affects race performance.
    mapping(uint256 => uint8) private _zip; // 0 = legacy/uninitialized (treated as 10)
    // Additional 1-10 attributes that affect race performance.
    // Race performance uses the equally-weighted average of (zip, moxie, hustle) as an effective score.
    // 0 = legacy/uninitialized (treated as 10)
    mapping(uint256 => uint8) private _moxie;
    mapping(uint256 => uint8) private _hustle;
    address public raceContract;

    // Owner index (lightweight "enumerable" for UX/testing):
    // - Allows the frontend to list all tokenIds owned by an address without brute-forcing `ownerOf`.
    // - Maintained on mint + transfer.
    mapping(address => uint256[]) private _ownedTokens;
    mapping(uint256 => uint256) private _ownedTokensIndex; // tokenId => index in _ownedTokens[owner]

    // ============ Commit-Reveal Minting ============
    
    /// @notice Commit status for mint commits
    enum CommitStatus { 
        Pending,   // Awaiting reveal
        Revealed,  // Successfully revealed and minted
        Cancelled  // Cancelled by user or expired
    }
    
    /// @notice Commit data for commit-reveal minting
    struct MintCommit {
        address minter;
        string name;
        bytes32 commitment; // keccak256(abi.encodePacked(secret))
        uint256 blockNumber;
        CommitStatus status;
    }
    
    /// @notice Mapping of commitId to commit data
    mapping(bytes32 => MintCommit) public mintCommits;
    
    /// @notice Track pending commits per user (for UI listing)
    mapping(address => bytes32[]) private _userCommits;
    
    /// @notice Minimum blocks to wait before revealing (allows blockhash of commit block + 1 to be set)
    uint256 public constant MIN_REVEAL_BLOCKS = 2;
    
    /// @notice Maximum blocks before a commit expires (blockhash only available for 256 blocks)
    uint256 public constant MAX_REVEAL_BLOCKS = 250; // A bit less than 256 to be safe

    event BaseTokenURISet(string baseTokenURI);
    event RaffeMinted(uint256 indexed tokenId, address indexed to, bytes32 seed, string name);
    event MintCommitted(bytes32 indexed commitId, address indexed minter, string name, uint256 blockNumber);
    event MintRevealed(bytes32 indexed commitId, uint256 indexed tokenId, address indexed minter);
    event MintCommitCancelled(bytes32 indexed commitId, address indexed minter);
    event TreasurySet(address indexed usdc, address indexed treasury);

    error NameAlreadyTaken(string name);
    error NameTooLong(uint256 length);
    error EmptyName();
    error NameIsAllWhitespace();
    error CommitNotFound();
    error NotYourCommit();
    error CommitNotPending();
    error TooEarlyToReveal(uint256 currentBlock, uint256 minRevealBlock);
    error CommitExpired(uint256 currentBlock, uint256 expiryBlock);
    error InvalidSecret();
    error BlockhashUnavailable();
    error TreasuryNotSet();
    error MintFeeTransferFailed();

    constructor() ERC721("Raffe", "GRF") Ownable(msg.sender) {}

    modifier onlyRace() {
        require(msg.sender == raceContract, "RaffeNFT: not race");
        _;
    }

    modifier onlyLocalTesting() {
        // Allow anyone to use testing helpers on anvil/hardhat local chain.
        require(block.chainid == 31337, "RaffeNFT: local testing only");
        _;
    }

    function setRaceContract(address _race) external onlyOwner {
        raceContract = _race;
    }

    function setBaseTokenURI(string calldata newBaseTokenURI) external onlyOwner {
        baseTokenURI = newBaseTokenURI;
        emit BaseTokenURISet(newBaseTokenURI);
    }

    /// @notice Set the USDC token and treasury address for mint fees.
    /// @dev Only owner can set this. Required before commit-reveal minting on production.
    function setTreasury(address _usdc, address _treasury) external onlyOwner {
        usdc = IERC20(_usdc);
        treasury = _treasury;
        emit TreasurySet(_usdc, _treasury);
    }

    /// @notice Random seed for a given tokenId (used by off-chain SVG/metadata rendering).
    function seedOf(uint256 tokenId) external view returns (bytes32) {
        require(_ownerOf(tokenId) != address(0), "RaffeNFT: nonexistent token");
        return _seeds[tokenId];
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    function _clampStat(uint8 stat) internal pure returns (uint8) {
        uint8 s = stat;
        if (s == 0) s = 10;
        if (s > 10) s = 10;
        if (s < 1) s = 1;
        return s;
    }

    /// @notice Derive a random stat (1-10) from a seed and salt.
    /// @dev Uses keccak256 to derive independent random values for each stat.
    function _randomStat(bytes32 seed, bytes32 salt) internal pure returns (uint8) {
        uint256 hash = uint256(keccak256(abi.encodePacked(seed, salt)));
        return uint8((hash % 10) + 1); // 1-10
    }

    /// @notice Convert a string to lowercase for case-insensitive name comparison.
    /// @dev Only handles ASCII characters (A-Z -> a-z). Non-ASCII characters are left unchanged.
    function _toLowerCase(string memory str) internal pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint256 i = 0; i < bStr.length; i++) {
            // If uppercase letter (A-Z is 65-90 in ASCII)
            if (bStr[i] >= 0x41 && bStr[i] <= 0x5A) {
                // Convert to lowercase by adding 32
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        return string(bLower);
    }

    /// @notice Check if a string is all whitespace (spaces, tabs, newlines, etc.)
    function _isAllWhitespace(bytes memory nameBytes) internal pure returns (bool) {
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            // Check for common whitespace characters: space (0x20), tab (0x09), newline (0x0A), carriage return (0x0D)
            if (char != 0x20 && char != 0x09 && char != 0x0A && char != 0x0D) {
                return false;
            }
        }
        return true;
    }

    /// @notice Hash a name for collision checking (case-insensitive).
    /// @dev Converts name to lowercase before hashing to ensure case-insensitivity.
    ///      Rejects empty names and names that are all whitespace.
    function _hashName(string memory name) internal pure returns (bytes32) {
        bytes memory nameBytes = bytes(name);
        
        if (nameBytes.length == 0) {
            revert EmptyName();
        }
        if (nameBytes.length > 32) {
            revert NameTooLong(nameBytes.length);
        }
        if (_isAllWhitespace(nameBytes)) {
            revert NameIsAllWhitespace();
        }
        
        // Convert to lowercase for case-insensitive comparison
        string memory lowerName = _toLowerCase(name);
        return keccak256(bytes(lowerName));
    }

    function zipOf(uint256 tokenId) external view returns (uint8) {
        require(_ownerOf(tokenId) != address(0), "RaffeNFT: nonexistent token");
        return _clampStat(_zip[tokenId]);
    }

    function moxieOf(uint256 tokenId) external view returns (uint8) {
        require(_ownerOf(tokenId) != address(0), "RaffeNFT: nonexistent token");
        return _clampStat(_moxie[tokenId]);
    }

    function hustleOf(uint256 tokenId) external view returns (uint8) {
        require(_ownerOf(tokenId) != address(0), "RaffeNFT: nonexistent token");
        return _clampStat(_hustle[tokenId]);
    }

    function statsOf(uint256 tokenId) external view returns (uint8 zip, uint8 moxie, uint8 hustle) {
        require(_ownerOf(tokenId) != address(0), "RaffeNFT: nonexistent token");
        zip = _clampStat(_zip[tokenId]);
        moxie = _clampStat(_moxie[tokenId]);
        hustle = _clampStat(_hustle[tokenId]);
    }

    function _mintRaffe(address to, string memory raffeName) internal returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        
        // Name is required - validate and check for collisions
        bytes32 nameHash = _hashName(raffeName); // Will revert if empty or all whitespace
        
        // Revert if name is already taken (case-insensitive check)
        if (_usedNames[nameHash]) {
            revert NameAlreadyTaken(raffeName);
        }
        
        _raffeNames[tokenId] = raffeName;
        _usedNames[nameHash] = true;
        
        // On-chain entropy seed (gameable for direct mint, but OK for local testing / owner mints).
        // Uses previous blockhash so it's always available.
        bytes32 bh = block.number > 0 ? blockhash(block.number - 1) : bytes32(0);
        bytes32 seed = keccak256(abi.encodePacked(bh, address(this), tokenId, to, "RAFFE_SEED_V1"));
        _seeds[tokenId] = seed;
        // Derive random stats (1-10) from seed
        _zip[tokenId] = _randomStat(seed, "ZIP");
        _moxie[tokenId] = _randomStat(seed, "MOXIE");
        _hustle[tokenId] = _randomStat(seed, "HUSTLE");
        _safeMint(to, tokenId);
        emit RaffeMinted(tokenId, to, seed, raffeName);
    }

    /// @notice Direct mint for local testing only (bypasses commit-reveal).
    /// @dev On production networks, use commitMint + revealMint instead.
    ///      Stats are randomly assigned based on blockhash seed.
    function mint(string calldata raffeName) external onlyLocalTesting returns (uint256 tokenId) {
        return _mintRaffe(msg.sender, raffeName);
    }

    /// @notice Owner-only mint to a specific address (for deployment/house raffes).
    /// @dev Only the contract owner can mint to arbitrary addresses.
    ///      This bypasses commit-reveal since owner is trusted.
    ///      Stats are randomly assigned based on blockhash seed.
    function mintTo(address to, string calldata raffeName) external onlyOwner returns (uint256 tokenId) {
        return _mintRaffe(to, raffeName);
    }

    /// @notice Permissionless local testing helper to set zip directly on an existing token.
    function setZipForTesting(uint256 tokenId, uint8 zip) external onlyLocalTesting {
        require(_ownerOf(tokenId) != address(0), "RaffeNFT: nonexistent token");
        _zip[tokenId] = _clampStat(zip);
    }

    /// @notice Permissionless local testing helper to set all stats directly on an existing token.
    function setForTesting(uint256 tokenId, uint8 zip, uint8 moxie, uint8 hustle) external onlyLocalTesting {
        require(_ownerOf(tokenId) != address(0), "RaffeNFT: nonexistent token");
        _zip[tokenId] = _clampStat(zip);
        _moxie[tokenId] = _clampStat(moxie);
        _hustle[tokenId] = _clampStat(hustle);
    }

    function nameOf(uint256 tokenId) external view returns (string memory) {
        return _raffeNames[tokenId];
    }

    // ============ Commit-Reveal Minting Functions ============

    /// @notice Commit to mint a raffe with a specific name.
    /// @dev Reserves the name immediately. User must call revealMint within MAX_REVEAL_BLOCKS.
    /// @param name The name for the raffe (1-32 characters, case-insensitive uniqueness).
    /// @param commitment keccak256(abi.encodePacked(secret)) where secret is a random bytes32.
    /// @return commitId The unique identifier for this commit.
    function commitMint(string calldata name, bytes32 commitment) external returns (bytes32 commitId) {
        // Validate and reserve name
        bytes32 nameHash = _hashName(name);
        if (_usedNames[nameHash]) {
            revert NameAlreadyTaken(name);
        }
        _usedNames[nameHash] = true;
        
        // Generate unique commitId
        commitId = keccak256(abi.encodePacked(msg.sender, name, commitment, block.number, block.timestamp));
        
        mintCommits[commitId] = MintCommit({
            minter: msg.sender,
            name: name,
            commitment: commitment,
            blockNumber: block.number,
            status: CommitStatus.Pending
        });
        
        _userCommits[msg.sender].push(commitId);
        
        emit MintCommitted(commitId, msg.sender, name, block.number);
    }
    
    /// @notice Reveal the secret and mint the raffe.
    /// @dev Requires 1 USDC mint fee (user must approve this contract first).
    /// @param commitId The commit ID from commitMint.
    /// @param secret The secret that was hashed to create the commitment.
    /// @return tokenId The minted token ID.
    function revealMint(bytes32 commitId, bytes32 secret) external returns (uint256 tokenId) {
        MintCommit storage commit = mintCommits[commitId];
        
        if (commit.minter == address(0)) revert CommitNotFound();
        if (commit.minter != msg.sender) revert NotYourCommit();
        if (commit.status != CommitStatus.Pending) revert CommitNotPending();
        
        uint256 minRevealBlock = commit.blockNumber + MIN_REVEAL_BLOCKS;
        uint256 maxRevealBlock = commit.blockNumber + MAX_REVEAL_BLOCKS;
        
        if (block.number < minRevealBlock) {
            revert TooEarlyToReveal(block.number, minRevealBlock);
        }
        if (block.number > maxRevealBlock) {
            revert CommitExpired(block.number, maxRevealBlock);
        }
        
        if (keccak256(abi.encodePacked(secret)) != commit.commitment) {
            revert InvalidSecret();
        }
        
        // Collect mint fee (if treasury is configured)
        if (treasury != address(0) && address(usdc) != address(0)) {
            bool success = usdc.transferFrom(msg.sender, treasury, MINT_FEE);
            if (!success) revert MintFeeTransferFailed();
        }
        
        // Use blockhash from block after commit (wasn't known at commit time)
        bytes32 bh = blockhash(commit.blockNumber + 1);
        if (bh == bytes32(0)) revert BlockhashUnavailable();
        
        commit.status = CommitStatus.Revealed;
        
        tokenId = nextTokenId++;
        bytes32 seed = keccak256(abi.encodePacked(bh, address(this), tokenId, msg.sender, secret, "RAFFE_SEED_V2"));
        _seeds[tokenId] = seed;
        
        _raffeNames[tokenId] = commit.name;
        // Derive random stats (1-10) from the commit-reveal seed
        _zip[tokenId] = _randomStat(seed, "ZIP");
        _moxie[tokenId] = _randomStat(seed, "MOXIE");
        _hustle[tokenId] = _randomStat(seed, "HUSTLE");
        
        _safeMint(msg.sender, tokenId);
        
        emit RaffeMinted(tokenId, msg.sender, seed, commit.name);
        emit MintRevealed(commitId, tokenId, msg.sender);
    }
    
    /// @notice Cancel a pending commit and release the reserved name.
    /// @param commitId The commit ID to cancel.
    function cancelCommit(bytes32 commitId) external {
        MintCommit storage commit = mintCommits[commitId];
        
        if (commit.minter == address(0)) revert CommitNotFound();
        if (commit.minter != msg.sender) revert NotYourCommit();
        if (commit.status != CommitStatus.Pending) revert CommitNotPending();
        
        commit.status = CommitStatus.Cancelled;
        
        // Release the reserved name
        bytes32 nameHash = keccak256(bytes(_toLowerCase(commit.name)));
        _usedNames[nameHash] = false;
        
        emit MintCommitCancelled(commitId, msg.sender);
    }
    
    /// @notice Release an expired commit's reserved name. Anyone can call this.
    /// @param commitId The commit ID that has expired.
    function releaseExpiredCommit(bytes32 commitId) external {
        MintCommit storage commit = mintCommits[commitId];
        
        if (commit.minter == address(0)) revert CommitNotFound();
        if (commit.status != CommitStatus.Pending) revert CommitNotPending();
        
        uint256 maxRevealBlock = commit.blockNumber + MAX_REVEAL_BLOCKS;
        if (block.number <= maxRevealBlock) {
            revert TooEarlyToReveal(block.number, maxRevealBlock + 1);
        }
        
        commit.status = CommitStatus.Cancelled;
        
        // Release the reserved name
        bytes32 nameHash = keccak256(bytes(_toLowerCase(commit.name)));
        _usedNames[nameHash] = false;
        
        emit MintCommitCancelled(commitId, commit.minter);
    }
    
    /// @notice Get commit info.
    function getCommit(bytes32 commitId) external view returns (
        address minter,
        string memory name,
        uint256 blockNumber,
        CommitStatus status,
        uint256 minRevealBlock,
        uint256 maxRevealBlock
    ) {
        MintCommit storage commit = mintCommits[commitId];
        return (
            commit.minter,
            commit.name,
            commit.blockNumber,
            commit.status,
            commit.blockNumber + MIN_REVEAL_BLOCKS,
            commit.blockNumber + MAX_REVEAL_BLOCKS
        );
    }
    
    /// @notice Get all commit IDs for a user.
    function getUserCommits(address user) external view returns (bytes32[] memory) {
        return _userCommits[user];
    }
    
    /// @notice Get pending commits for a user (filters out revealed/cancelled).
    function getPendingCommits(address user) external view returns (bytes32[] memory) {
        bytes32[] storage allCommits = _userCommits[user];
        uint256 pendingCount = 0;
        
        // Count pending
        for (uint256 i = 0; i < allCommits.length; i++) {
            if (mintCommits[allCommits[i]].status == CommitStatus.Pending) {
                pendingCount++;
            }
        }
        
        // Build array
        bytes32[] memory pending = new bytes32[](pendingCount);
        uint256 j = 0;
        for (uint256 i = 0; i < allCommits.length; i++) {
            if (mintCommits[allCommits[i]].status == CommitStatus.Pending) {
                pending[j++] = allCommits[i];
            }
        }
        
        return pending;
    }

    /// @notice Check if a name is available for minting (case-insensitive check).
    /// @param name The name to check.
    /// @return available True if the name is available, false if taken or invalid.
    function isNameAvailable(string calldata name) external view returns (bool available) {
        bytes memory nameBytes = bytes(name);
        
        // Check length constraints
        if (nameBytes.length == 0 || nameBytes.length > 32) {
            return false;
        }
        
        // Check for all-whitespace names
        if (_isAllWhitespace(nameBytes)) {
            return false;
        }
        
        // Check if name hash is already used (case-insensitive)
        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        return !_usedNames[nameHash];
    }

    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);

        // SOULBOUND: Block transfers (from != 0 means it's a transfer, not a mint)
        // Mints are allowed (from == address(0))
        // Burns are allowed (to == address(0)) if you want to support burning
        if (from != address(0) && to != address(0)) {
            revert("RaffeNFT: soulbound, transfers disabled");
        }

        // Remove from previous owner (burns only now, since transfers are blocked)
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

        // Add to new owner (mints only now, since transfers are blocked)
        if (to != address(0)) {
            _ownedTokensIndex[tokenId] = _ownedTokens[to].length;
            _ownedTokens[to].push(tokenId);
        }
    }
}

