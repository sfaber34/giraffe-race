// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceSimulator } from "../../GiraffeRaceSimulator.sol";
import { HouseTreasury } from "../../HouseTreasury.sol";
import { IERC721 } from "../../../lib/openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

/// @notice Interface for GiraffeNFT with stat accessors
interface IGiraffeNFT is IERC721 {
    function zipOf(uint256 tokenId) external view returns (uint8);
    function moxieOf(uint256 tokenId) external view returns (uint8);
    function hustleOf(uint256 tokenId) external view returns (uint8);
    function statsOf(uint256 tokenId) external view returns (uint8 zip, uint8 moxie, uint8 hustle);
}

/// @notice Interface for the win probability table
interface IWinProbTable6 {
    function get(uint8[6] memory scores) external view returns (uint16[6] memory probsBps);
    function getSorted(uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f) external view returns (uint16[6] memory probsBps);
}

/**
 * @title GiraffeRaceStorage
 * @notice Diamond storage pattern for GiraffeRace - single source of truth for all storage
 * @dev Uses EIP-2535 Diamond storage pattern to avoid storage collisions between facets
 *      NOTE: Constants are defined here directly (not imported) because Solidity requires
 *      compile-time literals for struct array sizes. GiraffeRaceConstants.sol exports
 *      these same values for external contracts that need them.
 */
library GiraffeRaceStorage {
    // ============ Constants ============
    // Defined directly here for struct array compatibility (Solidity limitation)
    // These values are mirrored in GiraffeRaceConstants.sol for external access
    uint8 internal constant LANE_COUNT = 6;
    uint16 internal constant ODDS_SCALE = 10000;
    uint16 internal constant MAX_HOUSE_EDGE_BPS = 3000; // 30% max
    uint32 internal constant MIN_DECIMAL_ODDS_BPS = 10100; // 1.01x
    uint32 internal constant TEMP_FIXED_DECIMAL_ODDS_BPS = 57000; // 5.70x fallback
    uint64 internal constant SUBMISSION_WINDOW_BLOCKS = 10;
    uint64 internal constant BETTING_WINDOW_BLOCKS = 10;
    uint64 internal constant POST_RACE_COOLDOWN_BLOCKS = 5;
    uint16 internal constant MAX_ENTRIES_PER_RACE = 128;
    uint16 internal constant TRACK_LENGTH = 1000;
    uint16 internal constant MAX_TICKS = 500;
    uint8 internal constant SPEED_RANGE = 10;

    // ============ Claim Status Constants ============
    uint8 internal constant CLAIM_STATUS_BLOCKHASH_UNAVAILABLE = 0;
    uint8 internal constant CLAIM_STATUS_READY_TO_SETTLE = 1;
    uint8 internal constant CLAIM_STATUS_LOSS = 2;
    uint8 internal constant CLAIM_STATUS_WIN = 3;
    uint8 internal constant CLAIM_STATUS_REFUND = 4;

    // ============ Structs ============
    
    struct Race {
        uint64 submissionCloseBlock;
        uint64 bettingCloseBlock;
        uint64 settledAtBlock;
        bool giraffesFinalized;
        bool oddsSet;
        bool settled;
        bool cancelled;
        uint8 winner;
        uint8 deadHeatCount;
        bytes32 seed;
        uint256 totalPot;
        uint256[LANE_COUNT] totalOnLane;
        uint32[LANE_COUNT] decimalOddsBps;
        uint8[LANE_COUNT] winners;
    }

    struct RaceGiraffes {
        uint8 assignedCount;
        uint256[LANE_COUNT] tokenIds;
        address[LANE_COUNT] originalOwners;
    }

    struct RaceEntry {
        uint256 tokenId;
        address submitter;
    }

    struct Bet {
        uint128 amount;
        uint8 lane;
        bool claimed;
    }

    struct NextClaimView {
        bool hasClaim;
        uint256 raceId;
        uint8 status;
        uint8 betLane;
        uint256 betTokenId;
        uint128 betAmount;
        uint8 winner;
        uint256 payout;
        uint64 bettingCloseBlock;
    }

    // ============ Storage Layout ============
    
    struct Layout {
        // External contract references
        IGiraffeNFT giraffeNft;
        GiraffeRaceSimulator simulator;
        HouseTreasury treasury;
        IWinProbTable6 winProbTable;
        
        // Admin
        address treasuryOwner;
        uint16 houseEdgeBps;
        uint256 maxBetAmount;
        
        // House giraffes for auto-fill
        uint256[LANE_COUNT] houseGiraffeTokenIds;
        
        // Race state
        uint256 nextRaceId;
        uint256 settledLiability;
        
        // Mappings
        mapping(uint256 => Race) races;
        mapping(uint256 => mapping(address => Bet)) bets;
        mapping(uint256 => RaceGiraffes) raceGiraffes;
        mapping(uint256 => uint8[LANE_COUNT]) raceScore;
        mapping(uint256 => mapping(address => bool)) hasSubmittedGiraffe;
        mapping(uint256 => RaceEntry[]) raceEntries;
        mapping(uint256 => mapping(uint256 => bool)) tokenEntered;
        
        // User bet history
        mapping(address => uint256[]) bettorRaceIds;
        mapping(address => uint256) nextClaimIndex;
    }

    // ============ Storage Slot ============
    
    /// @dev Unique storage slot for GiraffeRace storage
    /// keccak256("giraffe.race.diamond.storage") - 1
    bytes32 constant STORAGE_SLOT = 0x7e92c6e41c34b6b3a10d97c9a4e0e2d8c5f3b1a7e6d4c2b0a8f6e4d2c0b8a697;

    // ============ Storage Access ============
    
    /// @notice Get the storage layout at the designated slot
    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }

    // ============ Errors ============
    
    error InvalidRace();
    error BetTooLarge();
    error HouseEdgeTooHigh();
    error NoClaimableBets();
    error BettingClosed();
    error BettingNotOpen();
    error SubmissionsClosed();
    error AlreadyBet();
    error InvalidLane();
    error ZeroBet();
    error AlreadySettled();
    error NotSettled();
    error BlockhashUnavailable();
    error RaceNotReady();
    error NotWinner();
    error AlreadyClaimed();
    error AlreadySubmitted();
    error InvalidHouseGiraffe();
    error GiraffeNotAssigned();
    error NotTokenOwner();
    error TokenAlreadyEntered();
    error EntryPoolFull();
    error GiraffesAlreadyFinalized();
    error PreviousRaceNotSettled();
    error CooldownNotElapsed();
    error NotTreasuryOwner();
    error OddsNotSet();
    error OddsAlreadySet();
    error InvalidOdds();
    error InsufficientBankroll();
    error RaceNotCancellable();
    error AlreadyCancelled();

    // ============ Events ============
    
    event RaceCreated(uint256 indexed raceId, uint64 submissionCloseBlock);
    event BettingWindowOpened(uint256 indexed raceId, uint64 bettingCloseBlock);
    event RaceOddsSet(uint256 indexed raceId, uint32[LANE_COUNT] decimalOddsBps);
    event BetPlaced(uint256 indexed raceId, address indexed bettor, uint8 indexed lane, uint256 amount);
    event RaceSettled(uint256 indexed raceId, bytes32 seed, uint8 winner);
    event RaceSettledDeadHeat(uint256 indexed raceId, bytes32 seed, uint8 deadHeatCount, uint8[6] winners);
    event Claimed(uint256 indexed raceId, address indexed bettor, uint256 payout);
    event GiraffeSubmitted(uint256 indexed raceId, address indexed owner, uint256 indexed tokenId, uint8 lane);
    event WinProbTableUpdated(address indexed newTable);
    event GiraffeAssigned(uint256 indexed raceId, uint256 indexed tokenId, address indexed originalOwner, uint8 lane);
    event HouseGiraffeAssigned(uint256 indexed raceId, uint256 indexed tokenId, uint8 lane);
    event HouseEdgeUpdated(uint16 oldEdgeBps, uint16 newEdgeBps);
    event MaxBetUpdated(uint256 oldMaxBet, uint256 newMaxBet);
    event RaceCancelled(uint256 indexed raceId);

    // ============ Modifiers (as internal functions) ============
    
    function enforceIsTreasuryOwner() internal view {
        if (msg.sender != layout().treasuryOwner) revert NotTreasuryOwner();
    }

    // ============ Shared Helpers ============

    /// @notice Get the current active (unsettled) race ID
    /// @dev Reverts if no races exist or the latest race is already settled
    /// @return raceId The active race ID
    function activeRaceId() internal view returns (uint256 raceId) {
        Layout storage s = layout();
        if (s.nextRaceId == 0) revert InvalidRace();
        raceId = s.nextRaceId - 1;
        if (s.races[raceId].settled) revert InvalidRace();
    }
}
