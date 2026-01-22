// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { DeterministicDice } from "./libraries/DeterministicDice.sol";
import { GiraffeRaceSimulator } from "./GiraffeRaceSimulator.sol";
import { HouseTreasury } from "./HouseTreasury.sol";
import { IERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

interface IWinProbTable6 {
    function get(uint8[6] memory scores) external view returns (uint16[6] memory probsBps);
    function getSorted(uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f) external view returns (uint16[6] memory probsBps);
}

interface IGiraffeNFT is IERC721 {
    function readinessOf(uint256 tokenId) external view returns (uint8);
    function conditioningOf(uint256 tokenId) external view returns (uint8);
    function speedOf(uint256 tokenId) external view returns (uint8);
    function statsOf(uint256 tokenId) external view returns (uint8 readiness, uint8 conditioning, uint8 speed);
}

/**
 * @title GiraffeRace
 * @notice On-chain betting game: 6 giraffes race, winner picked deterministically from a seed.
 * @dev v1: single bet per address per race, parimutuel payout (winners split the pot pro-rata).
 *
 * Seed (v1) is derived from a future blockhash:
 *   seed = keccak256(abi.encodePacked(blockhash(closeBlock), raceId, address(this)))
 *
 * NOTE: `blockhash(closeBlock)` is only available for the most recent ~256 blocks,
 * so `settleRace` must be called soon after `closeBlock`.
 */
contract GiraffeRace {
    using DeterministicDice for DeterministicDice.Dice;

    uint8 public constant LANE_COUNT = 6;
    // Fixed-odds params (v3):
    // - decimal odds are stored in basis points (1e4). Example: 3.80x => 38000.
    // - house edge is enforced by requiring an overround >= 1/(1-edge).
    uint16 internal constant ODDS_SCALE = 10000;
    uint16 public constant MAX_HOUSE_EDGE_BPS = 3000; // 30% max (sanity cap)
    uint32 internal constant MIN_DECIMAL_ODDS_BPS = 10100; // 1.01x
    // Fallback fixed odds when no probability table is deployed.
    // For 6 equal racers with 5% house edge: 6.0 * 0.95 = 5.70x => 57000 bps
    uint32 internal constant TEMP_FIXED_DECIMAL_ODDS_BPS = 57000;
    // Phase schedule (v2):
    // - Submissions close at (bettingCloseBlock - SUBMISSION_CLOSE_OFFSET_BLOCKS)
    // - Betting is only open after submissions close (inclusive) and before bettingCloseBlock (exclusive)
    // This ensures bettors can see the finalized lane lineup before betting.
    uint64 internal constant SUBMISSION_CLOSE_OFFSET_BLOCKS = 10;
    uint64 internal constant DEFAULT_BETTING_CLOSE_OFFSET_BLOCKS = 20;
    // Cap entrant pool size to keep `settleRace` gas bounded. Can be increased later.
    uint16 public constant MAX_ENTRIES_PER_RACE = 128;
    uint16 public constant TRACK_LENGTH = 1000;
    uint16 public constant MAX_TICKS = 500;
    uint8 public constant SPEED_RANGE = 10; // speeds per tick: 1-10

    address public treasuryOwner;  // Owns house NFTs + controls admin functions (should be multisig)
    uint16 public houseEdgeBps = 500; // 5% default, configurable by treasuryOwner
    IGiraffeNFT public giraffeNft;
    GiraffeRaceSimulator public simulator;
    HouseTreasury public treasury;
    IWinProbTable6 public winProbTable; // On-chain probability table for odds calculation

    struct Race {
        // Betting close block (formerly "closeBlock" in v1).
        uint64 closeBlock;
        // Lane lineup finalized from entrant pool + house fill.
        bool giraffesFinalized;
        // Fixed odds quoted for lanes (locked once set; required before betting).
        bool oddsSet;
        bool settled;
        uint8 winner; // Primary winner (first in tie order), 0-(LANE_COUNT-1), valid only if settled
        uint8 deadHeatCount; // 1 = normal win, 2+ = dead heat (multiple winners)
        bytes32 seed; // stored on settlement for later verification
        uint256 totalPot;
        uint256[LANE_COUNT] totalOnLane;
        uint32[LANE_COUNT] decimalOddsBps; // per lane, scaled by ODDS_SCALE
        uint8[LANE_COUNT] winners; // All winners (for dead heat support); valid indices are 0..(deadHeatCount-1)
    }

    struct RaceGiraffes {
        // Number of lanes that have been assigned tokenIds (selected entrants + house fill).
        uint8 assignedCount;
        // Token ID for each lane (0..LANE_COUNT-1). 0 means unassigned (valid tokenIds start at 1 in our GiraffeNFT).
        uint256[LANE_COUNT] tokenIds;
        // The owner snapshot for each lane at the time the entrant was selected (or `treasuryOwner` for house fill).
        address[LANE_COUNT] originalOwners;
    }

    struct RaceEntry {
        uint256 tokenId;
        address submitter;
    }

    struct Bet {
        uint128 amount;
        uint8 lane; // 0-(LANE_COUNT-1)
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
        uint64 closeBlock;
    }

    uint256 public nextRaceId;
    // Sum of unpaid winning payouts across settled races (fixed odds).
    uint256 public settledLiability;
    mapping(uint256 => Race) private races;
    mapping(uint256 => mapping(address => Bet)) private bets;
    mapping(uint256 => RaceGiraffes) private raceGiraffes;
    // Snapshot of "effective score" (1-10) for each lane at lineup finalization time.
    // Effective score is computed as the equally-weighted average of:
    //   readiness, conditioning, speed (each 1-10).
    mapping(uint256 => uint8[LANE_COUNT]) private raceScore;
    mapping(uint256 => mapping(address => bool)) private hasSubmittedGiraffe;
    mapping(uint256 => RaceEntry[]) private raceEntries;
    mapping(uint256 => mapping(uint256 => bool)) private tokenEntered;

    // Per-user list of races they participated in (one bet per race).
    mapping(address => uint256[]) private bettorRaceIds;
    // Next index in `bettorRaceIds[msg.sender]` to resolve/claim.
    mapping(address => uint256) private nextClaimIndex;

    // Fixed pool of house giraffes used to auto-fill empty lanes.
    // These are NOT escrowed by default (no approvals required); we just reference them as house-owned racers.
    uint256[LANE_COUNT] public houseGiraffeTokenIds;

    event RaceCreated(uint256 indexed raceId, uint64 closeBlock);
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

    error InvalidRace();
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
    error NotTreasuryOwner();
    error OddsNotSet();
    error OddsAlreadySet();
    error InvalidOdds();
    error InsufficientBankroll();

    modifier onlyTreasuryOwner() {
        if (msg.sender != treasuryOwner) revert NotTreasuryOwner();
        _;
    }

    constructor(
        address _giraffeNft,
        address _treasuryOwner,
        uint256[LANE_COUNT] memory _houseGiraffeTokenIds,
        address _simulator,
        address _treasury,
        address _winProbTable
    ) {
        giraffeNft = IGiraffeNFT(_giraffeNft);
        treasuryOwner = _treasuryOwner;
        simulator = GiraffeRaceSimulator(_simulator);
        treasury = HouseTreasury(_treasury);
        winProbTable = IWinProbTable6(_winProbTable);
        houseGiraffeTokenIds = _houseGiraffeTokenIds;

        // Basic sanity: prevent accidental all-zeros configuration.
        for (uint256 i = 0; i < LANE_COUNT; i++) {
            if (_houseGiraffeTokenIds[i] == 0) revert InvalidHouseGiraffe();
        }
    }

    function laneCount() external pure returns (uint8) {
        return LANE_COUNT;
    }

    function tickCount() external pure returns (uint16) {
        // Backwards compatible name: this is the max number of ticks we'll run before reverting.
        return MAX_TICKS;
    }

    function speedRange() external pure returns (uint8) {
        return SPEED_RANGE;
    }

    function trackLength() external pure returns (uint16) {
        return TRACK_LENGTH;
    }

    /// @notice Update the house edge (in basis points). Max 20%.
    /// @param newEdgeBps The new house edge in basis points (e.g., 500 = 5%).
    function setHouseEdgeBps(uint16 newEdgeBps) external onlyTreasuryOwner {
        if (newEdgeBps > MAX_HOUSE_EDGE_BPS) revert HouseEdgeTooHigh();
        uint16 oldEdgeBps = houseEdgeBps;
        houseEdgeBps = newEdgeBps;
        emit HouseEdgeUpdated(oldEdgeBps, newEdgeBps);
    }

    /**
     * @notice Deterministically simulate a race from a seed.
     * @dev Pure function so it can be re-run off-chain for verification / animation.
     * @return winner The winning lane index (0-3)
     * @return distances Final distances after all ticks (units are arbitrary)
     */
    function simulate(bytes32 seed) external view returns (uint8 winner, uint16[LANE_COUNT] memory distances) {
        // Default: all lanes have full effective score (10).
        return simulator.simulate(seed);
    }

    /// @notice Deterministically simulate a race from a seed + lane effective score snapshot.
    /// @dev Effective score is typically the rounded average of readiness/conditioning/speed.
    function simulateWithScore(bytes32 seed, uint8[LANE_COUNT] calldata score)
        external
        view
        returns (uint8 winner, uint16[LANE_COUNT] memory distances)
    {
        return simulator.simulateWithScore(seed, score);
    }

    function latestRaceId() public view returns (uint256 raceId) {
        if (nextRaceId == 0) revert InvalidRace();
        return nextRaceId - 1;
    }

    function _activeRaceId() internal view returns (uint256 raceId) {
        if (nextRaceId == 0) revert InvalidRace();
        raceId = nextRaceId - 1;
        if (races[raceId].settled) revert InvalidRace();
    }

    /// @notice Convenience: create a race that closes 20 blocks from now.
    function createRace() external returns (uint256 raceId) {
        return _createRace();
    }

    function _createRace() internal returns (uint256 raceId) {
        // Only allow one open race at a time: previous race must be settled before creating a new one.
        if (nextRaceId > 0) {
            Race storage prev = races[nextRaceId - 1];
            if (!prev.settled) revert PreviousRaceNotSettled();
        }

        // Fixed schedule: prevents griefers from setting a far-future close block.
        uint64 closeBlock = uint64(block.number + DEFAULT_BETTING_CLOSE_OFFSET_BLOCKS);

        raceId = nextRaceId++;
        Race storage r = races[raceId];
        r.closeBlock = closeBlock;

        emit RaceCreated(raceId, closeBlock);
    }

    function placeBet(uint8 lane, uint256 amount) external {
        if (lane >= LANE_COUNT) revert InvalidLane();

        uint256 raceId = _activeRaceId();
        Race storage r = races[raceId];
        if (block.number >= r.closeBlock) revert BettingClosed();
        if (block.number < _submissionCloseBlock(r.closeBlock)) revert BettingNotOpen();

        if (amount == 0) revert ZeroBet();

        // Ensure the lane lineup is finalized before accepting bets (so bettors can see who is racing).
        _ensureGiraffesFinalized(raceId);
        if (!r.oddsSet) revert OddsNotSet();

        Bet storage b = bets[raceId][msg.sender];
        if (b.amount != 0) revert AlreadyBet();

        // Risk control (fixed odds): ensure treasury can cover worst-case payout for this race,
        // while also reserving funds for already-settled liabilities.
        uint256[LANE_COUNT] memory projectedTotals = r.totalOnLane;
        projectedTotals[lane] += amount;
        uint256 maxPayout;
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            uint256 payoutIfWin = (projectedTotals[i] * uint256(r.decimalOddsBps[i])) / ODDS_SCALE;
            if (payoutIfWin > maxPayout) maxPayout = payoutIfWin;
        }
        if (treasury.balance() < settledLiability + maxPayout) revert InsufficientBankroll();

        // Collect bet from user via treasury (user must have approved treasury)
        treasury.collectBet(msg.sender, amount);

        b.amount = uint128(amount);
        b.lane = lane;

        r.totalPot += amount;
        r.totalOnLane[lane] += amount;

        bettorRaceIds[msg.sender].push(raceId);
        emit BetPlaced(raceId, msg.sender, lane, amount);
    }

    /**
     * @notice Publish the fixed decimal odds for a race (must be done after lineup/effective score are finalized).
     * @dev Odds must be set before any bets can be placed. House-only to protect bankroll.
     *
     * House edge enforcement:
     * Let decimal odds be O_i. We require sum(1/O_i) >= 1/(1-edge). For edge=5%, that's >= 1.052631...
     * Using basis points, we enforce:
     *   sum(ODDS_SCALE^2 / O_i_bps) >= ceil(ODDS_SCALE*ODDS_SCALE / (ODDS_SCALE - houseEdgeBps))
     */
    function setRaceOdds(uint256 raceId, uint32[LANE_COUNT] calldata decimalOddsBps) external onlyTreasuryOwner {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        if (r.settled) revert AlreadySettled();
        if (!r.giraffesFinalized) revert RaceNotReady();
        if (r.oddsSet) revert OddsAlreadySet();

        // Must be within the betting window (submissions closed, betting not closed).
        uint64 submissionCloseBlock = _submissionCloseBlock(r.closeBlock);
        if (block.number < submissionCloseBlock) revert BettingNotOpen();
        if (block.number >= r.closeBlock) revert BettingClosed();

        uint256 invSumBps = 0;
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            uint32 o = decimalOddsBps[i];
            if (o < MIN_DECIMAL_ODDS_BPS) revert InvalidOdds();
            // inv in bps of 1.0: (ODDS_SCALE / (o/ODDS_SCALE)) = ODDS_SCALE^2 / o
            // Use ceil division to avoid rejecting valid odds due to integer truncation.
            uint256 num = uint256(ODDS_SCALE) * uint256(ODDS_SCALE);
            invSumBps += (num + uint256(o) - 1) / uint256(o);
        }

        uint256 minOverroundBps = (uint256(ODDS_SCALE) * uint256(ODDS_SCALE) + (ODDS_SCALE - houseEdgeBps) - 1)
            / (ODDS_SCALE - houseEdgeBps);
        if (invSumBps < minOverroundBps) revert InvalidOdds();

        r.decimalOddsBps = decimalOddsBps;
        r.oddsSet = true;
        emit RaceOddsSet(raceId, decimalOddsBps);
    }

    /**
     * @notice Update the win probability table contract address.
     * @dev Only callable by treasuryOwner. Set to address(0) to use fallback fixed odds.
     */
    function setWinProbTable(address _winProbTable) external onlyTreasuryOwner {
        winProbTable = IWinProbTable6(_winProbTable);
        emit WinProbTableUpdated(_winProbTable);
    }

    /**
     * @notice Submit one of your GiraffeNFTs into the race's entrant pool (non-custodial).
     * @dev If <= 4 total entrants submit, all valid entrants race.
     *      If > 4 submit, we deterministically draw 4 valid entrants at settlement.
     *
     *      "Valid" at settlement time means the current owner still matches the original submitter.
     *      If an entrant becomes invalid (transferred away), they're treated as a no-show.
     */
    function submitGiraffe(uint256 tokenId) external {
        // Races must be explicitly created by calling `createRace()`.
        if (nextRaceId == 0) revert InvalidRace();
        if (races[nextRaceId - 1].settled) revert InvalidRace();

        uint256 raceId = _activeRaceId();
        Race storage r = races[raceId];
        // Submissions close earlier than betting.
        if (block.number >= _submissionCloseBlock(r.closeBlock)) revert SubmissionsClosed();
        if (r.settled) revert AlreadySettled();

        if (hasSubmittedGiraffe[raceId][msg.sender]) revert AlreadySubmitted();
        if (giraffeNft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        // Prevent users from submitting one of the reserved house giraffes.
        for (uint256 i = 0; i < LANE_COUNT; i++) {
            if (houseGiraffeTokenIds[i] == tokenId) revert InvalidHouseGiraffe();
        }
        if (tokenEntered[raceId][tokenId]) revert TokenAlreadyEntered();
        if (raceEntries[raceId].length >= MAX_ENTRIES_PER_RACE) revert EntryPoolFull();

        // Mark submission before external call; tx reverts if transfer fails.
        hasSubmittedGiraffe[raceId][msg.sender] = true;
        tokenEntered[raceId][tokenId] = true;
        raceEntries[raceId].push(RaceEntry({ tokenId: tokenId, submitter: msg.sender }));

        // Lane isn't determined until settlement; emit 255 to mean "pool entry".
        emit GiraffeSubmitted(raceId, msg.sender, tokenId, type(uint8).max);
    }

    /**
     * @notice Finalize the race lineup (which tokenIds are in which lanes) after submissions close.
     * @dev Anyone can call this. Once finalized, the lane lineup is stable and can be shown in the UI
     *      during the betting window.
     *
     *      Entropy uses `blockhash(submissionCloseBlock - 1)` so it's available starting at
     *      `submissionCloseBlock` (the first block where submissions are closed).
     */
    function finalizeRaceGiraffes() external {
        uint256 raceId = _activeRaceId();
        Race storage r = races[raceId];
        if (r.settled) revert AlreadySettled();
        if (r.giraffesFinalized) revert GiraffesAlreadyFinalized();

        uint64 submissionCloseBlock = _submissionCloseBlock(r.closeBlock);
        if (block.number < submissionCloseBlock) revert BettingNotOpen();

        _finalizeGiraffes(raceId);
    }

    function settleRace() external {
        uint256 raceId = _activeRaceId();
        _settleRace(raceId);
    }

    function _settleRace(uint256 raceId) internal {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        if (r.settled) revert AlreadySettled();
        if (block.number <= r.closeBlock) revert RaceNotReady();
        // Fixed odds are required only if there were bets for this race.
        if (r.totalPot != 0 && !r.oddsSet) revert OddsNotSet();

        bytes32 bh = blockhash(r.closeBlock);
        if (bh == bytes32(0)) revert BlockhashUnavailable();

        // Derive independent seeds for independent decisions to avoid correlation.
        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 simSeed = keccak256(abi.encodePacked(baseSeed, "RACE_SIM"));

        // Make sure lineup is finalized (it should have been finalized during betting window,
        // but keep settlement robust).
        _ensureGiraffesFinalized(raceId);
        
        // Get ALL winners (supports dead heat)
        (uint8[LANE_COUNT] memory winners, uint8 winnerCount,) = simulator.winnersWithScore(simSeed, raceScore[raceId]);

        r.settled = true;
        r.winner = winners[0]; // Primary winner (backwards compatible)
        r.deadHeatCount = winnerCount;
        r.winners = winners;
        // Store the simulation seed so the race can be replayed off-chain.
        r.seed = simSeed;

        // Record the total liability for this race (winners will claim fixed payouts).
        // For dead heat: each winner's payout is divided by deadHeatCount, so total liability
        // is the sum of (betAmount * odds / deadHeatCount) for all winning lanes.
        if (r.totalPot != 0) {
            uint256 raceLiability = 0;
            for (uint8 i = 0; i < winnerCount; i++) {
                uint8 w = winners[i];
                // Each winner gets (betAmount * odds) / deadHeatCount
                uint256 lanePayout = (r.totalOnLane[w] * uint256(r.decimalOddsBps[w])) / ODDS_SCALE;
                raceLiability += lanePayout / uint256(winnerCount);
            }
            settledLiability += raceLiability;
        }

        if (winnerCount > 1) {
            emit RaceSettledDeadHeat(raceId, simSeed, winnerCount, winners);
        } else {
            emit RaceSettled(raceId, simSeed, r.winner);
        }
    }

    /// @notice Resolve the caller's next unsettled bet (winner pays out, loser resolves to 0).
    /// @dev This avoids needing a `raceId` parameter while still supporting claims from older races.
    ///      For dead heats, winners receive (betAmount * odds) / deadHeatCount.
    function claim() external returns (uint256 payout) {
        uint256[] storage ids = bettorRaceIds[msg.sender];
        uint256 idx = nextClaimIndex[msg.sender];
        if (idx >= ids.length) revert NoClaimableBets();

        while (idx < ids.length) {
            uint256 raceId = ids[idx];
            Race storage r = races[raceId];

            // Fully on-demand settlement: if the race is ready, let this call settle it.
            if (!r.settled) {
                _settleRace(raceId);
            }

            Bet storage b = bets[raceId][msg.sender];
            // If already resolved, move on.
            if (b.amount == 0 || b.claimed) {
                idx++;
                continue;
            }

            b.claimed = true;
            nextClaimIndex[msg.sender] = idx + 1;

            // Losers resolve to 0 to allow advancing through history.
            // Use _isWinner to support dead heat (multiple winners).
            if (!_isWinner(r, b.lane)) {
                emit Claimed(raceId, msg.sender, 0);
                return 0;
            }

            // Winner payout: (betAmount * odds) / deadHeatCount
            // For normal wins (deadHeatCount = 1), this is just (betAmount * odds).
            // For dead heats (deadHeatCount > 1), payout is split proportionally.
            payout = (uint256(b.amount) * uint256(r.decimalOddsBps[b.lane])) / ODDS_SCALE;
            payout = payout / uint256(r.deadHeatCount);
            
            if (payout != 0) {
                settledLiability -= payout;
                treasury.payWinner(msg.sender, payout);
            }

            emit Claimed(raceId, msg.sender, payout);
            return payout;
        }

        nextClaimIndex[msg.sender] = ids.length;
        revert NoClaimableBets();
    }

    /**
     * @notice Claim the caller's next *winning* payout.
     * @dev This function will advance through (and mark as resolved) any losses so users only ever "claim" money.
     * It may also settle races on-demand (same as `claim()`), so gas can be higher.
     * For dead heats, winners receive (betAmount * odds) / deadHeatCount.
     *
     * Reverts with `NoClaimableBets()` if there is no winning payout remaining for the caller.
     */
    function claimNextWinningPayout() external returns (uint256 payout) {
        uint256[] storage ids = bettorRaceIds[msg.sender];
        uint256 idx = nextClaimIndex[msg.sender];
        if (idx >= ids.length) revert NoClaimableBets();

        while (idx < ids.length) {
            uint256 raceId = ids[idx];
            Race storage r = races[raceId];

            // On-demand settlement (same behavior as `claim()`).
            if (!r.settled) {
                _settleRace(raceId);
            }

            Bet storage b = bets[raceId][msg.sender];
            // Skip already resolved entries.
            if (b.amount == 0 || b.claimed) {
                idx++;
                continue;
            }

            // Resolve losses silently (advance the queue without "claiming" money).
            // Use _isWinner to support dead heat (multiple winners).
            if (!_isWinner(r, b.lane)) {
                b.claimed = true;
                idx++;
                nextClaimIndex[msg.sender] = idx;
                continue;
            }

            // Winner: pay out.
            b.claimed = true;
            nextClaimIndex[msg.sender] = idx + 1;

            // Winner payout: (betAmount * odds) / deadHeatCount
            payout = (uint256(b.amount) * uint256(r.decimalOddsBps[b.lane])) / ODDS_SCALE;
            payout = payout / uint256(r.deadHeatCount);
            
            if (payout != 0) {
                settledLiability -= payout;
                treasury.payWinner(msg.sender, payout);
            }

            emit Claimed(raceId, msg.sender, payout);
            return payout;
        }

        nextClaimIndex[msg.sender] = ids.length;
        revert NoClaimableBets();
    }

    // -----------------------
    // Views (for UI / replay)
    // -----------------------

    /// @notice Bot/UI helper: return the key state flags for a race.
    /// @dev For non-existent races (closeBlock == 0), returns all false.
    function getRaceFlagsById(uint256 raceId)
        external
        view
        returns (bool settled, bool giraffesFinalized, bool oddsSet)
    {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) return (false, false, false);
        return (r.settled, r.giraffesFinalized, r.oddsSet);
    }

    /// @notice Bot/UI helper: return the schedule blocks for a race.
    /// @dev For non-existent races (closeBlock == 0), returns (0, 0).
    function getRaceScheduleById(uint256 raceId) external view returns (uint64 closeBlock, uint64 submissionCloseBlock) {
        Race storage r = races[raceId];
        closeBlock = r.closeBlock;
        if (closeBlock == 0) return (0, 0);
        submissionCloseBlock = _submissionCloseBlock(closeBlock);
        return (closeBlock, submissionCloseBlock);
    }

    /// @notice Bot helper: return whether key permissionless ops are currently executable, plus blockhash windows.
    /// @dev Mirrors `finalizeRaceGiraffes` and `settleRace` preconditions, including blockhash availability checks.
    /// For non-existent races (closeBlock == 0), returns all zeros/false.
    function getRaceActionabilityById(uint256 raceId)
        external
        view
        returns (
            bool canFinalizeNow,
            bool canSettleNow,
            uint64 closeBlock,
            uint64 submissionCloseBlock,
            uint64 finalizeEntropyBlock,
            uint64 finalizeBlockhashExpiresAt,
            uint64 settleBlockhashExpiresAt,
            uint64 blocksUntilFinalizeExpiry,
            uint64 blocksUntilSettleExpiry
        )
    {
        Race storage r = races[raceId];
        closeBlock = r.closeBlock;
        if (closeBlock == 0) {
            return (false, false, 0, 0, 0, 0, 0, 0, 0);
        }

        submissionCloseBlock = _submissionCloseBlock(closeBlock);
        finalizeEntropyBlock = submissionCloseBlock > 0 ? (submissionCloseBlock - 1) : 0;

        finalizeBlockhashExpiresAt = finalizeEntropyBlock == 0 ? 0 : uint64(uint256(finalizeEntropyBlock) + 256);
        settleBlockhashExpiresAt = uint64(uint256(closeBlock) + 256);

        // Clamp at 0 for convenience (bots can treat 0 as "expired or invalid").
        if (finalizeBlockhashExpiresAt != 0 && block.number < finalizeBlockhashExpiresAt) {
            blocksUntilFinalizeExpiry = uint64(uint256(finalizeBlockhashExpiresAt) - block.number);
        } else {
            blocksUntilFinalizeExpiry = 0;
        }
        if (block.number < settleBlockhashExpiresAt) {
            blocksUntilSettleExpiry = uint64(uint256(settleBlockhashExpiresAt) - block.number);
        } else {
            blocksUntilSettleExpiry = 0;
        }

        // Finalize: same gates as finalizeRaceGiraffes + blockhash(submissionCloseBlock - 1) availability.
        bool finalizeBlockReached = block.number >= submissionCloseBlock;
        bool finalizeBhAvailable = finalizeEntropyBlock != 0 && blockhash(uint256(finalizeEntropyBlock)) != bytes32(0);
        canFinalizeNow = closeBlock != 0 && !r.settled && !r.giraffesFinalized && finalizeBlockReached && finalizeBhAvailable;

        // Settle: same gates as _settleRace + blockhash(closeBlock) availability.
        // Additionally, if lineup isn't finalized yet, settlement will attempt finalization and can fail if
        // finalize entropy blockhash is already unavailable.
        bool settleBhAvailable = blockhash(uint256(closeBlock)) != bytes32(0);
        bool settleTimeReached = block.number > closeBlock;
        bool oddsOk = r.totalPot == 0 || r.oddsSet;
        bool finalizationOk = r.giraffesFinalized || (finalizeBlockReached && finalizeBhAvailable);

        canSettleNow = closeBlock != 0 && !r.settled && settleTimeReached && settleBhAvailable && oddsOk && finalizationOk;
    }

    /// @notice Bot/UI helper: returns the current active (unsettled) race id, or 0 if none exists.
    function getActiveRaceIdOrZero() external view returns (uint256 raceId) {
        if (nextRaceId == 0) return 0;
        raceId = nextRaceId - 1;
        if (races[raceId].settled) return 0;
        return raceId;
    }

    function getRace()
        external
        view
        returns (
            uint64 closeBlock,
            bool settled,
            uint8 winner,
            bytes32 seed,
            uint256 totalPot,
            uint256[LANE_COUNT] memory totalOnLane
        )
    {
        uint256 raceId = latestRaceId();
        Race storage r = races[raceId];
        return (r.closeBlock, r.settled, r.winner, r.seed, r.totalPot, r.totalOnLane);
    }

    /// @notice Read a specific race by id (UI helper for browsing history / replay).
    function getRaceById(uint256 raceId)
        external
        view
        returns (
            uint64 closeBlock,
            bool settled,
            uint8 winner,
            bytes32 seed,
            uint256 totalPot,
            uint256[LANE_COUNT] memory totalOnLane
        )
    {
        Race storage r = races[raceId];
        return (r.closeBlock, r.settled, r.winner, r.seed, r.totalPot, r.totalOnLane);
    }

    function getRaceOddsById(uint256 raceId) external view returns (bool oddsSet, uint32[LANE_COUNT] memory decimalOddsBps) {
        Race storage r = races[raceId];
        return (r.oddsSet, r.decimalOddsBps);
    }

    /// @notice Get dead heat information for a settled race.
    /// @return deadHeatCount 1 = normal win, 2+ = dead heat (multiple winners)
    /// @return winners Array of winning lane indices (only first `deadHeatCount` entries are valid)
    function getRaceDeadHeatById(uint256 raceId) external view returns (uint8 deadHeatCount, uint8[LANE_COUNT] memory winners) {
        Race storage r = races[raceId];
        return (r.deadHeatCount, r.winners);
    }

    function getBet(address bettor) external view returns (uint128 amount, uint8 lane, bool claimed) {
        uint256 raceId = latestRaceId();
        Bet storage b = bets[raceId][bettor];
        return (b.amount, b.lane, b.claimed);
    }

    /// @notice Read the bet for a specific race id (UI helper for browsing history).
    function getBetById(uint256 raceId, address bettor) external view returns (uint128 amount, uint8 lane, bool claimed) {
        Bet storage b = bets[raceId][bettor];
        return (b.amount, b.lane, b.claimed);
    }

    function getRaceGiraffes()
        external
        view
        returns (
            uint8 assignedCount,
            uint256[LANE_COUNT] memory tokenIds,
            address[LANE_COUNT] memory originalOwners
        )
    {
        uint256 raceId = latestRaceId();

        RaceGiraffes storage ra = raceGiraffes[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners);
    }

    /// @notice Read lane assignments for a specific race id (UI helper for browsing history / replay).
    function getRaceGiraffesById(uint256 raceId)
        external
        view
        returns (
            uint8 assignedCount,
            uint256[LANE_COUNT] memory tokenIds,
            address[LANE_COUNT] memory originalOwners
        )
    {
        RaceGiraffes storage ra = raceGiraffes[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners);
    }

    function getRaceScore() external view returns (uint8[LANE_COUNT] memory score) {
        uint256 raceId = latestRaceId();
        return raceScore[raceId];
    }

    /// @notice Read lane effective score snapshot for a specific race id (UI helper for replay).
    function getRaceScoreById(uint256 raceId) external view returns (uint8[LANE_COUNT] memory score) {
        return raceScore[raceId];
    }

    /// @notice How many unresolved bets remain in the caller's claim queue.
    /// @dev This counts both winning payouts and losing resolutions (which still must be claimed to advance).
    function getClaimRemaining(address bettor) external view returns (uint256 remaining) {
        uint256[] storage ids = bettorRaceIds[bettor];
        uint256 idx = nextClaimIndex[bettor];
        if (idx >= ids.length) return 0;
        return ids.length - idx;
    }

    /// @notice How many *winning payouts* remain for the caller (settled, unclaimed, winning bets only).
    /// @dev Includes dead heat winners.
    function getWinningClaimRemaining(address bettor) external view returns (uint256 remaining) {
        uint256[] storage ids = bettorRaceIds[bettor];
        uint256 idx = nextClaimIndex[bettor];
        if (idx >= ids.length) return 0;

        for (uint256 i = idx; i < ids.length; i++) {
            uint256 rid = ids[i];
            Bet storage b = bets[rid][bettor];
            if (b.amount == 0 || b.claimed) continue;

            Race storage r = races[rid];
            if (!r.settled) continue;
            if (!_isWinner(r, b.lane)) continue;

            remaining++;
        }
    }

    /// @notice UI helper: preview the caller's next *winning payout* (settled wins only).
    /// @dev For dead heats, payout is divided by deadHeatCount.
    function getNextWinningClaim(address bettor) external view returns (NextClaimView memory out) {
        uint256[] storage ids = bettorRaceIds[bettor];
        uint256 idx = nextClaimIndex[bettor];
        if (idx >= ids.length) return out;

        for (uint256 i = idx; i < ids.length; i++) {
            uint256 rid = ids[i];
            Bet storage b = bets[rid][bettor];
            if (b.amount == 0 || b.claimed) continue;

            Race storage r = races[rid];
            if (!r.settled) continue;
            if (!_isWinner(r, b.lane)) continue;

            // Payout with dead heat division
            uint256 p = (uint256(b.amount) * uint256(r.decimalOddsBps[b.lane])) / ODDS_SCALE;
            p = p / uint256(r.deadHeatCount);

            out.hasClaim = true;
            out.raceId = rid;
            out.status = 3;
            out.betLane = b.lane;
            out.betTokenId = raceGiraffes[rid].tokenIds[b.lane];
            out.betAmount = b.amount;
            out.winner = r.winner;
            out.payout = p;
            out.closeBlock = r.closeBlock;
            return out;
        }
    }

    /**
     * @notice UI helper: preview what `claim()` would do next for `bettor`.
     * @dev `status` meanings:
     * 0 = next bet exists but would revert if claimed now (race not ready OR blockhash unavailable)
     * 1 = next bet exists and `claim()` would first settle the race (high gas), then resolve this bet
     * 2 = next bet exists, race is settled, bet lost (claim would resolve to 0)
     * 3 = next bet exists, race is settled, bet won (payout shown; for dead heats, payout is divided)
     */
    function getNextClaim(address bettor)
        external
        view
        returns (NextClaimView memory out)
    {
        uint256[] storage ids = bettorRaceIds[bettor];
        uint256 idx = nextClaimIndex[bettor];
        if (idx >= ids.length) return out;

        while (idx < ids.length) {
            uint256 rid = ids[idx];
            Bet storage b = bets[rid][bettor];
            if (b.amount == 0 || b.claimed) {
                idx++;
                continue;
            }

            Race storage r = races[rid];
            uint64 cb = r.closeBlock;

            if (!r.settled) {
                // Would `claim()` be able to settle right now?
                bool ready = cb != 0 && block.number > cb;
                bool bhLikelyAvailable = ready && (block.number - cb) <= 256;
                uint8 s = bhLikelyAvailable ? 1 : 0;
                out.hasClaim = true;
                out.raceId = rid;
                out.status = s;
                out.betLane = b.lane;
                out.betTokenId = raceGiraffes[rid].tokenIds[b.lane];
                out.betAmount = b.amount;
                out.winner = 0;
                out.payout = 0;
                out.closeBlock = cb;
                return out;
            }

            uint8 w = r.winner;
            // Use _isWinner to support dead heat (multiple winners)
            if (!_isWinner(r, b.lane)) {
                out.hasClaim = true;
                out.raceId = rid;
                out.status = 2;
                out.betLane = b.lane;
                out.betTokenId = raceGiraffes[rid].tokenIds[b.lane];
                out.betAmount = b.amount;
                out.winner = w;
                out.payout = 0;
                out.closeBlock = cb;
                return out;
            }

            // Winner payout with dead heat division
            uint256 p = (uint256(b.amount) * uint256(r.decimalOddsBps[b.lane])) / ODDS_SCALE;
            p = p / uint256(r.deadHeatCount);
            
            out.hasClaim = true;
            out.raceId = rid;
            out.status = 3;
            out.betLane = b.lane;
            out.betTokenId = raceGiraffes[rid].tokenIds[b.lane];
            out.betAmount = b.amount;
            out.winner = w;
            out.payout = p;
            out.closeBlock = cb;
            return out;
        }

        return out;
    }

    function _submissionCloseBlock(uint64 bettingCloseBlock) internal pure returns (uint64) {
        // bettingCloseBlock is validated at creation to be >= SUBMISSION_CLOSE_OFFSET_BLOCKS.
        return bettingCloseBlock - SUBMISSION_CLOSE_OFFSET_BLOCKS;
    }

    /// @dev Check if a lane is among the winners (supports dead heat).
    function _isWinner(Race storage r, uint8 lane) internal view returns (bool) {
        for (uint8 i = 0; i < r.deadHeatCount; i++) {
            if (r.winners[i] == lane) return true;
        }
        return false;
    }

    function _ensureGiraffesFinalized(uint256 raceId) internal {
        Race storage r = races[raceId];
        if (r.giraffesFinalized) return;

        uint64 submissionCloseBlock = _submissionCloseBlock(r.closeBlock);
        if (block.number < submissionCloseBlock) revert BettingNotOpen();

        _finalizeGiraffes(raceId);
    }

    function _finalizeGiraffes(uint256 raceId) internal {
        Race storage r = races[raceId];
        uint64 submissionCloseBlock = _submissionCloseBlock(r.closeBlock);

        // We use (submissionCloseBlock - 1) so the hash is available starting at submissionCloseBlock.
        bytes32 bh = blockhash(uint256(submissionCloseBlock - 1));
        if (bh == bytes32(0)) revert BlockhashUnavailable();

        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 fillSeed = keccak256(abi.encodePacked(baseSeed, "HOUSE_FILL"));

        _finalizeGiraffesFromPool(raceId, fillSeed);

        // Snapshot effective score for each lane at finalization time.
        RaceGiraffes storage raSnapshot = raceGiraffes[raceId];
        for (uint8 lane = 0; lane < LANE_COUNT; lane++) {
            (uint8 r0, uint8 c0, uint8 s0) = giraffeNft.statsOf(raSnapshot.tokenIds[lane]);
            // Defensive clamps (GiraffeNFT should already return 1..10).
            if (r0 == 0) r0 = 10;
            if (r0 > 10) r0 = 10;
            if (r0 < 1) r0 = 1;
            if (c0 == 0) c0 = 10;
            if (c0 > 10) c0 = 10;
            if (c0 < 1) c0 = 1;
            if (s0 == 0) s0 = 10;
            if (s0 > 10) s0 = 10;
            if (s0 < 1) s0 = 1;

            // Equally-weighted average of the 3 stats, rounded to nearest integer.
            uint16 sum = uint16(r0) + uint16(c0) + uint16(s0); // 3..30
            uint8 score = uint8((uint256(sum) + 1) / 3);
            if (score < 1) score = 1;
            if (score > 10) score = 10;
            raceScore[raceId][lane] = score;
        }

        // Auto-quote fixed odds from the effective score snapshot (lookup table), so no extra tx is required.
        _autoSetOddsFromScore(raceId);
        r.giraffesFinalized = true;

        RaceGiraffes storage ra = raceGiraffes[raceId];
        for (uint8 lane = 0; lane < LANE_COUNT; lane++) {
            emit GiraffeAssigned(raceId, ra.tokenIds[lane], ra.originalOwners[lane], lane);
        }
    }

    function _autoSetOddsFromScore(uint256 raceId) internal {
        Race storage r = races[raceId];
        if (r.oddsSet) return;

        uint8[LANE_COUNT] memory scores = raceScore[raceId];

        // If no probability table is set, fall back to fixed odds
        if (address(winProbTable) == address(0)) {
            for (uint8 lane = 0; lane < LANE_COUNT; lane++) {
                r.decimalOddsBps[lane] = TEMP_FIXED_DECIMAL_ODDS_BPS;
            }
            r.oddsSet = true;
            emit RaceOddsSet(raceId, r.decimalOddsBps);
            return;
        }

        // Get win probabilities from the on-chain table (handles sorting internally)
        uint16[LANE_COUNT] memory probsBps = winProbTable.get(scores);

        // Symmetry fix: if multiple lanes have the same score, their true win probability is identical.
        // The lookup table is Monte Carlo-estimated, so those positions can differ slightly; we set each
        // equal-score group to the same rounded average (guarantees identical odds for identical score).
        uint16[LANE_COUNT] memory probsAdj = probsBps;
        
        // Group lanes by score and average their probabilities
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            uint256 sum = uint256(probsBps[i]);
            uint8 count = 1;
            
            // Find all lanes with the same score
            for (uint8 j = 0; j < LANE_COUNT; j++) {
                if (j != i && scores[j] == scores[i]) {
                    sum += uint256(probsBps[j]);
                    count++;
                }
            }
            
            // Average the probabilities for this score group
            if (count > 1) {
                probsAdj[i] = uint16((sum + (count / 2)) / count);
            }
        }

        // Convert probabilities to decimal odds with house edge
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            uint16 p = probsAdj[i];
            if (p == 0) p = 1; // defensive: avoid division by zero
            
            // Decimal odds formula: (1 - houseEdge) / probability
            // In basis points: (ODDS_SCALE * (ODDS_SCALE - houseEdgeBps)) / p
            uint256 o = (uint256(ODDS_SCALE) * uint256(ODDS_SCALE - houseEdgeBps)) / uint256(p);
            
            // Apply minimum odds floor
            if (o < MIN_DECIMAL_ODDS_BPS) o = MIN_DECIMAL_ODDS_BPS;
            
            r.decimalOddsBps[i] = uint32(o);
        }

        r.oddsSet = true;
        emit RaceOddsSet(raceId, r.decimalOddsBps);
    }

    function _finalizeGiraffesFromPool(uint256 raceId, bytes32 fillSeed) internal {
        // Reset any previous lane data (should be empty before settle, but be safe).
        delete raceGiraffes[raceId];
        RaceGiraffes storage ra = raceGiraffes[raceId];

        // Deterministically shuffle/select pool entrants + house giraffes per race using independent entropy.
        DeterministicDice.Dice memory dice = DeterministicDice.create(fillSeed);

        uint8[LANE_COUNT] memory availableIdx = [0, 1, 2, 3, 4, 5];
        uint8 availableCount = LANE_COUNT;

        RaceEntry[] storage entries = raceEntries[raceId];
        uint256 n = entries.length;

        // Build a list of "valid" entrants (still owned by submitter at settlement time).
        uint256[] memory validIdx = new uint256[](n);
        uint256 validCount = 0;
        for (uint256 i = 0; i < n; i++) {
            RaceEntry storage e = entries[i];
            if (giraffeNft.ownerOf(e.tokenId) == e.submitter) {
                validIdx[validCount++] = i;
            }
        }

        // Select racers:
        // - If <= 4 valid entrants, take them all (in submission order).
        // - If > 4 valid entrants, draw 4 without replacement using dice.
        if (validCount <= LANE_COUNT) {
            uint8 lane = 0;
            for (uint256 i = 0; i < n && lane < LANE_COUNT; i++) {
                RaceEntry storage e = entries[i];
                if (giraffeNft.ownerOf(e.tokenId) == e.submitter) {
                    ra.tokenIds[lane] = e.tokenId;
                    ra.originalOwners[lane] = e.submitter;
                    lane++;
                }
            }
            ra.assignedCount = lane;
        } else {
            for (uint8 lane = 0; lane < LANE_COUNT; lane++) {
                uint256 remaining = validCount - uint256(lane);
                (uint256 pick, DeterministicDice.Dice memory updatedDice) = dice.roll(remaining);
                dice = updatedDice;

                uint256 chosenPos = uint256(lane) + pick;
                uint256 entryIdx = validIdx[chosenPos];
                // swap-remove within the tail of validIdx
                validIdx[chosenPos] = validIdx[uint256(lane)];
                validIdx[uint256(lane)] = entryIdx;

                RaceEntry storage e = entries[entryIdx];
                ra.tokenIds[lane] = e.tokenId;
                ra.originalOwners[lane] = e.submitter;
            }
            ra.assignedCount = LANE_COUNT;
        }

        // Fill remaining lanes with house giraffes (deterministically randomized, no repeats).
        for (uint8 lane = ra.assignedCount; lane < LANE_COUNT; lane++) {
            if (availableCount == 0) revert InvalidHouseGiraffe();
            (uint256 pick, DeterministicDice.Dice memory updatedDice) = dice.roll(availableCount);
            dice = updatedDice;

            uint8 idx = availableIdx[uint8(pick)];
            availableCount--;
            availableIdx[uint8(pick)] = availableIdx[availableCount];

            uint256 houseTokenId = houseGiraffeTokenIds[idx];
            if (giraffeNft.ownerOf(houseTokenId) != treasuryOwner) revert InvalidHouseGiraffe();

            ra.tokenIds[lane] = houseTokenId;
            ra.originalOwners[lane] = treasuryOwner;
            emit HouseGiraffeAssigned(raceId, houseTokenId, lane);
        }

        ra.assignedCount = LANE_COUNT;
    }

    // (Simulation logic moved to `GiraffeRaceSimulator` to stay under the 24KB EIP-170 size limit.)
}

