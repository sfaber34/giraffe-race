"use client";

import { LANE_COUNT, ODDS_SCALE, USDC_DECIMALS } from "../constants";
import { BET_TYPE, BetType, LaneStats, MyBets, ParsedOdds, ParsedRaffes } from "../types";
import { LaneName } from "./LaneName";
import { formatUnits } from "viem";
import { RaffeAnimated } from "~~/components/assets/RaffeAnimated";

interface PlaceBetCardProps {
  // State
  viewingRaceId: bigint | null;
  lineupFinalized: boolean;
  laneTokenIds: bigint[];
  laneStats: LaneStats[];
  parsedRaffes: ParsedRaffes | null;
  parsedOdds: ParsedOdds | null;

  // User state
  connectedAddress: `0x${string}` | undefined;
  userUsdcBalance: bigint | undefined;
  maxBetAmount: bigint | null;
  myBets: MyBets | null;

  // Flags
  canBet: boolean;
  isViewingLatest: boolean;
  raffeRaceContract: any;
  needsApproval: boolean;
  hasEnoughUsdc: boolean;
  exceedsMaxBet: boolean;
  isApproving: boolean;

  // Bet amount state
  betAmountUsdc: string;
  setBetAmountUsdc: (amount: string) => void;
  placeBetValue: bigint | null;

  // Actions
  onApprove: () => Promise<void>;
  onPlaceBet: (lane: number, betType: BetType) => Promise<void>;
}

export const PlaceBetCard = ({
  viewingRaceId,
  lineupFinalized,
  laneTokenIds,
  laneStats,
  parsedRaffes,
  parsedOdds,
  connectedAddress,
  userUsdcBalance,
  maxBetAmount,
  myBets,
  canBet,
  isViewingLatest,
  raffeRaceContract,
  needsApproval,
  hasEnoughUsdc,
  exceedsMaxBet,
  isApproving,
  betAmountUsdc,
  setBetAmountUsdc,
  placeBetValue,
  onApprove,
  onPlaceBet,
}: PlaceBetCardProps) => {
  const winOddsLabelForLane = (lane: number) => {
    if (!parsedOdds?.oddsSet) return "—";
    const bps = Number(parsedOdds.winOddsBps[lane] ?? 0n);
    if (!Number.isFinite(bps) || bps <= 0) return "—";
    return `${(bps / ODDS_SCALE).toFixed(2)}x`;
  };

  const placeOddsLabelForLane = (lane: number) => {
    if (!parsedOdds?.oddsSet) return "—";
    const bps = Number(parsedOdds.placeOddsBps[lane] ?? 0n);
    if (!Number.isFinite(bps) || bps <= 0) return "—";
    return `${(bps / ODDS_SCALE).toFixed(2)}x`;
  };

  const showOddsLabelForLane = (lane: number) => {
    if (!parsedOdds?.oddsSet) return "—";
    const bps = Number(parsedOdds.showOddsBps[lane] ?? 0n);
    if (!Number.isFinite(bps) || bps <= 0) return "—";
    return `${(bps / ODDS_SCALE).toFixed(2)}x`;
  };

  // Check if user already has a specific bet type
  const hasWinBet = myBets?.win.hasBet ?? false;
  const hasPlaceBet = myBets?.place.hasBet ?? false;
  const hasShowBet = myBets?.show.hasBet ?? false;

  // Get the lane for each bet type if placed
  const winBetLane = hasWinBet ? myBets?.win.lane : null;
  const placeBetLane = hasPlaceBet ? myBets?.place.lane : null;
  const showBetLane = hasShowBet ? myBets?.show.lane : null;

  const handlePlaceBet = async (lane: number, betType: BetType) => {
    await onPlaceBet(lane, betType);
  };

  const renderCompactBetButton = (lane: number, betType: BetType, label: string, odds: string, disabled: boolean) => {
    // Check if THIS bet type on THIS lane is already placed
    let isThisBetPlaced = false;
    if (betType === BET_TYPE.WIN && hasWinBet && winBetLane === lane) isThisBetPlaced = true;
    if (betType === BET_TYPE.PLACE && hasPlaceBet && placeBetLane === lane) isThisBetPlaced = true;
    if (betType === BET_TYPE.SHOW && hasShowBet && showBetLane === lane) isThisBetPlaced = true;

    // Check if bet type is disabled (already placed on any lane)
    let isBetTypeDisabled = false;
    if (betType === BET_TYPE.WIN && hasWinBet) isBetTypeDisabled = true;
    if (betType === BET_TYPE.PLACE && hasPlaceBet) isBetTypeDisabled = true;
    if (betType === BET_TYPE.SHOW && hasShowBet) isBetTypeDisabled = true;

    const btnDisabled = disabled || isBetTypeDisabled || !placeBetValue || needsApproval;

    return (
      <button
        key={betType}
        className={`btn btn-xs px-2 min-w-0 ${isThisBetPlaced ? "btn-primary" : "btn-outline"} ${
          isBetTypeDisabled && !isThisBetPlaced ? "opacity-50" : ""
        }`}
        disabled={btnDisabled}
        onClick={e => {
          e.stopPropagation();
          handlePlaceBet(lane, betType);
        }}
      >
        <div className="flex flex-col items-center leading-tight">
          <span className="text-[10px] font-semibold">{label}</span>
          <span className="text-[9px] opacity-70">{odds}</span>
        </div>
      </button>
    );
  };

  // Get any existing bet markers for a lane
  const getBetMarkers = (lane: number) => {
    const markers: { label: string; color: string }[] = [];
    if (winBetLane === lane) markers.push({ label: "Win", color: "bg-yellow-500 text-yellow-950" });
    if (placeBetLane === lane) markers.push({ label: "Place", color: "bg-blue-400 text-blue-950" });
    if (showBetLane === lane) markers.push({ label: "Show", color: "bg-green-400 text-green-950" });
    return markers;
  };

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h3 className="font-semibold">Place a bet</h3>
        <p className="text-sm opacity-70">
          You can place up to 1 Win (1st place), 1 Place (1st or 2nd place), and 1 Show (1st, 2nd, or 3rd place) bet per
          race.
        </p>

        {/* Bet amount input - always visible */}
        <div className={!canBet ? "opacity-50 pointer-events-none" : ""}>
          <div className="flex flex-col gap-1">
            <div className="relative">
              <input
                type="number"
                step="0.01"
                min="0"
                className="input input-bordered w-full pr-16"
                placeholder="Bet amount"
                value={betAmountUsdc}
                onChange={e => {
                  if (!canBet) return;
                  setBetAmountUsdc(e.target.value);
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm opacity-70">USDC</span>
            </div>
            {connectedAddress && userUsdcBalance !== undefined && (
              <div className="text-xs opacity-60">Balance: {formatUnits(userUsdcBalance, USDC_DECIMALS)} USDC</div>
            )}
            {lineupFinalized && maxBetAmount !== null && (
              <div className="text-xs opacity-70">Max bet: {formatUnits(maxBetAmount, USDC_DECIMALS)} USDC</div>
            )}
            {exceedsMaxBet && maxBetAmount !== null && (
              <div className="text-xs text-error">
                Bet exceeds max bet of {formatUnits(maxBetAmount, USDC_DECIMALS)} USDC
              </div>
            )}
            {placeBetValue && userUsdcBalance !== undefined && !hasEnoughUsdc && (
              <div className="text-xs text-error">Insufficient USDC balance</div>
            )}
          </div>
        </div>

        {/* Approval button if needed */}
        {needsApproval && placeBetValue && (
          <button
            className="btn btn-outline w-full"
            disabled={isApproving || !hasEnoughUsdc || exceedsMaxBet}
            onClick={onApprove}
          >
            {isApproving ? <span className="loading loading-spinner loading-xs" /> : null}
            Approve USDC
          </button>
        )}

        {!needsApproval && placeBetValue && <div className="text-xs text-success">✓ Approved — ready to place bet</div>}

        {/* Lane selection with inline bet type buttons */}
        <div className="flex flex-col gap-2 w-full">
          {Array.from({ length: LANE_COUNT }).map((_, lane) => {
            const betMarkers = getBetMarkers(lane);
            const hasBetOnLane = betMarkers.length > 0;

            return (
              <div
                key={lane}
                className={`border rounded-lg p-2 ${hasBetOnLane ? "border-primary bg-base-200" : "border-base-300"}`}
              >
                <div className="flex items-center gap-2">
                  {/* Left: Avatar + Name */}
                  <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                    <RaffeAnimated
                      idPrefix={`bet-${(viewingRaceId ?? 0n).toString()}-${lane}-${(laneTokenIds[lane] ?? 0n).toString()}`}
                      tokenId={laneTokenIds[lane] ?? 0n}
                      playbackRate={1}
                      playing={false}
                      sizePx={40}
                    />
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-sm font-medium truncate max-w-[80px]">
                        {lineupFinalized && parsedRaffes?.tokenIds?.[lane] && parsedRaffes.tokenIds[lane] !== 0n ? (
                          <LaneName tokenId={parsedRaffes.tokenIds[lane]} fallback={`Lane ${lane}`} />
                        ) : (
                          `Lane ${lane}`
                        )}
                      </span>
                      {betMarkers.length > 0 && (
                        <div className="flex gap-0.5">
                          {betMarkers.map(m => (
                            <span key={m.label} className={`badge badge-xs ${m.color}`}>
                              {m.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Middle: Bet buttons */}
                  <div className="flex gap-1 flex-1 justify-center">
                    {renderCompactBetButton(
                      lane,
                      BET_TYPE.WIN,
                      "Win",
                      winOddsLabelForLane(lane),
                      !raffeRaceContract || !connectedAddress || !canBet || !isViewingLatest,
                    )}
                    {renderCompactBetButton(
                      lane,
                      BET_TYPE.PLACE,
                      "Place",
                      placeOddsLabelForLane(lane),
                      !raffeRaceContract || !connectedAddress || !canBet || !isViewingLatest,
                    )}
                    {renderCompactBetButton(
                      lane,
                      BET_TYPE.SHOW,
                      "Show",
                      showOddsLabelForLane(lane),
                      !raffeRaceContract || !connectedAddress || !canBet || !isViewingLatest,
                    )}
                  </div>

                  {/* Right: Stats */}
                  <div className="flex flex-col items-end text-[10px] opacity-70 flex-shrink-0 leading-tight">
                    <span>Zip:{laneStats[lane]?.zip ?? 10}</span>
                    <span>Moxie:{laneStats[lane]?.moxie ?? 10}</span>
                    <span>Hustle:{laneStats[lane]?.hustle ?? 10}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bet type explanations */}
        <div className="text-xs opacity-60 space-y-1 pt-2 border-t border-base-300">
          <div>
            <strong>Win:</strong> Raffe must finish 1st
          </div>
          <div>
            <strong>Place:</strong> Raffe must finish 1st or 2nd
          </div>
          <div>
            <strong>Show:</strong> Raffe must finish 1st, 2nd, or 3rd
          </div>
          <div className="italic pt-1">Dead heat rules apply for ties at qualifying positions.</div>
        </div>
      </div>
    </div>
  );
};
