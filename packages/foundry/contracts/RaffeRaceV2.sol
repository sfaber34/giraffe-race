// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { RaffeRaceAdmin } from "./RaffeRaceAdmin.sol";
import { RaffeRaceBetting } from "./RaffeRaceBetting.sol";
import { RaffeRaceSubmissions } from "./RaffeRaceSubmissions.sol";
import { RaffeRaceLifecycle } from "./RaffeRaceLifecycle.sol";
import { RaffeRaceViews } from "./RaffeRaceViews.sol";
import { IRaffeNFT } from "./RaffeRaceBase.sol";
import { RaffeRaceSimulator } from "./RaffeRaceSimulator.sol";
import { HouseTreasury } from "./HouseTreasury.sol";

/**
 * @title RaffeRace
 * @notice Main RaffeRace contract - combines all modules via inheritance
 * @dev Single contract address with all functionality, no Diamond pattern complexity
 * 
 * Architecture:
 *   RaffeRace
 *     ├── RaffeRaceAdmin (config functions)
 *     ├── RaffeRaceBetting (bet placement & claims)
 *     ├── RaffeRaceSubmissions (NFT entries)
 *     ├── RaffeRaceLifecycle (create/settle races)
 *     └── RaffeRaceViews (read-only getters)
 *           └── all inherit RaffeRaceBase (shared state)
 */
contract RaffeRace is 
    RaffeRaceAdmin,
    RaffeRaceBetting,
    RaffeRaceSubmissions,
    RaffeRaceLifecycle,
    RaffeRaceViews 
{
    constructor(
        address _raffeNft,
        address _treasuryOwner,
        address _raceBot,
        uint256[6] memory _houseRaffeTokenIds,
        address _simulator,
        address _treasury
    ) {
        raffeNft = IRaffeNFT(_raffeNft);
        treasuryOwner = _treasuryOwner;
        raceBot = _raceBot;
        simulator = RaffeRaceSimulator(_simulator);
        treasury = HouseTreasury(_treasury);
        houseRaffeTokenIds = _houseRaffeTokenIds;
        
        // Set defaults
        houseEdgeBps = 500; // 5%
        maxBetAmount = 5_000_000; // 5 USDC (6 decimals)

        // Validate house raffe token IDs
        for (uint256 i = 0; i < LANE_COUNT; i++) {
            require(_houseRaffeTokenIds[i] != 0, "RaffeRace: Invalid house raffe");
        }
    }
}
