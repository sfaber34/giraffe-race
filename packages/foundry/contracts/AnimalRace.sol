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

    struct NextClaimView {
        bool hasClaim;
        uint256 raceId;
        uint8 status;
        uint8 betAnimal;
        uint256 betTokenId;
        uint128 betAmount;
        uint8 winner;
        uint256 payout;
        uint64 closeBlock;
    }

    uint256 public nextRaceId;
    mapping(uint256 => Race) private races;
    mapping(uint256 => mapping(address => Bet)) private bets;
    mapping(uint256 => RaceAnimals) private raceAnimals;
    mapping(uint256 => mapping(address => bool)) private hasSubmittedAnimal;
    mapping(uint256 => RaceEntry[]) private raceEntries;
    mapping(uint256 => mapping(uint256 => bool)) private tokenEntered;

    // Per-user list of races they participated in (one bet per race).
    mapping(address => uint256[]) private bettorRaceIds;
    // Next index in `bettorRaceIds[msg.sender]` to resolve/claim.
    mapping(address => uint256) private nextClaimIndex;

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

    error InvalidRace();
    error NoClaimableBets();
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
    error AnimalsAlreadyFinalized();
    error PreviousRaceNotSettled();

    constructor(address _animalNft, address _house, uint256[ANIMAL_COUNT] memory _houseAnimalTokenIds) {
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

    function placeBet(uint8 animal) external payable {
        if (animal >= ANIMAL_COUNT) revert InvalidAnimal();

        uint256 raceId = _activeRaceId();
        Race storage r = races[raceId];
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

        bettorRaceIds[msg.sender].push(raceId);
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
    function submitAnimal(uint256 tokenId) external {
        // "Presence starts the race": if there is no active race (none yet, or latest is settled),
        // create a new one with the fixed schedule.
        if (nextRaceId == 0 || races[nextRaceId - 1].settled) {
            _createRace();
        }

        uint256 raceId = _activeRaceId();
        Race storage r = races[raceId];
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
    function finalizeRaceAnimals() external {
        uint256 raceId = _activeRaceId();
        Race storage r = races[raceId];
        if (r.settled) revert AlreadySettled();
        if (r.animalsFinalized) revert AnimalsAlreadyFinalized();

        uint64 submissionCloseBlock = _submissionCloseBlock(r.closeBlock);
        if (block.number < submissionCloseBlock) revert BettingNotOpen();

        _finalizeAnimals(raceId);
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

    /// @notice Resolve the caller's next unsettled bet (winner pays out, loser resolves to 0).
    /// @dev This avoids needing a `raceId` parameter while still supporting claims from older races.
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
            if (b.animal != r.winner) {
                emit Claimed(raceId, msg.sender, 0);
                return 0;
            }

            uint256 winnersTotal = r.totalOnAnimal[r.winner];
            payout = winnersTotal == 0 ? 0 : (r.totalPot * uint256(b.amount)) / winnersTotal;

            (bool ok,) = msg.sender.call{value: payout}("");
            if (!ok) revert TransferFailed();

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
            if (b.animal != r.winner) {
                b.claimed = true;
                idx++;
                nextClaimIndex[msg.sender] = idx;
                continue;
            }

            // Winner: pay out.
            b.claimed = true;
            nextClaimIndex[msg.sender] = idx + 1;

            uint256 winnersTotal = r.totalOnAnimal[r.winner];
            payout = winnersTotal == 0 ? 0 : (r.totalPot * uint256(b.amount)) / winnersTotal;

            (bool ok,) = msg.sender.call{value: payout}("");
            if (!ok) revert TransferFailed();

            emit Claimed(raceId, msg.sender, payout);
            return payout;
        }

        nextClaimIndex[msg.sender] = ids.length;
        revert NoClaimableBets();
    }

    // -----------------------
    // Views (for UI / replay)
    // -----------------------

    function getRace()
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
        uint256 raceId = latestRaceId();
        Race storage r = races[raceId];
        return (r.closeBlock, r.settled, r.winner, r.seed, r.totalPot, r.totalOnAnimal);
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
            uint256[4] memory totalOnAnimal
        )
    {
        Race storage r = races[raceId];
        return (r.closeBlock, r.settled, r.winner, r.seed, r.totalPot, r.totalOnAnimal);
    }

    function getBet(address bettor) external view returns (uint128 amount, uint8 animal, bool claimed) {
        uint256 raceId = latestRaceId();
        Bet storage b = bets[raceId][bettor];
        return (b.amount, b.animal, b.claimed);
    }

    /// @notice Read the bet for a specific race id (UI helper for browsing history).
    function getBetById(uint256 raceId, address bettor) external view returns (uint128 amount, uint8 animal, bool claimed) {
        Bet storage b = bets[raceId][bettor];
        return (b.amount, b.animal, b.claimed);
    }

    function getRaceAnimals()
        external
        view
        returns (
            uint8 assignedCount,
            uint256[4] memory tokenIds,
            address[4] memory originalOwners
        )
    {
        uint256 raceId = latestRaceId();

        RaceAnimals storage ra = raceAnimals[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners);
    }

    /// @notice Read lane assignments for a specific race id (UI helper for browsing history / replay).
    function getRaceAnimalsById(uint256 raceId)
        external
        view
        returns (
            uint8 assignedCount,
            uint256[4] memory tokenIds,
            address[4] memory originalOwners
        )
    {
        RaceAnimals storage ra = raceAnimals[raceId];
        return (ra.assignedCount, ra.tokenIds, ra.originalOwners);
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
            if (b.animal != r.winner) continue;

            remaining++;
        }
    }

    /// @notice UI helper: preview the caller's next *winning payout* (settled wins only).
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
            if (b.animal != r.winner) continue;

            uint256 winnersTotal = r.totalOnAnimal[r.winner];
            uint256 p = winnersTotal == 0 ? 0 : (r.totalPot * uint256(b.amount)) / winnersTotal;

            out.hasClaim = true;
            out.raceId = rid;
            out.status = 3;
            out.betAnimal = b.animal;
            out.betTokenId = raceAnimals[rid].tokenIds[b.animal];
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
     * 3 = next bet exists, race is settled, bet won (payout shown)
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
                out.betAnimal = b.animal;
                out.betTokenId = raceAnimals[rid].tokenIds[b.animal];
                out.betAmount = b.amount;
                out.winner = 0;
                out.payout = 0;
                out.closeBlock = cb;
                return out;
            }

            uint8 w = r.winner;
            if (b.animal != w) {
                out.hasClaim = true;
                out.raceId = rid;
                out.status = 2;
                out.betAnimal = b.animal;
                out.betTokenId = raceAnimals[rid].tokenIds[b.animal];
                out.betAmount = b.amount;
                out.winner = w;
                out.payout = 0;
                out.closeBlock = cb;
                return out;
            }

            uint256 winnersTotal = r.totalOnAnimal[w];
            uint256 p = winnersTotal == 0 ? 0 : (r.totalPot * uint256(b.amount)) / winnersTotal;
            out.hasClaim = true;
            out.raceId = rid;
            out.status = 3;
            out.betAnimal = b.animal;
            out.betTokenId = raceAnimals[rid].tokenIds[b.animal];
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

