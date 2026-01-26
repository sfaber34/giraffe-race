// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceBase } from "./GiraffeRaceBase.sol";
import { ClaimLib } from "./libraries/ClaimLib.sol";
import { SettlementLib } from "./libraries/SettlementLib.sol";

/**
 * @title GiraffeRaceBetting
 * @notice Handles bet placement and claim processing
 * @dev Manages user bets and payouts
 */
abstract contract GiraffeRaceBetting is GiraffeRaceBase {
    // ============ Bet Placement ============

    /// @notice Place a bet on a lane for the current active race
    /// @param lane The lane to bet on (0-5)
    /// @param amount The bet amount in USDC (6 decimals)
    function placeBet(uint8 lane, uint256 amount) external {
        if (lane >= LANE_COUNT) revert InvalidLane();

        uint256 raceId = _activeRaceId();
        Race storage r = _races[raceId];
        
        // Betting window check
        if (r.bettingCloseBlock == 0) revert BettingNotOpen();
        if (block.number >= r.bettingCloseBlock) revert BettingClosed();

        if (amount == 0) revert ZeroBet();
        if (amount > maxBetAmount) revert BetTooLarge();

        if (!r.oddsSet) revert OddsNotSet();

        Bet storage b = _bets[raceId][msg.sender];
        if (b.amount != 0) revert AlreadyBet();

        // Risk control: ensure treasury can cover worst-case payout
        uint256 maxPayout = ClaimLib.calculateProjectedMaxPayout(
            r.totalOnLane,
            r.decimalOddsBps,
            lane,
            amount
        );
        if (treasury.balance() < settledLiability + maxPayout) {
            revert InsufficientBankroll();
        }

        // Collect bet from user via treasury
        treasury.collectBet(msg.sender, amount);

        b.amount = uint128(amount);
        b.lane = lane;

        r.totalPot += amount;
        r.totalOnLane[lane] += amount;

        _bettorRaceIds[msg.sender].push(raceId);
        emit BetPlaced(raceId, msg.sender, lane, amount);
    }

    // ============ Claims ============

    /// @notice Resolve the caller's next unsettled bet
    /// @dev For dead heats, winners receive (betAmount * odds) / deadHeatCount
    /// @return payout The payout amount (0 for losses)
    function claim() external returns (uint256 payout) {
        return _processClaim(msg.sender, false);
    }

    /// @notice Claim the caller's next winning payout (skips losses)
    /// @dev Advances through losses silently to find the next win
    /// @return payout The winning payout amount
    function claimNextWinningPayout() external returns (uint256 payout) {
        return _processClaim(msg.sender, true);
    }

    /// @notice Internal claim processing - reduces code duplication
    /// @param bettor The bettor address
    /// @param skipLosses If true, silently resolve losses and continue to next win
    /// @return payout The payout amount
    function _processClaim(
        address bettor,
        bool skipLosses
    ) internal returns (uint256 payout) {
        uint256[] storage ids = _bettorRaceIds[bettor];
        uint256 idx = _nextClaimIndex[bettor];
        if (idx >= ids.length) revert NoClaimableBets();

        while (idx < ids.length) {
            uint256 raceId = ids[idx];
            Race storage r = _races[raceId];

            // On-demand settlement (skip if cancelled - no settlement needed)
            if (!r.settled && !r.cancelled) {
                settledLiability = SettlementLib.settleRace(r, raceId, _raceScore[raceId], simulator, settledLiability);
            }

            Bet storage b = _bets[raceId][bettor];
            
            // Skip already resolved
            if (b.amount == 0 || b.claimed) {
                idx++;
                continue;
            }

            // Handle cancelled races: refund original bet
            if (r.cancelled) {
                b.claimed = true;
                _nextClaimIndex[bettor] = idx + 1;
                payout = uint256(b.amount);
                treasury.payWinner(bettor, payout);
                emit Claimed(raceId, bettor, payout);
                return payout;
            }

            bool isWinner = ClaimLib.isWinnerFromRace(r, b.lane);

            // Handle losers
            if (!isWinner) {
                if (skipLosses) {
                    // Silently resolve loss and continue
                    b.claimed = true;
                    idx++;
                    _nextClaimIndex[bettor] = idx;
                    continue;
                } else {
                    // Return loss resolution
                    b.claimed = true;
                    _nextClaimIndex[bettor] = idx + 1;
                    emit Claimed(raceId, bettor, 0);
                    return 0;
                }
            }

            // Winner: calculate and pay out
            b.claimed = true;
            _nextClaimIndex[bettor] = idx + 1;

            payout = ClaimLib.calculatePayout(
                uint256(b.amount),
                r.decimalOddsBps[b.lane],
                r.deadHeatCount
            );
            
            if (payout != 0) {
                settledLiability -= payout;
                treasury.payWinner(bettor, payout);
            }

            emit Claimed(raceId, bettor, payout);
            return payout;
        }

        _nextClaimIndex[bettor] = ids.length;
        revert NoClaimableBets();
    }

    // ============ View Functions ============

    function getBetById(uint256 raceId, address bettor) external view returns (uint128 amount, uint8 lane, bool claimed) {
        Bet storage b = _bets[raceId][bettor];
        return (b.amount, b.lane, b.claimed);
    }

    function getClaimRemaining(address bettor) external view returns (uint256 remaining) {
        uint256[] storage ids = _bettorRaceIds[bettor];
        uint256 idx = _nextClaimIndex[bettor];
        if (idx >= ids.length) return 0;
        return ids.length - idx;
    }

    function getWinningClaimRemaining(address bettor) external view returns (uint256 remaining) {
        uint256[] storage ids = _bettorRaceIds[bettor];
        uint256 idx = _nextClaimIndex[bettor];
        if (idx >= ids.length) return 0;

        for (uint256 i = idx; i < ids.length; ) {
            uint256 rid = ids[i];
            Bet storage b = _bets[rid][bettor];
            if (b.amount == 0 || b.claimed) {
                unchecked { ++i; }
                continue;
            }

            Race storage r = _races[rid];
            if (!r.settled) {
                unchecked { ++i; }
                continue;
            }
            if (!ClaimLib.isWinnerFromRace(r, b.lane)) {
                unchecked { ++i; }
                continue;
            }

            remaining++;
            unchecked { ++i; }
        }
    }

    function getNextWinningClaim(address bettor) external view returns (NextClaimView memory out) {
        uint256[] storage ids = _bettorRaceIds[bettor];
        uint256 idx = _nextClaimIndex[bettor];
        if (idx >= ids.length) return out;

        for (uint256 i = idx; i < ids.length; ) {
            uint256 rid = ids[i];
            Bet storage b = _bets[rid][bettor];
            if (b.amount == 0 || b.claimed) {
                unchecked { ++i; }
                continue;
            }

            Race storage r = _races[rid];
            if (!r.settled) {
                unchecked { ++i; }
                continue;
            }
            if (!ClaimLib.isWinnerFromRace(r, b.lane)) {
                unchecked { ++i; }
                continue;
            }

            uint256 p = ClaimLib.calculatePayout(
                uint256(b.amount),
                r.decimalOddsBps[b.lane],
                r.deadHeatCount
            );

            out.hasClaim = true;
            out.raceId = rid;
            out.status = CLAIM_STATUS_WIN;
            out.betLane = b.lane;
            out.betTokenId = _raceGiraffes[rid].tokenIds[b.lane];
            out.betAmount = b.amount;
            out.winner = r.winner;
            out.payout = p;
            out.bettingCloseBlock = r.bettingCloseBlock;
            return out;
        }
    }

    function getNextClaim(address bettor) external view returns (NextClaimView memory out) {
        uint256[] storage ids = _bettorRaceIds[bettor];
        uint256 idx = _nextClaimIndex[bettor];
        if (idx >= ids.length) return out;

        while (idx < ids.length) {
            uint256 rid = ids[idx];
            Bet storage b = _bets[rid][bettor];
            if (b.amount == 0 || b.claimed) {
                idx++;
                continue;
            }

            Race storage r = _races[rid];
            uint64 cb = r.bettingCloseBlock;

            // Handle cancelled races: show refund status
            if (r.cancelled) {
                out.hasClaim = true;
                out.raceId = rid;
                out.status = CLAIM_STATUS_REFUND;
                out.betLane = b.lane;
                out.betTokenId = _raceGiraffes[rid].tokenIds[b.lane];
                out.betAmount = b.amount;
                out.winner = 0;
                out.payout = uint256(b.amount); // Refund = original bet
                out.bettingCloseBlock = cb;
                return out;
            }

            if (!r.settled) {
                bool ready = cb != 0 && block.number > cb;
                bool bhLikelyAvailable = ready && (block.number - cb) <= 256;
                uint8 status = bhLikelyAvailable 
                    ? CLAIM_STATUS_READY_TO_SETTLE 
                    : CLAIM_STATUS_BLOCKHASH_UNAVAILABLE;
                
                out.hasClaim = true;
                out.raceId = rid;
                out.status = status;
                out.betLane = b.lane;
                out.betTokenId = _raceGiraffes[rid].tokenIds[b.lane];
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
                out.status = CLAIM_STATUS_LOSS;
                out.betLane = b.lane;
                out.betTokenId = _raceGiraffes[rid].tokenIds[b.lane];
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
            out.status = CLAIM_STATUS_WIN;
            out.betLane = b.lane;
            out.betTokenId = _raceGiraffes[rid].tokenIds[b.lane];
            out.betAmount = b.amount;
            out.winner = w;
            out.payout = p;
            out.bettingCloseBlock = cb;
            return out;
        }

        return out;
    }
}
