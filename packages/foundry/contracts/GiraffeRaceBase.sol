// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceSimulator } from "./GiraffeRaceSimulator.sol";
import { HouseTreasury } from "./HouseTreasury.sol";
import { GiraffeRaceConstants as C } from "./libraries/GiraffeRaceConstants.sol";
import { IERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

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
 * @title GiraffeRaceBase
 * @notice Base contract with shared state, constants, events, errors, and modifiers
 * @dev All GiraffeRace modules inherit from this contract.
 *      
 *      NOTE: Solidity requires literal values for array sizes in function signatures
 *      and struct definitions. Constants here use literals that MUST match 
 *      GiraffeRaceConstants. The _verifyConstants() function checks this.
 */
abstract contract GiraffeRaceBase {
    // ============ Constants ============
    // Literals required for array sizes in structs - verified to match GiraffeRaceConstants
    
    uint8 public constant LANE_COUNT = 6;
    uint16 public constant TRACK_LENGTH = 1000;
    uint16 public constant MAX_TICKS = 500;
    uint8 public constant SPEED_RANGE = 10;
    uint16 public constant ODDS_SCALE = 10000;
    uint16 public constant MAX_HOUSE_EDGE_BPS = 3000;
    uint32 public constant MIN_DECIMAL_ODDS_BPS = 10100;
    uint32 public constant TEMP_FIXED_DECIMAL_ODDS_BPS = 57000;
    uint64 public constant SUBMISSION_WINDOW_BLOCKS = 30;
    uint64 public constant BETTING_WINDOW_BLOCKS = 30;
    uint64 public constant POST_RACE_COOLDOWN_BLOCKS = 30;
    uint16 public constant MAX_ENTRIES_PER_RACE = 128;

    // ============ Claim Status Constants ============
    
    uint8 public constant CLAIM_STATUS_BLOCKHASH_UNAVAILABLE = 0;
    uint8 public constant CLAIM_STATUS_READY_TO_SETTLE = 1;
    uint8 public constant CLAIM_STATUS_LOSS = 2;
    uint8 public constant CLAIM_STATUS_WIN = 3;
    uint8 public constant CLAIM_STATUS_REFUND = 4;

    /// @dev Verify local constants match GiraffeRaceConstants. Called in tests.
    function _verifyConstants() internal pure {
        assert(LANE_COUNT == C.LANE_COUNT);
        assert(TRACK_LENGTH == C.TRACK_LENGTH);
        assert(MAX_TICKS == C.MAX_TICKS);
        assert(SPEED_RANGE == C.SPEED_RANGE);
        assert(ODDS_SCALE == C.ODDS_SCALE);
        assert(MAX_HOUSE_EDGE_BPS == C.MAX_HOUSE_EDGE_BPS);
        assert(MIN_DECIMAL_ODDS_BPS == C.MIN_DECIMAL_ODDS_BPS);
        assert(TEMP_FIXED_DECIMAL_ODDS_BPS == C.TEMP_FIXED_DECIMAL_ODDS_BPS);
        assert(SUBMISSION_WINDOW_BLOCKS == C.SUBMISSION_WINDOW_BLOCKS);
        assert(BETTING_WINDOW_BLOCKS == C.BETTING_WINDOW_BLOCKS);
        assert(POST_RACE_COOLDOWN_BLOCKS == C.POST_RACE_COOLDOWN_BLOCKS);
        assert(MAX_ENTRIES_PER_RACE == C.MAX_ENTRIES_PER_RACE);
        assert(CLAIM_STATUS_BLOCKHASH_UNAVAILABLE == C.CLAIM_STATUS_BLOCKHASH_UNAVAILABLE);
        assert(CLAIM_STATUS_READY_TO_SETTLE == C.CLAIM_STATUS_READY_TO_SETTLE);
        assert(CLAIM_STATUS_LOSS == C.CLAIM_STATUS_LOSS);
        assert(CLAIM_STATUS_WIN == C.CLAIM_STATUS_WIN);
        assert(CLAIM_STATUS_REFUND == C.CLAIM_STATUS_REFUND);
    }

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
        uint256[6] totalOnLane;
        uint32[6] decimalOddsBps;
        uint8[6] winners;
    }

    struct RaceGiraffes {
        uint8 assignedCount;
        uint256[6] tokenIds;
        address[6] originalOwners;
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

    // ============ State Variables ============
    
    // External contract references
    IGiraffeNFT public giraffeNft;
    GiraffeRaceSimulator public simulator;
    HouseTreasury public treasury;
    IWinProbTable6 public winProbTable;
    
    // Admin
    address public treasuryOwner;
    uint16 public houseEdgeBps;
    uint256 public maxBetAmount;
    
    // House giraffes for auto-fill
    uint256[6] public houseGiraffeTokenIds;
    
    // Race state
    uint256 public nextRaceId;
    uint256 public settledLiability;
    
    // Mappings
    mapping(uint256 => Race) internal _races;
    mapping(uint256 => mapping(address => Bet)) internal _bets;
    mapping(uint256 => RaceGiraffes) internal _raceGiraffes;
    mapping(uint256 => uint8[6]) internal _raceScore;
    mapping(uint256 => mapping(address => bool)) internal _hasSubmittedGiraffe;
    mapping(uint256 => RaceEntry[]) internal _raceEntries;
    mapping(uint256 => mapping(uint256 => bool)) internal _tokenEntered;
    
    // User bet history
    mapping(address => uint256[]) internal _bettorRaceIds;
    mapping(address => uint256) internal _nextClaimIndex;

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
    event RaceOddsSet(uint256 indexed raceId, uint32[6] decimalOddsBps);
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

    // ============ Modifiers ============
    
    modifier onlyTreasuryOwner() {
        if (msg.sender != treasuryOwner) revert NotTreasuryOwner();
        _;
    }

    // ============ Internal Helpers ============

    /// @notice Get the current active (unsettled) race ID
    /// @dev Reverts if no races exist or the latest race is already settled
    /// @return raceId The active race ID
    function _activeRaceId() internal view returns (uint256 raceId) {
        if (nextRaceId == 0) revert InvalidRace();
        raceId = nextRaceId - 1;
        if (_races[raceId].settled) revert InvalidRace();
    }
}
