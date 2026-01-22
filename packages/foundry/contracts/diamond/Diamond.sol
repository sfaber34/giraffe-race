// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { LibDiamond } from "./libraries/LibDiamond.sol";
import { GiraffeRaceStorage, IGiraffeNFT, IWinProbTable6 } from "./libraries/GiraffeRaceStorage.sol";
import { GiraffeRaceSimulator } from "../GiraffeRaceSimulator.sol";
import { HouseTreasury } from "../HouseTreasury.sol";

/**
 * @title GiraffeRaceDiamond
 * @notice EIP-2535 Diamond implementation for the GiraffeRace betting platform
 * @dev Main entry point that delegates calls to appropriate facets
 */
contract GiraffeRaceDiamond {
    constructor(
        address _contractOwner,
        address _diamondCutFacet,
        DiamondArgs memory _args
    ) payable {
        LibDiamond.setContractOwner(_contractOwner);

        // Add the diamondCut external function from the diamondCutFacet
        LibDiamond.FacetCut[] memory cut = new LibDiamond.FacetCut[](1);
        bytes4[] memory functionSelectors = new bytes4[](1);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;
        cut[0] = LibDiamond.FacetCut({
            facetAddress: _diamondCutFacet,
            action: LibDiamond.FacetCutAction.Add,
            functionSelectors: functionSelectors
        });
        LibDiamond.diamondCut(cut, address(0), "");

        // Initialize GiraffeRace storage
        _initializeGiraffeRaceStorage(_args);
    }

    struct DiamondArgs {
        address giraffeNft;
        address treasuryOwner;
        uint256[6] houseGiraffeTokenIds;
        address simulator;
        address treasury;
        address winProbTable;
    }

    function _initializeGiraffeRaceStorage(DiamondArgs memory _args) internal {
        GiraffeRaceStorage.Layout storage s = GiraffeRaceStorage.layout();
        
        s.giraffeNft = IGiraffeNFT(_args.giraffeNft);
        s.treasuryOwner = _args.treasuryOwner;
        s.simulator = GiraffeRaceSimulator(_args.simulator);
        s.treasury = HouseTreasury(_args.treasury);
        s.winProbTable = IWinProbTable6(_args.winProbTable);
        s.houseGiraffeTokenIds = _args.houseGiraffeTokenIds;
        
        // Set defaults
        s.houseEdgeBps = 500; // 5%
        s.maxBetAmount = 5_000_000; // 5 USDC (6 decimals)

        // Validate house giraffe token IDs
        for (uint256 i = 0; i < GiraffeRaceStorage.LANE_COUNT; i++) {
            require(_args.houseGiraffeTokenIds[i] != 0, "GiraffeRaceDiamond: Invalid house giraffe");
        }
    }

    // Find facet for function that is called and execute the
    // function if a facet is found and return any value.
    fallback() external payable {
        LibDiamond.DiamondStorage storage ds;
        bytes32 position = LibDiamond.DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
        // get facet from function selector
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "Diamond: Function does not exist");
        // Execute external function from facet using delegatecall and return any value.
        assembly {
            // copy function selector and any arguments
            calldatacopy(0, 0, calldatasize())
            // execute function call using the facet
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            // get any return value
            returndatacopy(0, 0, returndatasize())
            // return any return value or error back to the caller
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}

// Interface for the diamondCut function
interface IDiamondCut {
    function diamondCut(
        LibDiamond.FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external;
}
