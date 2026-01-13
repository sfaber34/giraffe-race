// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { DeterministicDice } from "./libraries/DeterministicDice.sol";
import { IERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

/**
 * @title AnimalRace
 * @notice Simple on-chain betting game: 4 identical animals, winner picked deterministically from a seed.
 * @dev v1: single bet per address per race, parimutuel payout (winners split the pot pro-rata).
 *
 * Seed (v1) is derived from a future blockhash:
 *   seed = keccak256(abi.encodePacked(blockhash(closeBlock), raceId, address(this)))
 *
 * NOTE: `blockhash(closeBlock)` is only available for the most recent ~256 blocks,
 * so `settleRace` must be called soon after `closeBlock`.
 */
contract AnimalRace {
    using DeterministicDice for DeterministicDice.Dice;

    uint8 public constant ANIMAL_COUNT = 4;
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

    address public owner;
    address public house;
    IERC721 public animalNft;

    struct Race {
        // Betting close block (formerly "closeBlock" in v1).
        uint64 closeBlock;
        // Lane lineup finalized from entrant pool + house fill.
        bool animalsFinalized;
        bool settled;
        uint8 winner; // 0-3, valid only if settled
        bytes32 seed; // stored on settlement for later verification
        uint256 totalPot;
        uint256[4] totalOnAnimal;
    }

    struct RaceAnimals {
        // Number of lanes that have been assigned tokenIds (selected entrants + house fill).
        uint8 assignedCount;
        // Token ID for each lane (0..3). 0 means unassigned (valid tokenIds start at 1 in our AnimalNFT).
        uint256[4] tokenIds;
        // The owner snapshot for each lane at the time the entrant was selected (or `house` for house fill).
        address[4] originalOwners;
    }

    struct RaceEntry {
        uint256 tokenId;
        address submitter;
    }

    struct Bet {
        uint128 amount;
        uint8 animal; // 0-3
        bool claimed;
    }

    uint256 public nextRaceId;
    mapping(uint256 => Race) private races;
    mapping(uint256 => mapping(address => Bet)) private bets;
    mapping(uint256 => RaceAnimals) private raceAnimals;
    mapping(uint256 => mapping(address => bool)) private hasSubmittedAnimal;
    mapping(uint256 => RaceEntry[]) private raceEntries;
    mapping(uint256 => mapping(uint256 => bool)) private tokenEntered;

    // Fixed pool of house animals used to auto-fill empty lanes.
    // These are NOT escrowed by default (no approvals required); we just reference them as house-owned racers.
    uint256[4] public houseAnimalTokenIds;

    event RaceCreated(uint256 indexed raceId, uint64 closeBlock);
    event BetPlaced(uint256 indexed raceId, address indexed bettor, uint8 indexed animal, uint256 amount);
    event RaceSettled(uint256 indexed raceId, bytes32 seed, uint8 winner);
    event Claimed(uint256 indexed raceId, address indexed bettor, uint256 payout);
    event AnimalSubmitted(uint256 indexed raceId, address indexed owner, uint256 indexed tokenId, uint8 lane);
    event AnimalAssigned(uint256 indexed raceId, uint256 indexed tokenId, address indexed originalOwner, uint8 lane);
    event HouseAnimalAssigned(uint256 indexed raceId, uint256 indexed tokenId, uint8 lane);

    error NotOwner();
    error InvalidRace();
    error BettingClosed();
    error BettingNotOpen();
    error SubmissionsClosed();
    error AlreadyBet();
    error InvalidAnimal();
    error ZeroBet();
    error AlreadySettled();
    error NotSettled();
    error BlockhashUnavailable();
    error RaceNotReady();
    error NotWinner();
    error AlreadyClaimed();
    error TransferFailed();
    error AlreadySubmitted();
    error InvalidHouseAnimal();
    error AnimalNotAssigned();
    error NotTokenOwner();
    error TokenAlreadyEntered();
    error EntryPoolFull();
    error InvalidCloseBlock();
    error AnimalsAlreadyFinalized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _animalNft, address _house, uint256[ANIMAL_COUNT] memory _houseAnimalTokenIds) {
        owner = _owner;
        animalNft = IERC721(_animalNft);
        house = _house;
        houseAnimalTokenIds = _houseAnimalTokenIds;

        // Basic sanity: prevent accidental all-zeros configuration.
        for (uint256 i = 0; i < ANIMAL_COUNT; i++) {
            if (_houseAnimalTokenIds[i] == 0) revert InvalidHouseAnimal();
        }
    }

    function animalCount() external pure returns (uint8) {
        return ANIMAL_COUNT;
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

    /**
     * @notice Deterministically simulate a race from a seed.
     * @dev Pure function so it can be re-run off-chain for verification / animation.
     * @return winner The winning animal index (0-3)
     * @return distances Final distances after all ticks (units are arbitrary)
     */
    function simulate(bytes32 seed) external pure returns (uint8 winner, uint16[ANIMAL_COUNT] memory distances) {
        return _simulate(seed);
    }

    /// @notice Convenience: create a race that closes 20 blocks from now.
    function createRace() external onlyOwner returns (uint256 raceId) {
        return _createRace(uint64(block.number + DEFAULT_BETTING_CLOSE_OFFSET_BLOCKS));
    }

    /// @notice Create a race with an explicit close block.
    function createRace(uint64 closeBlock) external onlyOwner returns (uint256 raceId) {
        return _createRace(closeBlock);
    }

    function _createRace(uint64 closeBlock) internal returns (uint256 raceId) {
        // Need at least SUBMISSION_CLOSE_OFFSET_BLOCKS blocks between creation and submission close,
        // and another SUBMISSION_CLOSE_OFFSET_BLOCKS blocks between submission close and betting close.
        // (With the current constants, that's 20 blocks total.)
        if (closeBlock <= block.number) revert InvalidCloseBlock();
        if (closeBlock < uint64(block.number) + DEFAULT_BETTING_CLOSE_OFFSET_BLOCKS) revert InvalidCloseBlock();

        raceId = nextRaceId++;
        Race storage r = races[raceId];
        r.closeBlock = closeBlock;

        emit RaceCreated(raceId, closeBlock);
    }

    function placeBet(uint256 raceId, uint8 animal) external payable {
        if (animal >= ANIMAL_COUNT) revert InvalidAnimal();

        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        if (block.number >= r.closeBlock) revert BettingClosed();
        if (block.number < _submissionCloseBlock(r.closeBlock)) revert BettingNotOpen();

        if (msg.value == 0) revert ZeroBet();

        // Ensure the lane lineup is finalized before accepting bets (so bettors can see who is racing).
        _ensureAnimalsFinalized(raceId);

        Bet storage b = bets[raceId][msg.sender];
        if (b.amount != 0) revert AlreadyBet();

        b.amount = uint128(msg.value);
        b.animal = animal;

        r.totalPot += msg.value;
        r.totalOnAnimal[animal] += msg.value;

        emit BetPlaced(raceId, msg.sender, animal, msg.value);
    }

    /**
     * @notice Submit one of your AnimalNFTs into the race's entrant pool (non-custodial).
     * @dev If <= 4 total entrants submit, all valid entrants race.
     *      If > 4 submit, we deterministically draw 4 valid entrants at settlement.
     *
     *      "Valid" at settlement time means the current owner still matches the original submitter.
     *      If an entrant becomes invalid (transferred away), they're treated as a no-show.
     */
    function submitAnimal(uint256 raceId, uint256 tokenId) external {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        // Submissions close earlier than betting.
        if (block.number >= _submissionCloseBlock(r.closeBlock)) revert SubmissionsClosed();
        if (r.settled) revert AlreadySettled();

        if (hasSubmittedAnimal[raceId][msg.sender]) revert AlreadySubmitted();
        if (animalNft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        // Prevent users from submitting one of the reserved house animals.
        for (uint256 i = 0; i < ANIMAL_COUNT; i++) {
            if (houseAnimalTokenIds[i] == tokenId) revert InvalidHouseAnimal();
        }
        if (tokenEntered[raceId][tokenId]) revert TokenAlreadyEntered();
        if (raceEntries[raceId].length >= MAX_ENTRIES_PER_RACE) revert EntryPoolFull();

        // Mark submission before external call; tx reverts if transfer fails.
        hasSubmittedAnimal[raceId][msg.sender] = true;
        tokenEntered[raceId][tokenId] = true;
        raceEntries[raceId].push(RaceEntry({ tokenId: tokenId, submitter: msg.sender }));

        // Lane isn't determined until settlement; emit 255 to mean "pool entry".
        emit AnimalSubmitted(raceId, msg.sender, tokenId, type(uint8).max);
    }

    /**
     * @notice Finalize the race lineup (which tokenIds are in which lanes) after submissions close.
     * @dev Anyone can call this. Once finalized, the lane lineup is stable and can be shown in the UI
     *      during the betting window.
     *
     *      Entropy uses `blockhash(submissionCloseBlock - 1)` so it's available starting at
     *      `submissionCloseBlock` (the first block where submissions are closed).
     */
    function finalizeRaceAnimals(uint256 raceId) external {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        if (r.settled) revert AlreadySettled();
        if (r.animalsFinalized) revert AnimalsAlreadyFinalized();

        uint64 submissionCloseBlock = _submissionCloseBlock(r.closeBlock);
        if (block.number < submissionCloseBlock) revert BettingNotOpen();

        _finalizeAnimals(raceId);
    }

    function settleRace(uint256 raceId) external {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        if (r.settled) revert AlreadySettled();
        if (block.number <= r.closeBlock) revert RaceNotReady();

        bytes32 bh = blockhash(r.closeBlock);
        if (bh == bytes32(0)) revert BlockhashUnavailable();

        // Derive independent seeds for independent decisions to avoid correlation.
        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 simSeed = keccak256(abi.encodePacked(baseSeed, "RACE_SIM"));

        // Make sure lineup is finalized (it should have been finalized during betting window,
        // but keep settlement robust).
        _ensureAnimalsFinalized(raceId);
        (uint8 w,) = _simulate(simSeed);

        r.settled = true;
        r.winner = w;
        // Store the simulation seed so the race can be replayed off-chain.
        r.seed = simSeed;

        emit RaceSettled(raceId, simSeed, r.winner);
    }

    function claim(uint256 raceId) external returns (uint256 payout) {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        if (!r.settled) revert NotSettled();

        Bet storage b = bets[raceId][msg.sender];
        if (b.amount == 0) revert ZeroBet();
        if (b.claimed) revert AlreadyClaimed();
        if (b.animal != r.winner) revert NotWinner();

        uint256 winnersTotal = r.totalOnAnimal[r.winner];
        // winnersTotal should be > 0 because caller bet on winner, but keep it safe.
        payout = winnersTotal == 0 ? 0 : (r.totalPot * uint256(b.amount)) / winnersTotal;

        b.claimed = true;

        (bool ok,) = msg.sender.call{ value: payout }("");
        if (!ok) revert TransferFailed();

        emit Claimed(raceId, msg.sender, payout);
    }

    // -----------------------
    // Views (for UI / replay)
    // -----------------------

    function getRace(uint256 raceId)
        external
        view
        returns (
            uint64 closeBlock,
            bool settled,
            uint8 winner,
            bytes32 seed,
            uint256 totalPot,
            uint256[4] memory totalOnAnimal
        )
    {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        return (r.closeBlock, r.settled, r.winner, r.seed, r.totalPot, r.totalOnAnimal);
    }

    function getBet(uint256 raceId, address bettor) external view returns (uint128 amount, uint8 animal, bool claimed) {
        Bet storage b = bets[raceId][bettor];
        return (b.amount, b.animal, b.claimed);
    }

    function getRaceAnimals(uint256 raceId)
        external
        view
        returns (
            uint8 assignedCount,
            uint256[4] memory tokenIds,
            address[4] memory originalOwners
        )
    {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();

        RaceAnimals storage ra = raceAnimals[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners);
    }

    function _submissionCloseBlock(uint64 bettingCloseBlock) internal pure returns (uint64) {
        // bettingCloseBlock is validated at creation to be >= SUBMISSION_CLOSE_OFFSET_BLOCKS.
        return bettingCloseBlock - SUBMISSION_CLOSE_OFFSET_BLOCKS;
    }

    function _ensureAnimalsFinalized(uint256 raceId) internal {
        Race storage r = races[raceId];
        if (r.animalsFinalized) return;

        uint64 submissionCloseBlock = _submissionCloseBlock(r.closeBlock);
        if (block.number < submissionCloseBlock) revert BettingNotOpen();

        _finalizeAnimals(raceId);
    }

    function _finalizeAnimals(uint256 raceId) internal {
        Race storage r = races[raceId];
        uint64 submissionCloseBlock = _submissionCloseBlock(r.closeBlock);

        // We use (submissionCloseBlock - 1) so the hash is available starting at submissionCloseBlock.
        bytes32 bh = blockhash(uint256(submissionCloseBlock - 1));
        if (bh == bytes32(0)) revert BlockhashUnavailable();

        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 fillSeed = keccak256(abi.encodePacked(baseSeed, "HOUSE_FILL"));

        _finalizeAnimalsFromPool(raceId, fillSeed);
        r.animalsFinalized = true;

        RaceAnimals storage ra = raceAnimals[raceId];
        for (uint8 lane = 0; lane < ANIMAL_COUNT; lane++) {
            emit AnimalAssigned(raceId, ra.tokenIds[lane], ra.originalOwners[lane], lane);
        }
    }

    function _finalizeAnimalsFromPool(uint256 raceId, bytes32 fillSeed) internal {
        // Reset any previous lane data (should be empty before settle, but be safe).
        delete raceAnimals[raceId];
        RaceAnimals storage ra = raceAnimals[raceId];

        // Deterministically shuffle/select pool entrants + house animals per race using independent entropy.
        DeterministicDice.Dice memory dice = DeterministicDice.create(fillSeed);

        uint8[4] memory availableIdx = [0, 1, 2, 3];
        uint8 availableCount = 4;

        RaceEntry[] storage entries = raceEntries[raceId];
        uint256 n = entries.length;

        // Build a list of "valid" entrants (still owned by submitter at settlement time).
        uint256[] memory validIdx = new uint256[](n);
        uint256 validCount = 0;
        for (uint256 i = 0; i < n; i++) {
            RaceEntry storage e = entries[i];
            if (animalNft.ownerOf(e.tokenId) == e.submitter) {
                validIdx[validCount++] = i;
            }
        }

        // Select racers:
        // - If <= 4 valid entrants, take them all (in submission order).
        // - If > 4 valid entrants, draw 4 without replacement using dice.
        if (validCount <= ANIMAL_COUNT) {
            uint8 lane = 0;
            for (uint256 i = 0; i < n && lane < ANIMAL_COUNT; i++) {
                RaceEntry storage e = entries[i];
                if (animalNft.ownerOf(e.tokenId) == e.submitter) {
                    ra.tokenIds[lane] = e.tokenId;
                    ra.originalOwners[lane] = e.submitter;
                    lane++;
                }
            }
            ra.assignedCount = lane;
        } else {
            for (uint8 lane = 0; lane < ANIMAL_COUNT; lane++) {
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
            ra.assignedCount = ANIMAL_COUNT;
        }

        // Fill remaining lanes with house animals (deterministically randomized, no repeats).
        for (uint8 lane = ra.assignedCount; lane < ANIMAL_COUNT; lane++) {
            if (availableCount == 0) revert InvalidHouseAnimal();
            (uint256 pick, DeterministicDice.Dice memory updatedDice) = dice.roll(availableCount);
            dice = updatedDice;

            uint8 idx = availableIdx[uint8(pick)];
            availableCount--;
            availableIdx[uint8(pick)] = availableIdx[availableCount];

            uint256 houseTokenId = houseAnimalTokenIds[idx];
            if (animalNft.ownerOf(houseTokenId) != house) revert InvalidHouseAnimal();

            ra.tokenIds[lane] = houseTokenId;
            ra.originalOwners[lane] = house;
            emit HouseAnimalAssigned(raceId, houseTokenId, lane);
        }

        ra.assignedCount = ANIMAL_COUNT;
    }

    function _simulate(bytes32 seed) internal pure returns (uint8 winner, uint16[4] memory distances) {
        DeterministicDice.Dice memory dice = DeterministicDice.create(seed);

        bool finished = false;

        for (uint256 t = 0; t < MAX_TICKS; t++) {
            for (uint256 a = 0; a < ANIMAL_COUNT; a++) {
                (uint256 r, DeterministicDice.Dice memory updatedDice) = dice.roll(SPEED_RANGE);
                dice = updatedDice;
                // speed in [1..SPEED_RANGE]
                distances[a] += uint16(r + 1);
            }

            // Check finish after each tick
            if (
                distances[0] >= TRACK_LENGTH || distances[1] >= TRACK_LENGTH || distances[2] >= TRACK_LENGTH
                    || distances[3] >= TRACK_LENGTH
            ) {
                finished = true;
                break;
            }
        }

        require(finished, "AnimalRace: race did not finish");

        // Find leaders
        uint16 best = distances[0];
        uint8 leaderCount = 1;
        uint8[4] memory leaders;
        leaders[0] = 0;

        for (uint8 i = 1; i < ANIMAL_COUNT; i++) {
            uint16 d = distances[i];
            if (d > best) {
                best = d;
                leaderCount = 1;
                leaders[0] = i;
            } else if (d == best) {
                leaders[leaderCount] = i;
                leaderCount++;
            }
        }

        if (leaderCount == 1) {
            return (leaders[0], distances);
        }

        // Deterministic tie-break
        (uint256 pick,) = dice.roll(leaderCount);
        return (leaders[uint8(pick)], distances);
    }
}

