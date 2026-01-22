// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IDiamondLoupe
 * @notice Interface for Diamond introspection (ERC-2535)
 */
interface IDiamondLoupe {
    struct Facet {
        address facetAddress;
        bytes4[] functionSelectors;
    }

    function facets() external view returns (Facet[] memory facets_);
    function facetFunctionSelectors(address _facet) external view returns (bytes4[] memory facetFunctionSelectors_);
    function facetAddresses() external view returns (address[] memory facetAddresses_);
    function facetAddress(bytes4 _functionSelector) external view returns (address facetAddress_);
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
