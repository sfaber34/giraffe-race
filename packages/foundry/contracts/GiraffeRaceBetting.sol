// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { RaffeRaceBase } from "./RaffeRaceBase.sol";
import { ClaimLib } from "./libraries/ClaimLib.sol";
import { SettlementLib } from "./libraries/SettlementLib.sol";

/**
 * @title RaffeRaceBetting
 * @notice Handles bet placement and claim processing for Win/Place/Show bets
 * @dev Manages user bets and payouts with dead heat rules
 */
abstract contract RaffeRaceBetting is RaffeRaceBase {
    // ============ Bet Placement ============

    /// @notice Place a bet on a lane for the current active race
    /// @param lane The lane to bet on (0-5)
    /// @param amount The bet amount in USDC (6 decimals)
    /// @param betType The bet type: 0=Win, 1=Place, 2=Show
    function placeBet(uint8 lane, uint256 amount, uint8 betType) external {
        if (lane >= LANE_COUNT) revert InvalidLane();
        if (betType > BET_TYPE_SHOW) revert InvalidBetType();

        uint256 raceId = _activeRaceId();
        Race storage r = _races[raceId];
        
        // Betting window check
        if (r.bettingCloseBlock == 0) revert BettingNotOpen();
        if (block.number >= r.bettingCloseBlock) revert BettingClosed();

        if (amount == 0) revert ZeroBet();
        if (amount > maxBetAmount) revert BetTooLarge();

        if (!r.oddsSet) revert OddsNotSet();

        UserRaceBets storage userBets = _userBets[raceId][msg.sender];
        
        // Get the specific bet slot based on type
        Bet storage b;
        if (betType == BET_TYPE_WIN) {
            b = userBets.winBet;
        } else if (betType == BET_TYPE_PLACE) {
            b = userBets.placeBet;
        } else {
            b = userBets.showBet;
        }
        
        // Check if this bet type is already placed
        if (b.amount != 0) revert AlreadyBet();

        // Risk control: ensure treasury can cover worst-case payout
        uint32 odds = _getOddsForBetType(r, lane, betType);
        uint256 maxPayout = (amount * uint256(odds)) / ODDS_SCALE;
        if (treasury.balance() < settledLiability + maxPayout) {
            revert InsufficientBankroll();
        }

        // Collect bet from user via treasury
        treasury.collectBet(msg.sender, amount);

        b.amount = uint128(amount);
        b.lane = lane;

        r.totalPot += amount;
        // Track by lane for each bet type
        if (betType == BET_TYPE_WIN) {
            r.totalOnLane[lane] += amount;
        } else if (betType == BET_TYPE_PLACE) {
            r.totalPlaceOnLane[lane] += amount;
        } else {
            r.totalShowOnLane[lane] += amount;
        }

        // Track bettor for claims (only add once per race)
        if (!_hasBetsInRace(raceId, msg.sender, betType)) {
            _bettorRaceIds[msg.sender].push(raceId);
        }
        
        emit BetPlaced(raceId, msg.sender, lane, betType, amount);
    }
    
    /// @notice Check if user already has any bet in this race (before current bet type)
    function _hasBetsInRace(uint256 raceId, address bettor, uint8 currentBetType) internal view returns (bool) {
        UserRaceBets storage userBets = _userBets[raceId][bettor];
        if (currentBetType == BET_TYPE_WIN) {
            // Win is first, so check if Place or Show exists
            return userBets.placeBet.amount != 0 || userBets.showBet.amount != 0;
        } else if (currentBetType == BET_TYPE_PLACE) {
            return userBets.winBet.amount != 0 || userBets.showBet.amount != 0;
        } else {
            return userBets.winBet.amount != 0 || userBets.placeBet.amount != 0;
        }
    }
    
    /// @notice Get odds for a bet type
    function _getOddsForBetType(Race storage r, uint8 lane, uint8 betType) internal view returns (uint32) {
        if (betType == BET_TYPE_WIN) {
            return r.decimalOddsBps[lane];
        } else if (betType == BET_TYPE_PLACE) {
            return r.placeOddsBps[lane];
        } else {
            return r.showOddsBps[lane];
        }
    }

    // ============ Claims ============

    /// @notice Resolve the caller's next unsettled bet
    /// @return payout The payout amount (0 for losses)
    function claim() external returns (uint256 payout) {
        return _processClaim(msg.sender, false);
    }

    /// @notice Claim the caller's next winning payout (skips losses)
    /// @return payout The winning payout amount
    function claimNextWinningPayout() external returns (uint256 payout) {
        return _processClaim(msg.sender, true);
    }

    /// @notice Internal claim processing
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

            // On-demand settlement (skip if cancelled)
            if (!r.settled && !r.cancelled) {
                settledLiability = SettlementLib.settleRace(r, raceId, _raceScore[raceId], simulator, settledLiability);
            }

            UserRaceBets storage userBets = _userBets[raceId][bettor];
            
            // Try to process each bet type in order: Win, Place, Show
            (bool found, uint256 p, bool isWin) = _processNextBet(r, userBets, bettor, raceId, skipLosses);
            
            if (found) {
                if (isWin || !skipLosses) {
                    if (p != 0) {
                        settledLiability -= p;
                        treasury.payWinner(bettor, p);
                    }
                    emit Claimed(raceId, bettor, p);
                    
                    // Check if all bets in this race are processed
                    if (_allBetsClaimed(userBets)) {
                        _nextClaimIndex[bettor] = idx + 1;
                    }
                    return p;
                }
                // skipLosses=true and this was a loss, continue to next bet
            }
            
            // All bets in this race processed, move to next race
            if (_allBetsClaimed(userBets)) {
                idx++;
                _nextClaimIndex[bettor] = idx;
            } else if (!found) {
                idx++;
                _nextClaimIndex[bettor] = idx;
            }
        }

        _nextClaimIndex[bettor] = ids.length;
        revert NoClaimableBets();
    }
    
    /// @notice Process the next unclaimed bet for a user in a race
    function _processNextBet(
        Race storage r,
        UserRaceBets storage userBets,
        address bettor,
        uint256 raceId,
        bool skipLosses
    ) internal returns (bool found, uint256 payout, bool isWin) {
        // Handle cancelled races: refund all unclaimed bets
        if (r.cancelled) {
            if (userBets.winBet.amount != 0 && !userBets.winBet.claimed) {
                userBets.winBet.claimed = true;
                return (true, uint256(userBets.winBet.amount), true);
            }
            if (userBets.placeBet.amount != 0 && !userBets.placeBet.claimed) {
                userBets.placeBet.claimed = true;
                return (true, uint256(userBets.placeBet.amount), true);
            }
            if (userBets.showBet.amount != 0 && !userBets.showBet.claimed) {
                userBets.showBet.claimed = true;
                return (true, uint256(userBets.showBet.amount), true);
            }
            return (false, 0, false);
        }
        
        // Process Win bet
        if (userBets.winBet.amount != 0 && !userBets.winBet.claimed) {
            userBets.winBet.claimed = true;
            (payout, isWin) = _calculateWinBetPayout(r, userBets.winBet);
            return (true, payout, isWin);
        }
        
        // Process Place bet
        if (userBets.placeBet.amount != 0 && !userBets.placeBet.claimed) {
            userBets.placeBet.claimed = true;
            (payout, isWin) = _calculatePlaceBetPayout(r, userBets.placeBet);
            return (true, payout, isWin);
        }
        
        // Process Show bet
        if (userBets.showBet.amount != 0 && !userBets.showBet.claimed) {
            userBets.showBet.claimed = true;
            (payout, isWin) = _calculateShowBetPayout(r, userBets.showBet);
            return (true, payout, isWin);
        }
        
        return (false, 0, false);
    }
    
    /// @notice Calculate payout for a Win bet
    function _calculateWinBetPayout(Race storage r, Bet storage bet) internal view returns (uint256 payout, bool isWin) {
        // Win bet: lane must be in 1st place
        isWin = ClaimLib.isLaneInPosition(r.firstPlace, bet.lane);
        if (!isWin) return (0, false);
        
        // Dead heat for 1st: split payout
        uint8 deadHeatCount = r.firstPlace.count;
        payout = ClaimLib.calculatePayout(
            uint256(bet.amount),
            r.decimalOddsBps[bet.lane],
            deadHeatCount
        );
    }
    
    /// @notice Calculate payout for a Place bet (1st or 2nd)
    function _calculatePlaceBetPayout(Race storage r, Bet storage bet) internal view returns (uint256 payout, bool isWin) {
        bool isFirst = ClaimLib.isLaneInPosition(r.firstPlace, bet.lane);
        bool isSecond = ClaimLib.isLaneInPosition(r.secondPlace, bet.lane);
        
        if (!isFirst && !isSecond) return (0, false);
        isWin = true;
        
        // Determine dead heat divisor based on standard rules:
        // - 1st place: full payout
        // - 2nd place (no tie): full payout
        // - Tied for 2nd: split payout
        uint8 deadHeatCount = 1;
        if (isSecond && r.secondPlace.count > 1) {
            deadHeatCount = r.secondPlace.count;
        }
        
        payout = ClaimLib.calculatePayout(
            uint256(bet.amount),
            r.placeOddsBps[bet.lane],
            deadHeatCount
        );
    }
    
    /// @notice Calculate payout for a Show bet (1st, 2nd, or 3rd)
    function _calculateShowBetPayout(Race storage r, Bet storage bet) internal view returns (uint256 payout, bool isWin) {
        bool isFirst = ClaimLib.isLaneInPosition(r.firstPlace, bet.lane);
        bool isSecond = ClaimLib.isLaneInPosition(r.secondPlace, bet.lane);
        bool isThird = ClaimLib.isLaneInPosition(r.thirdPlace, bet.lane);
        
        if (!isFirst && !isSecond && !isThird) return (0, false);
        isWin = true;
        
        // Determine dead heat divisor based on standard rules:
        // - 1st or 2nd place: full payout
        // - 3rd place (no tie): full payout
        // - Tied for 3rd: split payout
        uint8 deadHeatCount = 1;
        if (isThird && r.thirdPlace.count > 1) {
            deadHeatCount = r.thirdPlace.count;
        }
        
        payout = ClaimLib.calculatePayout(
            uint256(bet.amount),
            r.showOddsBps[bet.lane],
            deadHeatCount
        );
    }
    
    /// @notice Check if all bets for a user in a race are claimed
    function _allBetsClaimed(UserRaceBets storage userBets) internal view returns (bool) {
        bool winDone = userBets.winBet.amount == 0 || userBets.winBet.claimed;
        bool placeDone = userBets.placeBet.amount == 0 || userBets.placeBet.claimed;
        bool showDone = userBets.showBet.amount == 0 || userBets.showBet.claimed;
        return winDone && placeDone && showDone;
    }

    // ============ View Functions ============

    /// @notice Get all bets for a user in a race
    function getUserBetsById(uint256 raceId, address bettor) external view returns (
        uint128 winAmount, uint8 winLane, bool winClaimed,
        uint128 placeAmount, uint8 placeLane, bool placeClaimed,
        uint128 showAmount, uint8 showLane, bool showClaimed
    ) {
        UserRaceBets storage ub = _userBets[raceId][bettor];
        return (
            ub.winBet.amount, ub.winBet.lane, ub.winBet.claimed,
            ub.placeBet.amount, ub.placeBet.lane, ub.placeBet.claimed,
            ub.showBet.amount, ub.showBet.lane, ub.showBet.claimed
        );
    }

    /// @notice Legacy function for backwards compatibility - returns Win bet only
    function getBetById(uint256 raceId, address bettor) external view returns (uint128 amount, uint8 lane, bool claimed) {
        Bet storage b = _userBets[raceId][bettor].winBet;
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
            Race storage r = _races[rid];
            if (!r.settled) {
                unchecked { ++i; }
                continue;
            }
            
            UserRaceBets storage ub = _userBets[rid][bettor];
            
            // Check each bet type for wins
            if (ub.winBet.amount != 0 && !ub.winBet.claimed) {
                if (ClaimLib.isLaneInPosition(r.firstPlace, ub.winBet.lane)) {
                    remaining++;
                }
            }
            if (ub.placeBet.amount != 0 && !ub.placeBet.claimed) {
                if (ClaimLib.isLaneInPosition(r.firstPlace, ub.placeBet.lane) ||
                    ClaimLib.isLaneInPosition(r.secondPlace, ub.placeBet.lane)) {
                    remaining++;
                }
            }
            if (ub.showBet.amount != 0 && !ub.showBet.claimed) {
                if (ClaimLib.isLaneInPosition(r.firstPlace, ub.showBet.lane) ||
                    ClaimLib.isLaneInPosition(r.secondPlace, ub.showBet.lane) ||
                    ClaimLib.isLaneInPosition(r.thirdPlace, ub.showBet.lane)) {
                    remaining++;
                }
            }

            unchecked { ++i; }
        }
    }

    function getNextWinningClaim(address bettor) external view returns (NextClaimView memory out) {
        uint256[] storage ids = _bettorRaceIds[bettor];
        uint256 idx = _nextClaimIndex[bettor];
        if (idx >= ids.length) return out;

        for (uint256 i = idx; i < ids.length; ) {
            uint256 rid = ids[i];
            Race storage r = _races[rid];
            if (!r.settled) {
                unchecked { ++i; }
                continue;
            }

            UserRaceBets storage ub = _userBets[rid][bettor];
            
            // Check Win bet
            if (ub.winBet.amount != 0 && !ub.winBet.claimed) {
                if (ClaimLib.isLaneInPosition(r.firstPlace, ub.winBet.lane)) {
                    out.hasClaim = true;
                    out.raceId = rid;
                    out.status = CLAIM_STATUS_WIN;
                    out.betLane = ub.winBet.lane;
                    out.betTokenId = _raceRaffes[rid].tokenIds[ub.winBet.lane];
                    out.betAmount = ub.winBet.amount;
                    out.winner = r.winner;
                    out.payout = ClaimLib.calculatePayout(uint256(ub.winBet.amount), r.decimalOddsBps[ub.winBet.lane], r.firstPlace.count);
                    out.bettingCloseBlock = r.bettingCloseBlock;
                    return out;
                }
            }
            
            // Check Place bet
            if (ub.placeBet.amount != 0 && !ub.placeBet.claimed) {
                bool isFirst = ClaimLib.isLaneInPosition(r.firstPlace, ub.placeBet.lane);
                bool isSecond = ClaimLib.isLaneInPosition(r.secondPlace, ub.placeBet.lane);
                if (isFirst || isSecond) {
                    uint8 dh = isSecond && r.secondPlace.count > 1 ? r.secondPlace.count : 1;
                    out.hasClaim = true;
                    out.raceId = rid;
                    out.status = CLAIM_STATUS_WIN;
                    out.betLane = ub.placeBet.lane;
                    out.betTokenId = _raceRaffes[rid].tokenIds[ub.placeBet.lane];
                    out.betAmount = ub.placeBet.amount;
                    out.winner = r.winner;
                    out.payout = ClaimLib.calculatePayout(uint256(ub.placeBet.amount), r.placeOddsBps[ub.placeBet.lane], dh);
                    out.bettingCloseBlock = r.bettingCloseBlock;
                    return out;
                }
            }
            
            // Check Show bet
            if (ub.showBet.amount != 0 && !ub.showBet.claimed) {
                bool isFirst = ClaimLib.isLaneInPosition(r.firstPlace, ub.showBet.lane);
                bool isSecond = ClaimLib.isLaneInPosition(r.secondPlace, ub.showBet.lane);
                bool isThird = ClaimLib.isLaneInPosition(r.thirdPlace, ub.showBet.lane);
                if (isFirst || isSecond || isThird) {
                    uint8 dh = isThird && r.thirdPlace.count > 1 ? r.thirdPlace.count : 1;
                    out.hasClaim = true;
                    out.raceId = rid;
                    out.status = CLAIM_STATUS_WIN;
                    out.betLane = ub.showBet.lane;
                    out.betTokenId = _raceRaffes[rid].tokenIds[ub.showBet.lane];
                    out.betAmount = ub.showBet.amount;
                    out.winner = r.winner;
                    out.payout = ClaimLib.calculatePayout(uint256(ub.showBet.amount), r.showOddsBps[ub.showBet.lane], dh);
                    out.bettingCloseBlock = r.bettingCloseBlock;
                    return out;
                }
            }

            unchecked { ++i; }
        }
    }

    function getNextClaim(address bettor) external view returns (NextClaimView memory out) {
        uint256[] storage ids = _bettorRaceIds[bettor];
        uint256 idx = _nextClaimIndex[bettor];
        if (idx >= ids.length) return out;

        while (idx < ids.length) {
            uint256 rid = ids[idx];
            Race storage r = _races[rid];
            uint64 cb = r.bettingCloseBlock;
            UserRaceBets storage ub = _userBets[rid][bettor];

            // Handle cancelled races: show refund status for first unclaimed bet
            if (r.cancelled) {
                if (ub.winBet.amount != 0 && !ub.winBet.claimed) {
                    out.hasClaim = true;
                    out.raceId = rid;
                    out.status = CLAIM_STATUS_REFUND;
                    out.betLane = ub.winBet.lane;
                    out.betTokenId = _raceRaffes[rid].tokenIds[ub.winBet.lane];
                    out.betAmount = ub.winBet.amount;
                    out.payout = uint256(ub.winBet.amount);
                    out.bettingCloseBlock = cb;
                    return out;
                }
                // Similar for place/show...
            }

            if (!r.settled) {
                // Check if any unclaimed bets exist
                bool hasUnclaimed = (ub.winBet.amount != 0 && !ub.winBet.claimed) ||
                                   (ub.placeBet.amount != 0 && !ub.placeBet.claimed) ||
                                   (ub.showBet.amount != 0 && !ub.showBet.claimed);
                if (hasUnclaimed) {
                    bool ready = cb != 0 && block.number > cb;
                    bool bhLikelyAvailable = ready && (block.number - cb) <= 256;
                    out.hasClaim = true;
                    out.raceId = rid;
                    out.status = bhLikelyAvailable ? CLAIM_STATUS_READY_TO_SETTLE : CLAIM_STATUS_BLOCKHASH_UNAVAILABLE;
                    out.bettingCloseBlock = cb;
                    return out;
                }
            } else {
                // Return first unclaimed bet status
                if (ub.winBet.amount != 0 && !ub.winBet.claimed) {
                    bool isWin = ClaimLib.isLaneInPosition(r.firstPlace, ub.winBet.lane);
                    out.hasClaim = true;
                    out.raceId = rid;
                    out.status = isWin ? CLAIM_STATUS_WIN : CLAIM_STATUS_LOSS;
                    out.betLane = ub.winBet.lane;
                    out.betTokenId = _raceRaffes[rid].tokenIds[ub.winBet.lane];
                    out.betAmount = ub.winBet.amount;
                    out.winner = r.winner;
                    out.payout = isWin ? ClaimLib.calculatePayout(uint256(ub.winBet.amount), r.decimalOddsBps[ub.winBet.lane], r.firstPlace.count) : 0;
                    out.bettingCloseBlock = cb;
                    return out;
                }
                // Similar for place/show bets...
            }
            
            idx++;
        }

        return out;
    }
}
