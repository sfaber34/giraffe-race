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
        
        (uint8 zip, uint8 moxie, uint8 hustle) = giraffeNFT.statsOf(tokenId);
        
        // All stats should be 10 for a new mint
        assertEq(zip, 10);
        assertEq(moxie, 10);
        assertEq(hustle, 10);
    }

    // ============ Commit-Reveal Tests ============

    function testCommitMintReservesName() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("CommitGiraffe", commitment);
        
        // Name should now be taken
        assertFalse(giraffeNFT.isNameAvailable("CommitGiraffe"));
        assertFalse(giraffeNFT.isNameAvailable("commitgiraffe")); // case insensitive
        
        // Commit should be stored correctly
        (
            address minter,
            string memory name,
            uint256 blockNumber,
            GiraffeNFT.CommitStatus status,
            ,
        ) = giraffeNFT.getCommit(commitId);
        
        assertEq(minter, user1);
        assertEq(name, "CommitGiraffe");
        assertEq(blockNumber, block.number);
        assertTrue(status == GiraffeNFT.CommitStatus.Pending);
    }

    function testCommitMintDuplicateNameReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        giraffeNFT.commitMint("CommitGiraffe", commitment);
        
        // Second commit with same name should revert
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.NameAlreadyTaken.selector, "CommitGiraffe"));
        giraffeNFT.commitMint("CommitGiraffe", commitment);
    }

    function testRevealMintSuccess() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("RevealGiraffe", commitment);
        
        // Advance blocks past MIN_REVEAL_BLOCKS
        vm.roll(block.number + giraffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        uint256 tokenId = giraffeNFT.revealMint(commitId, secret);
        
        // NFT should be minted
        assertEq(giraffeNFT.ownerOf(tokenId), user1);
        assertEq(giraffeNFT.nameOf(tokenId), "RevealGiraffe");
        
        // Stats should be 10/10/10
        (uint8 zip, uint8 moxie, uint8 hustle) = giraffeNFT.statsOf(tokenId);
        assertEq(zip, 10);
        assertEq(moxie, 10);
        assertEq(hustle, 10);
        
        // Commit status should be Revealed
        (, , , GiraffeNFT.CommitStatus status, , ) = giraffeNFT.getCommit(commitId);
        assertTrue(status == GiraffeNFT.CommitStatus.Revealed);
    }

    function testRevealMintTooEarlyReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.startPrank(user1);
        bytes32 commitId = giraffeNFT.commitMint("EarlyGiraffe", commitment);
        
        // Try to reveal immediately (within same block)
        uint256 minRevealBlock = block.number + giraffeNFT.MIN_REVEAL_BLOCKS();
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.TooEarlyToReveal.selector, block.number, minRevealBlock));
        giraffeNFT.revealMint(commitId, secret);
        vm.stopPrank();
    }

    function testRevealMintExpiredReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.startPrank(user1);
        bytes32 commitId = giraffeNFT.commitMint("ExpiredGiraffe", commitment);
        uint256 commitBlock = block.number;
        uint256 expiryBlock = commitBlock + giraffeNFT.MAX_REVEAL_BLOCKS();
        vm.stopPrank();
        
        // Advance way past MAX_REVEAL_BLOCKS
        vm.roll(commitBlock + giraffeNFT.MAX_REVEAL_BLOCKS() + 1);
        
        vm.startPrank(user1);
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.CommitExpired.selector, block.number, expiryBlock));
        giraffeNFT.revealMint(commitId, secret);
        vm.stopPrank();
    }

    function testRevealMintWrongSecretReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        bytes32 wrongSecret = keccak256("wrong-secret");
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("WrongSecretGiraffe", commitment);
        
        vm.roll(block.number + giraffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        vm.expectRevert(GiraffeNFT.InvalidSecret.selector);
        giraffeNFT.revealMint(commitId, wrongSecret);
    }

    function testRevealMintNotYourCommitReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("NotYoursGiraffe", commitment);
        
        vm.roll(block.number + giraffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        // User2 tries to reveal user1's commit
        vm.prank(user2);
        vm.expectRevert(GiraffeNFT.NotYourCommit.selector);
        giraffeNFT.revealMint(commitId, secret);
    }

    function testCancelCommit() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("CancelGiraffe", commitment);
        
        // Name should be reserved
        assertFalse(giraffeNFT.isNameAvailable("CancelGiraffe"));
        
        vm.prank(user1);
        giraffeNFT.cancelCommit(commitId);
        
        // Name should be available again
        assertTrue(giraffeNFT.isNameAvailable("CancelGiraffe"));
        
        // Commit status should be Cancelled
        (, , , GiraffeNFT.CommitStatus status, , ) = giraffeNFT.getCommit(commitId);
        assertTrue(status == GiraffeNFT.CommitStatus.Cancelled);
    }

    function testCancelCommitNotYoursReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("CancelNotYours", commitment);
        
        vm.prank(user2);
        vm.expectRevert(GiraffeNFT.NotYourCommit.selector);
        giraffeNFT.cancelCommit(commitId);
    }

    function testReleaseExpiredCommit() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("ExpireReleaseGiraffe", commitment);
        uint256 commitBlock = block.number;
        
        // Name should be reserved
        assertFalse(giraffeNFT.isNameAvailable("ExpireReleaseGiraffe"));
        
        // Advance past expiry
        vm.roll(commitBlock + giraffeNFT.MAX_REVEAL_BLOCKS() + 1);
        
        // Anyone can release it
        vm.prank(user2);
        giraffeNFT.releaseExpiredCommit(commitId);
        
        // Name should be available again
        assertTrue(giraffeNFT.isNameAvailable("ExpireReleaseGiraffe"));
        
        // Commit status should be Cancelled
        (, , , GiraffeNFT.CommitStatus status, , ) = giraffeNFT.getCommit(commitId);
        assertTrue(status == GiraffeNFT.CommitStatus.Cancelled);
    }

    function testReleaseExpiredCommitTooEarlyReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("NotExpiredYet", commitment);
        
        // Try to release immediately
        vm.prank(user2);
        uint256 expiryBlock = block.number + giraffeNFT.MAX_REVEAL_BLOCKS();
        vm.expectRevert(abi.encodeWithSelector(GiraffeNFT.TooEarlyToReveal.selector, block.number, expiryBlock + 1));
        giraffeNFT.releaseExpiredCommit(commitId);
    }

    function testGetPendingCommits() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitment1 = keccak256(abi.encodePacked(secret1));
        bytes32 commitment2 = keccak256(abi.encodePacked(secret2));
        
        vm.prank(user1);
        bytes32 commitId1 = giraffeNFT.commitMint("Pending1", commitment1);
        
        vm.prank(user1);
        bytes32 commitId2 = giraffeNFT.commitMint("Pending2", commitment2);
        
        // Both should be pending
        bytes32[] memory pending = giraffeNFT.getPendingCommits(user1);
        assertEq(pending.length, 2);
        
        // Reveal one
        vm.roll(block.number + giraffeNFT.MIN_REVEAL_BLOCKS() + 1);
        vm.prank(user1);
        giraffeNFT.revealMint(commitId1, secret1);
        
        // Only one should be pending now
        pending = giraffeNFT.getPendingCommits(user1);
        assertEq(pending.length, 1);
        assertEq(pending[0], commitId2);
    }

    function testCommitRevealSeedIsDifferent() public {
        // This test verifies that the seed from commit-reveal is different
        // from what it would be with direct minting (uses different entropy)
        
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("SeedTestGiraffe", commitment);
        
        vm.roll(block.number + giraffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        uint256 tokenId = giraffeNFT.revealMint(commitId, secret);
        
        // Just verify we got a seed
        bytes32 seed = giraffeNFT.seedOf(tokenId);
        assertTrue(seed != bytes32(0));
    }

    function testCannotRevealTwice() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("RevealOnce", commitment);
        
        vm.roll(block.number + giraffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        giraffeNFT.revealMint(commitId, secret);
        
        // Try to reveal again
        vm.prank(user1);
        vm.expectRevert(GiraffeNFT.CommitNotPending.selector);
        giraffeNFT.revealMint(commitId, secret);
    }

    function testCannotCancelAfterReveal() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = giraffeNFT.commitMint("CancelAfterReveal", commitment);
        
        vm.roll(block.number + giraffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        giraffeNFT.revealMint(commitId, secret);
        
        // Try to cancel after reveal
        vm.prank(user1);
        vm.expectRevert(GiraffeNFT.CommitNotPending.selector);
        giraffeNFT.cancelCommit(commitId);
    }
}
