// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { LibDiamond } from "../libraries/LibDiamond.sol";

/**
 * @title IDiamondCut
 * @notice Interface for the DiamondCut facet
 */
interface IDiamondCut {
    function diamondCut(
        LibDiamond.FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external;
}
