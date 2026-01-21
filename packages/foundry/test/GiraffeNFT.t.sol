// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/GiraffeNFT.sol";

contract GiraffeNFTTest is Test {
    GiraffeNFT public giraffeNFT;
    address public user1 = address(0x1);
    address public user2 = address(0x2);

    function setUp() public {
        giraffeNFT = new GiraffeNFT();
    }

    function testMintWithUniqueName() public {
        vm.prank(user1);
        uint256 tokenId = giraffeNFT.mint("Spotty");
        assertEq(giraffeNFT.nameOf(tokenId), "Spotty");
        assertEq(giraffeNFT.ownerOf(tokenId), user1);
    }

    function testMintWithDuplicateNameReverts() public {
        // First mint succeeds
        vm.prank(user1);
        giraffeNFT.mint("Spotty");

        // Second mint with same name should revert
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.NameAlreadyTaken.selector, "Spotty"));
        giraffeNFT.mint("Spotty");
    }

    function testMintWithCaseInsensitiveCollision() public {
        // First mint with "Spotty"
        vm.prank(user1);
        giraffeNFT.mint("Spotty");

        // Try variations of the same name - all should revert
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.NameAlreadyTaken.selector, "SPOTTY"));
        giraffeNFT.mint("SPOTTY");

        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.NameAlreadyTaken.selector, "spotty"));
        giraffeNFT.mint("spotty");

        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.NameAlreadyTaken.selector, "SpOtTy"));
        giraffeNFT.mint("SpOtTy");
    }

    function testMintRequiresName() public {
        // Minting with empty name should revert
        vm.prank(user1);
        vm.expectRevert(GiraffeNFT.EmptyName.selector);
        giraffeNFT.mint("");
    }

    function testMultipleMintsSameOwnerDifferentNames() public {
        vm.prank(user1);
        uint256 token1 = giraffeNFT.mint("Spotty");
        
        vm.prank(user1);
        uint256 token2 = giraffeNFT.mint("Dotty");
        
        assertEq(giraffeNFT.nameOf(token1), "Spotty");
        assertEq(giraffeNFT.nameOf(token2), "Dotty");
        assertEq(giraffeNFT.ownerOf(token1), user1);
        assertEq(giraffeNFT.ownerOf(token2), user1);
    }

    function testIsNameAvailable() public {
        // Name should be available initially
        assertTrue(giraffeNFT.isNameAvailable("Spotty"));
        
        // Mint with the name
        vm.prank(user1);
        giraffeNFT.mint("Spotty");
        
        // Name should no longer be available (case-insensitive)
        assertFalse(giraffeNFT.isNameAvailable("Spotty"));
        assertFalse(giraffeNFT.isNameAvailable("SPOTTY"));
        assertFalse(giraffeNFT.isNameAvailable("spotty"));
        assertFalse(giraffeNFT.isNameAvailable("SpOtTy"));
        
        // Different name should still be available
        assertTrue(giraffeNFT.isNameAvailable("Dotty"));
    }

    function testIsNameAvailableEmptyString() public {
        // Empty name should not be available
        assertFalse(giraffeNFT.isNameAvailable(""));
    }

    function testIsNameAvailableTooLong() public {
        // Name longer than 32 characters should not be available
        assertFalse(giraffeNFT.isNameAvailable("ThisNameIsWayTooLongForOurGiraffeNFTContract"));
    }

    function testIsNameAvailableAllWhitespace() public {
        // Names that are all whitespace should not be available
        assertFalse(giraffeNFT.isNameAvailable("   "));
        assertFalse(giraffeNFT.isNameAvailable(" \t\n "));
        assertFalse(giraffeNFT.isNameAvailable("\t"));
    }

    function testMintWithEmptyNameReverts() public {
        // Empty names are NOT allowed - all NFTs must have a name
        vm.prank(user1);
        vm.expectRevert(GiraffeNFT.EmptyName.selector);
        giraffeNFT.mint("");
    }

    function testMintWithAllSpacesReverts() public {
        // Names that are all spaces should revert
        vm.prank(user1);
        vm.expectRevert(GiraffeNFT.NameIsAllWhitespace.selector);
        giraffeNFT.mint("   ");
    }

    function testMintWithTabsAndNewlinesReverts() public {
        // Names that are all whitespace (tabs, newlines) should revert
        vm.prank(user1);
        vm.expectRevert(GiraffeNFT.NameIsAllWhitespace.selector);
        giraffeNFT.mint(" \t\n ");
    }

    function testMintWithNameStartingWithSpaceAllowed() public {
        // Names that have some non-whitespace characters should be allowed
        vm.prank(user1);
        uint256 tokenId = giraffeNFT.mint(" Spotty ");
        assertEq(giraffeNFT.nameOf(tokenId), " Spotty ");
    }

    function testMintWithTooLongNameReverts() public {
        string memory longName = "ThisNameIsWayTooLongForOurGiraffeNFTContract";
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.NameTooLong.selector, bytes(longName).length));
        giraffeNFT.mint(longName);
    }

    function testMintToSelf() public {
        // Users can only mint to themselves
        vm.prank(user1);
        uint256 tokenId = giraffeNFT.mint("MyGiraffe");
        
        assertEq(giraffeNFT.nameOf(tokenId), "MyGiraffe");
        assertEq(giraffeNFT.ownerOf(tokenId), user1);
    }

    function testNamePreservesOriginalCase() public {
        // Even though collision check is case-insensitive,
        // the stored name should preserve the original case
        vm.prank(user1);
        uint256 tokenId = giraffeNFT.mint("SpOtTy");
        
        assertEq(giraffeNFT.nameOf(tokenId), "SpOtTy");
    }

    function testMaxLengthNameAllowed() public {
        // 32 characters exactly should be allowed
        string memory maxName = "12345678901234567890123456789012"; // exactly 32 chars
        vm.prank(user1);
        uint256 tokenId = giraffeNFT.mint(maxName);
        
        assertEq(giraffeNFT.nameOf(tokenId), maxName);
    }

    function testStatsAfterMint() public {
        vm.prank(user1);
        uint256 tokenId = giraffeNFT.mint("Spotty");
        
        (uint8 readiness, uint8 conditioning, uint8 speed) = giraffeNFT.statsOf(tokenId);
        
        // All stats should be 10 for a new mint
        assertEq(readiness, 10);
        assertEq(conditioning, 10);
        assertEq(speed, 10);
    }
}
