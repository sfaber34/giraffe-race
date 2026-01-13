// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { DeterministicDice } from "./libraries/DeterministicDice.sol";
import { IERC721 } from "../lib/openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "../lib/openzeppelin-contracts/contracts/token/ERC721/IERC721Receiver.sol";

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
contract AnimalRace is IERC721Receiver {
    using DeterministicDice for DeterministicDice.Dice;

    uint8 public constant ANIMAL_COUNT = 4;
    uint16 public constant TRACK_LENGTH = 1000;
    uint16 public constant MAX_TICKS = 500;
    uint8 public constant SPEED_RANGE = 10; // speeds per tick: 1-10

    address public owner;
    address public house;
    IERC721 public animalNft;

    struct Race {
        uint64 closeBlock;
        bool settled;
        uint8 winner; // 0-3, valid only if settled
        bytes32 seed; // stored on settlement for later verification
        uint256 totalPot;
        uint256[4] totalOnAnimal;
    }

    struct RaceAnimals {
        // Number of lanes that have been assigned tokenIds (user submissions + house auto-fill).
        uint8 assignedCount;
        // Token ID for each lane (0..3). 0 means unassigned (valid tokenIds start at 1 in our AnimalNFT).
        uint256[4] tokenIds;
        // Original owner for each lane (who can withdraw if escrowed).
        address[4] originalOwners;
        // Whether the NFT is escrowed in this contract (true for user submissions).
        bool[4] escrowed;
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

    // Fixed pool of house animals used to auto-fill empty lanes.
    // These are NOT escrowed by default (no approvals required); we just reference them as house-owned racers.
    uint256[4] public houseAnimalTokenIds;

    event RaceCreated(uint256 indexed raceId, uint64 closeBlock);
    event BetPlaced(uint256 indexed raceId, address indexed bettor, uint8 indexed animal, uint256 amount);
    event RaceSettled(uint256 indexed raceId, bytes32 seed, uint8 winner);
    event Claimed(uint256 indexed raceId, address indexed bettor, uint256 payout);
    event AnimalSubmitted(uint256 indexed raceId, address indexed owner, uint256 indexed tokenId, uint8 lane);
    event HouseAnimalAssigned(uint256 indexed raceId, uint256 indexed tokenId, uint8 lane);
    event AnimalWithdrawn(uint256 indexed raceId, address indexed owner, uint256 indexed tokenId, uint8 lane);

    error NotOwner();
    error InvalidRace();
    error BettingClosed();
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
    error RaceFull();
    error AlreadySubmitted();
    error InvalidHouseAnimal();
    error NotOriginalOwner();
    error AnimalNotEscrowed();
    error AnimalNotAssigned();

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

    /// @notice Convenience: create a race that closes 10 blocks from now.
    function createRace() external onlyOwner returns (uint256 raceId) {
        return _createRace(uint64(block.number + 10));
    }

    /// @notice Create a race with an explicit close block.
    function createRace(uint64 closeBlock) external onlyOwner returns (uint256 raceId) {
        return _createRace(closeBlock);
    }

    function _createRace(uint64 closeBlock) internal returns (uint256 raceId) {
        if (closeBlock <= block.number) revert BettingClosed();

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

        if (msg.value == 0) revert ZeroBet();

        Bet storage b = bets[raceId][msg.sender];
        if (b.amount != 0) revert AlreadyBet();

        b.amount = uint128(msg.value);
        b.animal = animal;

        r.totalPot += msg.value;
        r.totalOnAnimal[animal] += msg.value;

        emit BetPlaced(raceId, msg.sender, animal, msg.value);
    }

    /**
     * @notice Submit one of your AnimalNFTs to race in the next open lane.
     * @dev Escrows the NFT into this contract via safeTransferFrom; user can withdraw it after settlement.
     */
    function submitAnimal(uint256 raceId, uint256 tokenId) external {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        if (block.number >= r.closeBlock) revert BettingClosed();
        if (r.settled) revert AlreadySettled();

        if (hasSubmittedAnimal[raceId][msg.sender]) revert AlreadySubmitted();

        RaceAnimals storage ra = raceAnimals[raceId];
        uint8 lane = ra.assignedCount;
        if (lane >= ANIMAL_COUNT) revert RaceFull();

        // Mark submission before external call; tx reverts if transfer fails.
        hasSubmittedAnimal[raceId][msg.sender] = true;
        ra.assignedCount = lane + 1;
        ra.tokenIds[lane] = tokenId;
        ra.originalOwners[lane] = msg.sender;
        ra.escrowed[lane] = true;

        animalNft.safeTransferFrom(msg.sender, address(this), tokenId);

        emit AnimalSubmitted(raceId, msg.sender, tokenId, lane);
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
        bytes32 fillSeed = keccak256(abi.encodePacked(baseSeed, "HOUSE_FILL"));
        bytes32 simSeed = keccak256(abi.encodePacked(baseSeed, "RACE_SIM"));

        _assignHouseAnimalsIfNeeded(raceId, fillSeed);
        (uint8 w,) = _simulate(simSeed);

        r.settled = true;
        r.winner = w;
        // Store the simulation seed so the race can be replayed off-chain.
        r.seed = simSeed;

        emit RaceSettled(raceId, simSeed, r.winner);
    }

    /**
     * @notice Withdraw your escrowed AnimalNFT from a settled race.
     * @dev We use transferFrom (not safeTransferFrom) so settlement/withdrawals can't be blocked by contracts
     *      that don't implement IERC721Receiver.
     */
    function withdrawAnimal(uint256 raceId, uint8 lane) external {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();
        if (!r.settled) revert NotSettled();
        if (lane >= ANIMAL_COUNT) revert InvalidAnimal();

        RaceAnimals storage ra = raceAnimals[raceId];
        uint256 tokenId = ra.tokenIds[lane];
        if (tokenId == 0) revert AnimalNotAssigned();
        if (!ra.escrowed[lane]) revert AnimalNotEscrowed();
        if (ra.originalOwners[lane] != msg.sender) revert NotOriginalOwner();

        // Mark as no longer escrowed before external call.
        ra.escrowed[lane] = false;

        animalNft.transferFrom(address(this), msg.sender, tokenId);

        emit AnimalWithdrawn(raceId, msg.sender, tokenId, lane);
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
            address[4] memory originalOwners,
            bool[4] memory escrowed
        )
    {
        Race storage r = races[raceId];
        if (r.closeBlock == 0) revert InvalidRace();

        RaceAnimals storage ra = raceAnimals[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners, ra.escrowed);
    }

    function _assignHouseAnimalsIfNeeded(uint256 raceId, bytes32 fillSeed) internal {
        RaceAnimals storage ra = raceAnimals[raceId];
        if (ra.assignedCount >= ANIMAL_COUNT) return;

        // Deterministically shuffle/select house animals per race using independent entropy.
        DeterministicDice.Dice memory dice = DeterministicDice.create(fillSeed);

        uint8[4] memory availableIdx = [0, 1, 2, 3];
        uint8 availableCount = 4;

        while (ra.assignedCount < ANIMAL_COUNT) {
            uint8 lane = ra.assignedCount;

            (uint256 pick, DeterministicDice.Dice memory updatedDice) = dice.roll(availableCount);
            dice = updatedDice;

            uint8 idx = availableIdx[uint8(pick)];
            // remove idx from pool (swap-remove)
            availableCount--;
            availableIdx[uint8(pick)] = availableIdx[availableCount];

            uint256 tokenId = houseAnimalTokenIds[idx];

            // House animals must still be owned by `house` at settlement time.
            // We don't escrow them (no approvals needed); they are trusted protocol-provided racers.
            if (animalNft.ownerOf(tokenId) != house) revert InvalidHouseAnimal();

            ra.assignedCount = lane + 1;
            ra.tokenIds[lane] = tokenId;
            ra.originalOwners[lane] = house;
            ra.escrowed[lane] = false;

            emit HouseAnimalAssigned(raceId, tokenId, lane);
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
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

