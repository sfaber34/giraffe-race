// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "./diamond/libraries/GiraffeRaceStorage.sol";

/**
 * @title GiraffeRace
 * @notice Combined interface for the GiraffeRace Diamond
 * @dev This contract exists solely to generate a combined ABI for Scaffold-ETH 2.
 *      It is never deployed - the Diamond contract is deployed instead.
 *      All functions are marked external and have empty bodies to generate the ABI.
 */
interface IGiraffeRace {
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

    // ============ AdminFacet ============
    function setHouseEdgeBps(uint16 newEdgeBps) external;
    function setMaxBetAmount(uint256 newMaxBet) external;
    function setWinProbTable(address _winProbTable) external;
    function setRaceOdds(uint256 raceId, uint32[6] calldata decimalOddsBps) external;
    function treasuryOwner() external view returns (address);
    function houseEdgeBps() external view returns (uint16);
    function maxBetAmount() external view returns (uint256);
    function houseGiraffeTokenIds() external view returns (uint256[6] memory);

    // ============ RaceLifecycleFacet ============
    function createRace() external returns (uint256 raceId);
    function finalizeRaceGiraffes() external;
    function settleRace() external;
    function nextRaceId() external view returns (uint256);
    function latestRaceId() external view returns (uint256 raceId);
    function getActiveRaceIdOrZero() external view returns (uint256 raceId);
    function getCreateRaceCooldown() external view returns (bool canCreate, uint64 blocksRemaining, uint64 cooldownEndsAtBlock);

    // ============ BettingFacet ============
    function placeBet(uint8 lane, uint256 amount) external;
    function claim() external returns (uint256 payout);
    function claimNextWinningPayout() external returns (uint256 payout);
    function getBetById(uint256 raceId, address bettor) external view returns (uint128 amount, uint8 lane, bool claimed);
    function getClaimRemaining(address bettor) external view returns (uint256 remaining);
    function getWinningClaimRemaining(address bettor) external view returns (uint256 remaining);
    function getNextWinningClaim(address bettor) external view returns (GiraffeRaceStorage.NextClaimView memory out);
    function getNextClaim(address bettor) external view returns (GiraffeRaceStorage.NextClaimView memory out);
    function settledLiability() external view returns (uint256);

    // ============ GiraffeSubmissionFacet ============
    function submitGiraffe(uint256 tokenId) external;
    function getRaceEntryCount(uint256 raceId) external view returns (uint256);
    function hasSubmitted(uint256 raceId, address user) external view returns (bool);
    function isTokenEntered(uint256 raceId, uint256 tokenId) external view returns (bool);
    function getRaceEntry(uint256 raceId, uint256 index) external view returns (uint256 tokenId, address submitter);

    // ============ RaceViewsFacet ============
    function laneCount() external pure returns (uint8);
    function tickCount() external pure returns (uint16);
    function speedRange() external pure returns (uint8);
    function trackLength() external pure returns (uint16);
    function getRaceById(uint256 raceId) external view returns (
        uint64 bettingCloseBlock,
        bool settled,
        uint8 winner,
        bytes32 seed,
        uint256 totalPot,
        uint256[6] memory totalOnLane
    );
    function getRaceFlagsById(uint256 raceId) external view returns (bool settled, bool giraffesFinalized, bool oddsSet);
    function getRaceScheduleById(uint256 raceId) external view returns (uint64 bettingCloseBlock, uint64 submissionCloseBlock, uint64 settledAtBlock);
    function getRaceOddsById(uint256 raceId) external view returns (bool oddsSet, uint32[6] memory decimalOddsBps);
    function getRaceDeadHeatById(uint256 raceId) external view returns (uint8 deadHeatCount, uint8[6] memory winners);
    function getRaceActionabilityById(uint256 raceId) external view returns (
        bool canFinalizeNow,
        bool canSettleNow,
        uint64 bettingCloseBlock,
        uint64 submissionCloseBlock,
        uint64 finalizeEntropyBlock,
        uint64 finalizeBlockhashExpiresAt,
        uint64 settleBlockhashExpiresAt,
        uint64 blocksUntilFinalizeExpiry,
        uint64 blocksUntilSettleExpiry
    );
    function getRaceGiraffesById(uint256 raceId) external view returns (
        uint8 assignedCount,
        uint256[6] memory tokenIds,
        address[6] memory originalOwners
    );
    function getRaceScoreById(uint256 raceId) external view returns (uint8[6] memory score);
    function simulate(bytes32 seed) external view returns (uint8 winner, uint16[6] memory distances);
    function simulateWithScore(bytes32 seed, uint8[6] calldata score) external view returns (uint8 winner, uint16[6] memory distances);
    function giraffeNft() external view returns (address);
    function simulator() external view returns (address);
    function treasury() external view returns (address);
    function winProbTable() external view returns (address);

    // ============ DiamondLoupeFacet ============
    function facets() external view returns (address[] memory facetAddresses);
    function facetFunctionSelectors(address _facet) external view returns (bytes4[] memory facetFunctionSelectors_);
    function facetAddresses() external view returns (address[] memory facetAddresses_);
    function facetAddress(bytes4 _functionSelector) external view returns (address facetAddress_);
    function supportsInterface(bytes4 _interfaceId) external view returns (bool);

    // ============ DiamondCutFacet ============
    // Note: diamondCut is admin-only and complex, omitting from public interface
}

/**
 * @title GiraffeRace
 * @notice Abstract contract that generates combined ABI for all Diamond facets
 * @dev This contract is never deployed - it exists only for ABI generation.
 *      The actual deployment is the GiraffeRaceDiamond contract.
 */
abstract contract GiraffeRace is IGiraffeRace {
    // This contract intentionally has no implementation.
    // It exists solely to generate a combined ABI file for Scaffold-ETH 2.
    // The Diamond proxy handles all calls via delegatecall to facets.
}
