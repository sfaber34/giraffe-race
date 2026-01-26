// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { GiraffeRaceAdmin } from "./GiraffeRaceAdmin.sol";
import { GiraffeRaceBetting } from "./GiraffeRaceBetting.sol";
import { GiraffeRaceSubmissions } from "./GiraffeRaceSubmissions.sol";
import { GiraffeRaceLifecycle } from "./GiraffeRaceLifecycle.sol";
import { GiraffeRaceViews } from "./GiraffeRaceViews.sol";
import { IGiraffeNFT, IWinProbTable6 } from "./GiraffeRaceBase.sol";
import { GiraffeRaceSimulator } from "./GiraffeRaceSimulator.sol";
import { HouseTreasury } from "./HouseTreasury.sol";

/**
 * @title GiraffeRace
 * @notice Main GiraffeRace contract - combines all modules via inheritance
 * @dev Single contract address with all functionality, no Diamond pattern complexity
 * 
 * Architecture:
 *   GiraffeRace
 *     ├── GiraffeRaceAdmin (config functions)
 *     ├── GiraffeRaceBetting (bet placement & claims)
 *     ├── GiraffeRaceSubmissions (NFT entries)
 *     ├── GiraffeRaceLifecycle (create/settle races)
 *     └── GiraffeRaceViews (read-only getters)
 *           └── all inherit GiraffeRaceBase (shared state)
 */
contract GiraffeRace is 
    GiraffeRaceAdmin,
    GiraffeRaceBetting,
    GiraffeRaceSubmissions,
    GiraffeRaceLifecycle,
    GiraffeRaceViews 
{
    constructor(
        address _giraffeNft,
        address _treasuryOwner,
        uint256[6] memory _houseGiraffeTokenIds,
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
        
        // Set defaults
        houseEdgeBps = 500; // 5%
        maxBetAmount = 5_000_000; // 5 USDC (6 decimals)

        // Validate house giraffe token IDs
        for (uint256 i = 0; i < LANE_COUNT; i++) {
            require(_houseGiraffeTokenIds[i] != 0, "GiraffeRace: Invalid house giraffe");
        }
    }
}
