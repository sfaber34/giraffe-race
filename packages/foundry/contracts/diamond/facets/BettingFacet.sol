// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceStorage } from "../libraries/GiraffeRaceStorage.sol";
import { ClaimLib } from "../libraries/ClaimLib.sol";

/**
 * @title BettingFacet
 * @notice Handles bet placement and claim processing
 * @dev Manages user bets and payouts
 */
contract BettingFacet {
    // ============ Bet Placement ============

    /// @notice Place a bet on a lane for the current active race
    /// @param lane The lane to bet on (0-5)
    /// @param amount The bet amount in USDC (6 decimals)
    function placeBet(uint8 lane, uint256 amount) external {
        if (lane >= GiraffeRaceStorage.LANE_COUNT) revert GiraffeRaceStorage.InvalidLane();

        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256 raceId = _activeRaceId(s);
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        
        // Betting requires finalization
        if (!r.giraffesFinalized) revert GiraffeRaceStorage.BettingNotOpen();
        if (r.bettingCloseBlock == 0) revert GiraffeRaceStorage.BettingNotOpen();
        if (block.number >= r.bettingCloseBlock) revert GiraffeRaceStorage.BettingClosed();

        if (amount == 0) revert GiraffeRaceStorage.ZeroBet();
        if (amount > s.maxBetAmount) revert GiraffeRaceStorage.BetTooLarge();

        if (!r.oddsSet) revert GiraffeRaceStorage.OddsNotSet();

        GiraffeRaceStorage.Bet storage b = s.bets[raceId][msg.sender];
        if (b.amount != 0) revert GiraffeRaceStorage.AlreadyBet();

        // Risk control: ensure treasury can cover worst-case payout
        uint256 maxPayout = ClaimLib.calculateProjectedMaxPayout(
            r.totalOnLane,
            r.decimalOddsBps,
            lane,
            amount
        );
        if (s.treasury.balance() < s.settledLiability + maxPayout) {
            revert GiraffeRaceStorage.InsufficientBankroll();
        }

        // Collect bet from user via treasury
        s.treasury.collectBet(msg.sender, amount);

        b.amount = uint128(amount);
        b.lane = lane;

        r.totalPot += amount;
        r.totalOnLane[lane] += amount;

        s.bettorRaceIds[msg.sender].push(raceId);
        emit GiraffeRaceStorage.BetPlaced(raceId, msg.sender, lane, amount);
    }

    // ============ Claims ============

    /// @notice Resolve the caller's next unsettled bet
    /// @dev For dead heats, winners receive (betAmount * odds) / deadHeatCount
    /// @return payout The payout amount (0 for losses)
    function claim() external returns (uint256 payout) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        return _processClaim(s, msg.sender, false);
    }

    /// @notice Claim the caller's next winning payout (skips losses)
    /// @dev Advances through losses silently to find the next win
    /// @return payout The winning payout amount
    function claimNextWinningPayout() external returns (uint256 payout) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        return _processClaim(s, msg.sender, true);
    }

    /// @notice Internal claim processing - reduces code duplication
    /// @param s Storage layout reference
    /// @param bettor The bettor address
    /// @param skipLosses If true, silently resolve losses and continue to next win
    /// @return payout The payout amount
    function _processClaim(
        GiraffeRaceStorage.Layout storage s,
        address bettor,
        bool skipLosses
    ) internal returns (uint256 payout) {
        uint256[] storage ids = s.bettorRaceIds[bettor];
        uint256 idx = s.nextClaimIndex[bettor];
        if (idx >= ids.length) revert GiraffeRaceStorage.NoClaimableBets();

        while (idx < ids.length) {
            uint256 raceId = ids[idx];
            GiraffeRaceStorage.Race storage r = s.races[raceId];

            // On-demand settlement
            if (!r.settled) {
                _settleRaceInternal(s, raceId);
            }

            GiraffeRaceStorage.Bet storage b = s.bets[raceId][bettor];
            
            // Skip already resolved
            if (b.amount == 0 || b.claimed) {
                idx++;
                continue;
            }

            bool isWinner = ClaimLib.isWinnerFromRace(r, b.lane);

            // Handle losers
            if (!isWinner) {
                if (skipLosses) {
                    // Silently resolve loss and continue
                    b.claimed = true;
                    idx++;
                    s.nextClaimIndex[bettor] = idx;
                    continue;
                } else {
                    // Return loss resolution
                    b.claimed = true;
                    s.nextClaimIndex[bettor] = idx + 1;
                    emit GiraffeRaceStorage.Claimed(raceId, bettor, 0);
                    return 0;
                }
            }

            // Winner: calculate and pay out
            b.claimed = true;
            s.nextClaimIndex[bettor] = idx + 1;

            payout = ClaimLib.calculatePayout(
                uint256(b.amount),
                r.decimalOddsBps[b.lane],
                r.deadHeatCount
            );
            
            if (payout != 0) {
                s.settledLiability -= payout;
                s.treasury.payWinner(bettor, payout);
            }

            emit GiraffeRaceStorage.Claimed(raceId, bettor, payout);
            return payout;
        }

        s.nextClaimIndex[bettor] = ids.length;
        revert GiraffeRaceStorage.NoClaimableBets();
    }

    /// @notice Internal settlement (duplicated from RaceLifecycleFacet for claim path)
    function _settleRaceInternal(GiraffeRaceStorage.Layout storage s, uint256 raceId) internal {
        GiraffeRaceStorage.Race storage r = s.races[raceId];
        
        if (r.submissionCloseBlock == 0) revert GiraffeRaceStorage.InvalidRace();
        if (r.settled) revert GiraffeRaceStorage.AlreadySettled();
        if (!r.giraffesFinalized) revert GiraffeRaceStorage.RaceNotReady();
        if (r.bettingCloseBlock == 0) revert GiraffeRaceStorage.RaceNotReady();
        if (block.number <= r.bettingCloseBlock) revert GiraffeRaceStorage.RaceNotReady();
        
        if (r.totalPot != 0 && !r.oddsSet) revert GiraffeRaceStorage.OddsNotSet();

        bytes32 bh = blockhash(r.bettingCloseBlock);
        if (bh == bytes32(0)) revert GiraffeRaceStorage.BlockhashUnavailable();

        bytes32 baseSeed = keccak256(abi.encodePacked(bh, raceId, address(this)));
        bytes32 simSeed = keccak256(abi.encodePacked(baseSeed, "RACE_SIM"));
        
        (uint8[6] memory winners, uint8 winnerCount,) = 
            s.simulator.winnersWithScore(simSeed, s.raceScore[raceId]);

        r.settled = true;
        r.settledAtBlock = uint64(block.number);
        r.winner = winners[0];
        r.deadHeatCount = winnerCount;
        r.winners = winners;
        r.seed = simSeed;

        if (r.totalPot != 0) {
            s.settledLiability += ClaimLib.calculateRaceLiability(r);
        }

        if (winnerCount > 1) {
            emit GiraffeRaceStorage.RaceSettledDeadHeat(raceId, simSeed, winnerCount, winners);
        } else {
            emit GiraffeRaceStorage.RaceSettled(raceId, simSeed, r.winner);
        }
    }

    // ============ View Functions ============
    // NOTE: getBet() removed. UI should call latestRaceId() then use getBetById().

    function getBetById(uint256 raceId, address bettor) external view returns (uint128 amount, uint8 lane, bool claimed) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        GiraffeRaceStorage.Bet storage b = s.bets[raceId][bettor];
        return (b.amount, b.lane, b.claimed);
    }

    function getClaimRemaining(address bettor) external view returns (uint256 remaining) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256[] storage ids = s.bettorRaceIds[bettor];
        uint256 idx = s.nextClaimIndex[bettor];
        if (idx >= ids.length) return 0;
        return ids.length - idx;
    }

    function getWinningClaimRemaining(address bettor) external view returns (uint256 remaining) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256[] storage ids = s.bettorRaceIds[bettor];
        uint256 idx = s.nextClaimIndex[bettor];
        if (idx >= ids.length) return 0;

        for (uint256 i = idx; i < ids.length; i++) {
            uint256 rid = ids[i];
            GiraffeRaceStorage.Bet storage b = s.bets[rid][bettor];
            if (b.amount == 0 || b.claimed) continue;

            GiraffeRaceStorage.Race storage r = s.races[rid];
            if (!r.settled) continue;
            if (!ClaimLib.isWinnerFromRace(r, b.lane)) continue;

            remaining++;
        }
    }

    function getNextWinningClaim(address bettor) external view returns (GiraffeRaceStorage.NextClaimView memory out) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256[] storage ids = s.bettorRaceIds[bettor];
        uint256 idx = s.nextClaimIndex[bettor];
        if (idx >= ids.length) return out;

        for (uint256 i = idx; i < ids.length; i++) {
            uint256 rid = ids[i];
            GiraffeRaceStorage.Bet storage b = s.bets[rid][bettor];
            if (b.amount == 0 || b.claimed) continue;

            GiraffeRaceStorage.Race storage r = s.races[rid];
            if (!r.settled) continue;
            if (!ClaimLib.isWinnerFromRace(r, b.lane)) continue;

            uint256 p = ClaimLib.calculatePayout(
                uint256(b.amount),
                r.decimalOddsBps[b.lane],
                r.deadHeatCount
            );

            out.hasClaim = true;
            out.raceId = rid;
            out.status = 3;
            out.betLane = b.lane;
            out.betTokenId = s.raceGiraffes[rid].tokenIds[b.lane];
            out.betAmount = b.amount;
            out.winner = r.winner;
            out.payout = p;
            out.bettingCloseBlock = r.bettingCloseBlock;
            return out;
        }
    }

    function getNextClaim(address bettor) external view returns (GiraffeRaceStorage.NextClaimView memory out) {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        uint256[] storage ids = s.bettorRaceIds[bettor];
        uint256 idx = s.nextClaimIndex[bettor];
        if (idx >= ids.length) return out;

        while (idx < ids.length) {
            uint256 rid = ids[idx];
            GiraffeRaceStorage.Bet storage b = s.bets[rid][bettor];
            if (b.amount == 0 || b.claimed) {
                idx++;
                continue;
            }

            GiraffeRaceStorage.Race storage r = s.races[rid];
            uint64 cb = r.bettingCloseBlock;

            if (!r.settled) {
                bool ready = cb != 0 && block.number > cb;
                bool bhLikelyAvailable = ready && (block.number - cb) <= 256;
                uint8 status = bhLikelyAvailable ? 1 : 0;
                
                out.hasClaim = true;
                out.raceId = rid;
                out.status = status;
                out.betLane = b.lane;
                out.betTokenId = s.raceGiraffes[rid].tokenIds[b.lane];
                out.betAmount = b.amount;
                out.winner = 0;
                out.payout = 0;
                out.bettingCloseBlock = cb;
                return out;
            }

            uint8 w = r.winner;
            if (!ClaimLib.isWinnerFromRace(r, b.lane)) {
                out.hasClaim = true;
                out.raceId = rid;
                out.status = 2;
                out.betLane = b.lane;
                out.betTokenId = s.raceGiraffes[rid].tokenIds[b.lane];
                out.betAmount = b.amount;
                out.winner = w;
                out.payout = 0;
                out.bettingCloseBlock = cb;
                return out;
            }

            uint256 p = ClaimLib.calculatePayout(
                uint256(b.amount),
                r.decimalOddsBps[b.lane],
                r.deadHeatCount
            );
            
            out.hasClaim = true;
            out.raceId = rid;
            out.status = 3;
            out.betLane = b.lane;
            out.betTokenId = s.raceGiraffes[rid].tokenIds[b.lane];
            out.betAmount = b.amount;
            out.winner = w;
            out.payout = p;
            out.bettingCloseBlock = cb;
            return out;
        }

        return out;
    }

    function settledLiability() external view returns (uint256) {
        return GiraffeRaceStorage.layout().settledLiability;
    }

    // ============ Internal Helpers ============

    function _activeRaceId(GiraffeRaceStorage.Layout storage s) internal view returns (uint256 raceId) {
        if (s.nextRaceId == 0) revert GiraffeRaceStorage.InvalidRace();
        raceId = s.nextRaceId - 1;
        if (s.races[raceId].settled) revert GiraffeRaceStorage.InvalidRace();
    }
}
