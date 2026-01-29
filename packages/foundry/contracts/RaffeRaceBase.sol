// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { RaffeRaceSimulator } from "./RaffeRaceSimulator.sol";
import { HouseTreasury } from "./HouseTreasury.sol";
import { RaffeRaceConstants as C } from "./libraries/RaffeRaceConstants.sol";
import { IERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

/// @notice Interface for RaffeNFT with stat accessors
interface IRaffeNFT is IERC721 {
    function zipOf(uint256 tokenId) external view returns (uint8);
    function moxieOf(uint256 tokenId) external view returns (uint8);
    function hustleOf(uint256 tokenId) external view returns (uint8);
    function statsOf(uint256 tokenId) external view returns (uint8 zip, uint8 moxie, uint8 hustle);
}

/**
 * @title RaffeRaceBase
 * @notice Base contract with shared state, constants, events, errors, and modifiers
 * @dev All RaffeRace modules inherit from this contract.
 *      
 *      NOTE: Solidity requires literal values for array sizes in function signatures
 *      and struct definitions. Constants here use literals that MUST match 
 *      RaffeRaceConstants. The _verifyConstants() function checks this.
 */
abstract contract RaffeRaceBase {
    // ============ Constants ============
    // Literals required for array sizes in structs - verified to match RaffeRaceConstants
    
    uint8 public constant LANE_COUNT = 6;
    uint16 public constant TRACK_LENGTH = 1000;
    uint16 public constant MAX_TICKS = 500;
    uint8 public constant SPEED_RANGE = 10;
    uint16 public constant ODDS_SCALE = 10000;
    uint16 public constant MAX_HOUSE_EDGE_BPS = 3000;
    uint32 public constant MIN_DECIMAL_ODDS_BPS = 10100;
    uint64 public constant ODDS_WINDOW_BLOCKS = 10;
    uint64 public constant BETTING_WINDOW_BLOCKS = 30;
    uint64 public constant POST_RACE_COOLDOWN_BLOCKS = 30;
    uint64 public constant CLAIM_EXPIRATION_BLOCKS = 5400;
    uint16 public constant MAX_QUEUE_SIZE = 128;

    // ============ Bet Types ============
    
    uint8 public constant BET_TYPE_WIN = 0;
    uint8 public constant BET_TYPE_PLACE = 1;
    uint8 public constant BET_TYPE_SHOW = 2;

    // ============ Claim Status Constants ============
    
    uint8 public constant CLAIM_STATUS_BLOCKHASH_UNAVAILABLE = 0;
    uint8 public constant CLAIM_STATUS_READY_TO_SETTLE = 1;
    uint8 public constant CLAIM_STATUS_LOSS = 2;
    uint8 public constant CLAIM_STATUS_WIN = 3;
    uint8 public constant CLAIM_STATUS_REFUND = 4;

    /// @dev Verify local constants match RaffeRaceConstants. Called in tests.
    function _verifyConstants() internal pure {
        assert(LANE_COUNT == C.LANE_COUNT);
        assert(TRACK_LENGTH == C.TRACK_LENGTH);
        assert(MAX_TICKS == C.MAX_TICKS);
        assert(SPEED_RANGE == C.SPEED_RANGE);
        assert(ODDS_SCALE == C.ODDS_SCALE);
        assert(MAX_HOUSE_EDGE_BPS == C.MAX_HOUSE_EDGE_BPS);
        assert(MIN_DECIMAL_ODDS_BPS == C.MIN_DECIMAL_ODDS_BPS);
        assert(BET_TYPE_WIN == C.BET_TYPE_WIN);
        assert(BET_TYPE_PLACE == C.BET_TYPE_PLACE);
        assert(BET_TYPE_SHOW == C.BET_TYPE_SHOW);
        assert(ODDS_WINDOW_BLOCKS == C.ODDS_WINDOW_BLOCKS);
        assert(BETTING_WINDOW_BLOCKS == C.BETTING_WINDOW_BLOCKS);
        assert(POST_RACE_COOLDOWN_BLOCKS == C.POST_RACE_COOLDOWN_BLOCKS);
        assert(CLAIM_EXPIRATION_BLOCKS == C.CLAIM_EXPIRATION_BLOCKS);
        assert(MAX_QUEUE_SIZE == C.MAX_QUEUE_SIZE);
        assert(CLAIM_STATUS_BLOCKHASH_UNAVAILABLE == C.CLAIM_STATUS_BLOCKHASH_UNAVAILABLE);
        assert(CLAIM_STATUS_READY_TO_SETTLE == C.CLAIM_STATUS_READY_TO_SETTLE);
        assert(CLAIM_STATUS_LOSS == C.CLAIM_STATUS_LOSS);
        assert(CLAIM_STATUS_WIN == C.CLAIM_STATUS_WIN);
        assert(CLAIM_STATUS_REFUND == C.CLAIM_STATUS_REFUND);
    }

    // ============ Structs ============
    
    /// @notice Position info for finish order (1st, 2nd, or 3rd place)
    struct PositionInfo {
        uint8[6] lanes;  // Lane indices in this position (only first `count` are valid)
        uint8 count;     // Number of lanes in this position (1 = normal, 2+ = dead heat)
    }
    
    struct Race {
        uint64 oddsDeadlineBlock;    // Block by which odds must be set
        uint64 bettingCloseBlock;
        uint64 settledAtBlock;
        bool oddsSet;
        bool settled;
        bool cancelled;
        uint8 winner;
        uint8 deadHeatCount;
        bytes32 seed;
        uint256 totalPot;
        uint256[6] totalOnLane;      // Win bets per lane
        uint256[6] totalPlaceOnLane; // Place bets per lane
        uint256[6] totalShowOnLane;  // Show bets per lane
        uint32[6] decimalOddsBps;    // Win odds
        uint32[6] placeOddsBps;      // Place odds
        uint32[6] showOddsBps;       // Show odds
        uint8[6] winners;
        // Finish order for Win/Place/Show betting
        PositionInfo firstPlace;
        PositionInfo secondPlace;
        PositionInfo thirdPlace;
        uint16[6] finalDistances;
        // Track unclaimed winning payouts for this race (for expiration cleanup)
        uint256 unclaimedLiability;
        bool liabilityCleaned; // true after expired cleanup
    }

    struct RaceRaffes {
        uint8 assignedCount;
        uint256[6] tokenIds;
        address[6] originalOwners;
    }

    /// @notice Entry in the persistent race queue
    struct QueueEntry {
        uint256 tokenId;
        address owner;
        bool removed;  // soft delete flag
    }

    /// @notice Single bet info
    struct Bet {
        uint128 amount;
        uint8 lane;
        bool claimed;
    }
    
    /// @notice All bets for a user in a single race (Win, Place, Show)
    struct UserRaceBets {
        Bet winBet;
        Bet placeBet;
        Bet showBet;
    }

    struct NextClaimView {
        bool hasClaim;
        uint256 raceId;
        uint8 status;
        uint8 betType;      // 0=Win, 1=Place, 2=Show
        uint8 betLane;
        uint256 betTokenId;
        uint128 betAmount;
        uint8 winner;
        uint256 payout;
        uint64 bettingCloseBlock;
        uint64 settledAtBlock;  // For claim expiration countdown
    }
    
    /// @notice View struct for queue entries
    struct QueueEntryView {
        uint256 index;
        uint256 tokenId;
        address owner;
        bool isValid;  // true if owner still owns the token and entry not removed
    }

    // ============ State Variables ============
    
    // External contract references
    IRaffeNFT public raffeNft;
    RaffeRaceSimulator public simulator;
    HouseTreasury public treasury;
    
    // Admin
    address public treasuryOwner;
    address public raceBot;  // Only address that can call setOdds
    uint16 public houseEdgeBps;
    uint256 public maxBetAmount;
    
    // House raffes for auto-fill
    uint256[6] public houseRaffeTokenIds;
    
    // Race state
    uint256 public nextRaceId;
    uint256 public settledLiability;
    
    // Persistent race queue (FIFO)
    QueueEntry[] internal _raceQueue;
    uint256 public queueHead;  // index of first non-processed entry
    mapping(uint256 => uint256) internal _tokenQueueIndex;  // tokenId => index+1 (0 means not in queue)
    mapping(address => bool) public userInQueue;  // one entry per user
    
    // Priority queue for restored entries (from cancelled races)
    // These are processed BEFORE the main queue
    QueueEntry[] internal _priorityQueue;
    
    // Mappings
    mapping(uint256 => Race) internal _races;
    mapping(uint256 => mapping(address => UserRaceBets)) internal _userBets;
    mapping(uint256 => RaceRaffes) internal _raceRaffes;
    mapping(uint256 => uint8[6]) internal _raceScore;
    
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
    error AlreadyBet();
    error InvalidLane();
    error ZeroBet();
    error AlreadySettled();
    error NotSettled();
    error RaceNotReady();
    error NotWinner();
    error AlreadyClaimed();
    error InvalidHouseRaffe();
    error RaffeNotAssigned();
    error NotTokenOwner();
    error PreviousRaceNotSettled();
    error CooldownNotElapsed();
    error NotTreasuryOwner();
    error OddsNotSet();
    error OddsAlreadySet();
    error InsufficientBankroll();
    error RaceNotCancellable();
    error AlreadyCancelled();
    error InvalidBetType();
    error OddsWindowActive();
    error OddsWindowExpired();      // Tried to set probabilities after deadline
    error OddsWindowNotExpired();   // Tried to cancel before deadline
    error NotRaceBot();
    error ClaimNotExpired();
    
    // Queue errors
    error AlreadyInQueue();
    error NotInQueue();
    error QueueFull();
    error TokenAlreadyQueued();
    error CannotQueueHouseRaffe();

    // ============ Events ============
    
    event RaceCreated(uint256 indexed raceId, uint64 oddsDeadlineBlock);
    event RaceProbabilitiesSet(
        uint256 indexed raceId,
        uint16[6] winProbBps,
        uint16[6] placeProbBps,
        uint16[6] showProbBps,
        uint32[6] winOddsBps,
        uint32[6] placeOddsBps,
        uint32[6] showOddsBps,
        uint64 bettingCloseBlock
    );
    event RaceAutoCancelled(uint256 indexed raceId);
    event BetPlaced(uint256 indexed raceId, address indexed bettor, uint8 lane, uint8 betType, uint256 amount);
    event RaceSettled(uint256 indexed raceId, bytes32 seed, uint8 winner);
    event RaceSettledDeadHeat(uint256 indexed raceId, bytes32 seed, uint8 deadHeatCount, uint8[6] winners);
    event Claimed(uint256 indexed raceId, address indexed bettor, uint256 payout);
    event ClaimExpired(uint256 indexed raceId, address indexed bettor, uint256 forfeitedPayout);
    event ExpiredLiabilityReleased(uint256 indexed raceId, uint256 amount);
    event RaffeAssigned(uint256 indexed raceId, uint256 indexed tokenId, address indexed originalOwner, uint8 lane);
    event HouseRaffeAssigned(uint256 indexed raceId, uint256 indexed tokenId, uint8 lane);
    event HouseEdgeUpdated(uint16 oldEdgeBps, uint16 newEdgeBps);
    event MaxBetUpdated(uint256 oldMaxBet, uint256 newMaxBet);
    event RaceBotUpdated(address oldBot, address newBot);
    event RaceCancelled(uint256 indexed raceId);
    
    // Queue events
    event QueueEntered(address indexed owner, uint256 indexed tokenId, uint256 queuePosition);
    event QueueLeft(address indexed owner, uint256 indexed tokenId);
    event QueueEntrySelected(uint256 indexed raceId, address indexed owner, uint256 indexed tokenId, uint8 lane);
    event QueueEntryRestored(address indexed owner, uint256 indexed tokenId);

    // ============ Modifiers ============
    
    modifier onlyTreasuryOwner() {
        if (msg.sender != treasuryOwner) revert NotTreasuryOwner();
        _;
    }
    
    modifier onlyRaceBot() {
        if (msg.sender != raceBot) revert NotRaceBot();
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
