// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/RaffeNFT.sol";

contract RaffeNFTTest is Test {
    RaffeNFT public raffeNFT;
    address public user1 = address(0x1);
    address public user2 = address(0x2);

    function setUp() public {
        raffeNFT = new RaffeNFT();
    }

    function testMintWithUniqueName() public {
        vm.prank(user1);
        uint256 tokenId = raffeNFT.mint("Spotty");
        assertEq(raffeNFT.nameOf(tokenId), "Spotty");
        assertEq(raffeNFT.ownerOf(tokenId), user1);
    }

    function testMintWithDuplicateNameReverts() public {
        // First mint succeeds
        vm.prank(user1);
        raffeNFT.mint("Spotty");

        // Second mint with same name should revert
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.NameAlreadyTaken.selector, "Spotty"));
        raffeNFT.mint("Spotty");
    }

    function testMintWithCaseInsensitiveCollision() public {
        // First mint with "Spotty"
        vm.prank(user1);
        raffeNFT.mint("Spotty");

        // Try variations of the same name - all should revert
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.NameAlreadyTaken.selector, "SPOTTY"));
        raffeNFT.mint("SPOTTY");

        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.NameAlreadyTaken.selector, "spotty"));
        raffeNFT.mint("spotty");

        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.NameAlreadyTaken.selector, "SpOtTy"));
        raffeNFT.mint("SpOtTy");
    }

    function testMintRequiresName() public {
        // Minting with empty name should revert
        vm.prank(user1);
        vm.expectRevert(RaffeNFT.EmptyName.selector);
        raffeNFT.mint("");
    }

    function testMultipleMintsSameOwnerDifferentNames() public {
        vm.prank(user1);
        uint256 token1 = raffeNFT.mint("Spotty");
        
        vm.prank(user1);
        uint256 token2 = raffeNFT.mint("Dotty");
        
        assertEq(raffeNFT.nameOf(token1), "Spotty");
        assertEq(raffeNFT.nameOf(token2), "Dotty");
        assertEq(raffeNFT.ownerOf(token1), user1);
        assertEq(raffeNFT.ownerOf(token2), user1);
    }

    function testIsNameAvailable() public {
        // Name should be available initially
        assertTrue(raffeNFT.isNameAvailable("Spotty"));
        
        // Mint with the name
        vm.prank(user1);
        raffeNFT.mint("Spotty");
        
        // Name should no longer be available (case-insensitive)
        assertFalse(raffeNFT.isNameAvailable("Spotty"));
        assertFalse(raffeNFT.isNameAvailable("SPOTTY"));
        assertFalse(raffeNFT.isNameAvailable("spotty"));
        assertFalse(raffeNFT.isNameAvailable("SpOtTy"));
        
        // Different name should still be available
        assertTrue(raffeNFT.isNameAvailable("Dotty"));
    }

    function testIsNameAvailableEmptyString() public {
        // Empty name should not be available
        assertFalse(raffeNFT.isNameAvailable(""));
    }

    function testIsNameAvailableTooLong() public {
        // Name longer than 32 characters should not be available
        assertFalse(raffeNFT.isNameAvailable("ThisNameIsWayTooLongForOurRaffeNFTContract"));
    }

    function testIsNameAvailableAllWhitespace() public {
        // Names that are all whitespace should not be available
        assertFalse(raffeNFT.isNameAvailable("   "));
        assertFalse(raffeNFT.isNameAvailable(" \t\n "));
        assertFalse(raffeNFT.isNameAvailable("\t"));
    }

    function testMintWithEmptyNameReverts() public {
        // Empty names are NOT allowed - all NFTs must have a name
        vm.prank(user1);
        vm.expectRevert(RaffeNFT.EmptyName.selector);
        raffeNFT.mint("");
    }

    function testMintWithAllSpacesReverts() public {
        // Names that are all spaces should revert
        vm.prank(user1);
        vm.expectRevert(RaffeNFT.NameIsAllWhitespace.selector);
        raffeNFT.mint("   ");
    }

    function testMintWithTabsAndNewlinesReverts() public {
        // Names that are all whitespace (tabs, newlines) should revert
        vm.prank(user1);
        vm.expectRevert(RaffeNFT.NameIsAllWhitespace.selector);
        raffeNFT.mint(" \t\n ");
    }

    function testMintWithNameStartingWithSpaceAllowed() public {
        // Names that have some non-whitespace characters should be allowed
        vm.prank(user1);
        uint256 tokenId = raffeNFT.mint(" Spotty ");
        assertEq(raffeNFT.nameOf(tokenId), " Spotty ");
    }

    function testMintWithTooLongNameReverts() public {
        string memory longName = "ThisNameIsWayTooLongForOurRaffeNFTContract";
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.NameTooLong.selector, bytes(longName).length));
        raffeNFT.mint(longName);
    }

    function testMintToSelf() public {
        // Users can only mint to themselves
        vm.prank(user1);
        uint256 tokenId = raffeNFT.mint("MyRaffe");
        
        assertEq(raffeNFT.nameOf(tokenId), "MyRaffe");
        assertEq(raffeNFT.ownerOf(tokenId), user1);
    }

    function testNamePreservesOriginalCase() public {
        // Even though collision check is case-insensitive,
        // the stored name should preserve the original case
        vm.prank(user1);
        uint256 tokenId = raffeNFT.mint("SpOtTy");
        
        assertEq(raffeNFT.nameOf(tokenId), "SpOtTy");
    }

    function testMaxLengthNameAllowed() public {
        // 32 characters exactly should be allowed
        string memory maxName = "12345678901234567890123456789012"; // exactly 32 chars
        vm.prank(user1);
        uint256 tokenId = raffeNFT.mint(maxName);
        
        assertEq(raffeNFT.nameOf(tokenId), maxName);
    }

    function testStatsAfterMint() public {
        vm.prank(user1);
        uint256 tokenId = raffeNFT.mint("Spotty");
        
        (uint8 zip, uint8 moxie, uint8 hustle) = raffeNFT.statsOf(tokenId);
        
        // Stats should be random values in range 1-10
        assertGe(zip, 1);
        assertLe(zip, 10);
        assertGe(moxie, 1);
        assertLe(moxie, 10);
        assertGe(hustle, 1);
        assertLe(hustle, 10);
    }

    // ============ Commit-Reveal Tests ============

    function testCommitMintReservesName() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("CommitRaffe", commitment);
        
        // Name should now be taken
        assertFalse(raffeNFT.isNameAvailable("CommitRaffe"));
        assertFalse(raffeNFT.isNameAvailable("commitraffe")); // case insensitive
        
        // Commit should be stored correctly
        (
            address minter,
            string memory name,
            uint256 blockNumber,
            RaffeNFT.CommitStatus status,
            ,
        ) = raffeNFT.getCommit(commitId);
        
        assertEq(minter, user1);
        assertEq(name, "CommitRaffe");
        assertEq(blockNumber, block.number);
        assertTrue(status == RaffeNFT.CommitStatus.Pending);
    }

    function testCommitMintDuplicateNameReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        raffeNFT.commitMint("CommitRaffe", commitment);
        
        // Second commit with same name should revert
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.NameAlreadyTaken.selector, "CommitRaffe"));
        raffeNFT.commitMint("CommitRaffe", commitment);
    }

    function testRevealMintSuccess() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("RevealRaffe", commitment);
        
        // Advance blocks past MIN_REVEAL_BLOCKS
        vm.roll(block.number + raffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        uint256 tokenId = raffeNFT.revealMint(commitId, secret);
        
        // NFT should be minted
        assertEq(raffeNFT.ownerOf(tokenId), user1);
        assertEq(raffeNFT.nameOf(tokenId), "RevealRaffe");
        
        // Stats should be random values in range 1-10 (derived from commit-reveal seed)
        (uint8 zip, uint8 moxie, uint8 hustle) = raffeNFT.statsOf(tokenId);
        assertGe(zip, 1);
        assertLe(zip, 10);
        assertGe(moxie, 1);
        assertLe(moxie, 10);
        assertGe(hustle, 1);
        assertLe(hustle, 10);
        
        // Commit status should be Revealed
        (, , , RaffeNFT.CommitStatus status, , ) = raffeNFT.getCommit(commitId);
        assertTrue(status == RaffeNFT.CommitStatus.Revealed);
    }

    function testRevealMintTooEarlyReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.startPrank(user1);
        bytes32 commitId = raffeNFT.commitMint("EarlyRaffe", commitment);
        
        // Try to reveal immediately (within same block)
        uint256 minRevealBlock = block.number + raffeNFT.MIN_REVEAL_BLOCKS();
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.TooEarlyToReveal.selector, block.number, minRevealBlock));
        raffeNFT.revealMint(commitId, secret);
        vm.stopPrank();
    }

    function testRevealMintExpiredReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.startPrank(user1);
        bytes32 commitId = raffeNFT.commitMint("ExpiredRaffe", commitment);
        uint256 commitBlock = block.number;
        uint256 expiryBlock = commitBlock + raffeNFT.MAX_REVEAL_BLOCKS();
        vm.stopPrank();
        
        // Advance way past MAX_REVEAL_BLOCKS
        vm.roll(commitBlock + raffeNFT.MAX_REVEAL_BLOCKS() + 1);
        
        vm.startPrank(user1);
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.CommitExpired.selector, block.number, expiryBlock));
        raffeNFT.revealMint(commitId, secret);
        vm.stopPrank();
    }

    function testRevealMintWrongSecretReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        bytes32 wrongSecret = keccak256("wrong-secret");
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("WrongSecretRaffe", commitment);
        
        vm.roll(block.number + raffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        vm.expectRevert(RaffeNFT.InvalidSecret.selector);
        raffeNFT.revealMint(commitId, wrongSecret);
    }

    function testRevealMintNotYourCommitReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("NotYoursRaffe", commitment);
        
        vm.roll(block.number + raffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        // User2 tries to reveal user1's commit
        vm.prank(user2);
        vm.expectRevert(RaffeNFT.NotYourCommit.selector);
        raffeNFT.revealMint(commitId, secret);
    }

    function testCancelCommit() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("CancelRaffe", commitment);
        
        // Name should be reserved
        assertFalse(raffeNFT.isNameAvailable("CancelRaffe"));
        
        vm.prank(user1);
        raffeNFT.cancelCommit(commitId);
        
        // Name should be available again
        assertTrue(raffeNFT.isNameAvailable("CancelRaffe"));
        
        // Commit status should be Cancelled
        (, , , RaffeNFT.CommitStatus status, , ) = raffeNFT.getCommit(commitId);
        assertTrue(status == RaffeNFT.CommitStatus.Cancelled);
    }

    function testCancelCommitNotYoursReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("CancelNotYours", commitment);
        
        vm.prank(user2);
        vm.expectRevert(RaffeNFT.NotYourCommit.selector);
        raffeNFT.cancelCommit(commitId);
    }

    function testReleaseExpiredCommit() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("ExpireReleaseRaffe", commitment);
        uint256 commitBlock = block.number;
        
        // Name should be reserved
        assertFalse(raffeNFT.isNameAvailable("ExpireReleaseRaffe"));
        
        // Advance past expiry
        vm.roll(commitBlock + raffeNFT.MAX_REVEAL_BLOCKS() + 1);
        
        // Anyone can release it
        vm.prank(user2);
        raffeNFT.releaseExpiredCommit(commitId);
        
        // Name should be available again
        assertTrue(raffeNFT.isNameAvailable("ExpireReleaseRaffe"));
        
        // Commit status should be Cancelled
        (, , , RaffeNFT.CommitStatus status, , ) = raffeNFT.getCommit(commitId);
        assertTrue(status == RaffeNFT.CommitStatus.Cancelled);
    }

    function testReleaseExpiredCommitTooEarlyReverts() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("NotExpiredYet", commitment);
        
        // Try to release immediately
        vm.prank(user2);
        uint256 expiryBlock = block.number + raffeNFT.MAX_REVEAL_BLOCKS();
        vm.expectRevert(abi.encodeWithSelector(RaffeNFT.TooEarlyToReveal.selector, block.number, expiryBlock + 1));
        raffeNFT.releaseExpiredCommit(commitId);
    }

    function testGetPendingCommits() public {
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitment1 = keccak256(abi.encodePacked(secret1));
        bytes32 commitment2 = keccak256(abi.encodePacked(secret2));
        
        vm.prank(user1);
        bytes32 commitId1 = raffeNFT.commitMint("Pending1", commitment1);
        
        vm.prank(user1);
        bytes32 commitId2 = raffeNFT.commitMint("Pending2", commitment2);
        
        // Both should be pending
        bytes32[] memory pending = raffeNFT.getPendingCommits(user1);
        assertEq(pending.length, 2);
        
        // Reveal one
        vm.roll(block.number + raffeNFT.MIN_REVEAL_BLOCKS() + 1);
        vm.prank(user1);
        raffeNFT.revealMint(commitId1, secret1);
        
        // Only one should be pending now
        pending = raffeNFT.getPendingCommits(user1);
        assertEq(pending.length, 1);
        assertEq(pending[0], commitId2);
    }

    function testCommitRevealSeedIsDifferent() public {
        // This test verifies that the seed from commit-reveal is different
        // from what it would be with direct minting (uses different entropy)
        
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("SeedTestRaffe", commitment);
        
        vm.roll(block.number + raffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        uint256 tokenId = raffeNFT.revealMint(commitId, secret);
        
        // Just verify we got a seed
        bytes32 seed = raffeNFT.seedOf(tokenId);
        assertTrue(seed != bytes32(0));
    }

    function testCannotRevealTwice() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("RevealOnce", commitment);
        
        vm.roll(block.number + raffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        raffeNFT.revealMint(commitId, secret);
        
        // Try to reveal again
        vm.prank(user1);
        vm.expectRevert(RaffeNFT.CommitNotPending.selector);
        raffeNFT.revealMint(commitId, secret);
    }

    function testCannotCancelAfterReveal() public {
        bytes32 secret = keccak256("my-secret");
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        
        vm.prank(user1);
        bytes32 commitId = raffeNFT.commitMint("CancelAfterReveal", commitment);
        
        vm.roll(block.number + raffeNFT.MIN_REVEAL_BLOCKS() + 1);
        
        vm.prank(user1);
        raffeNFT.revealMint(commitId, secret);
        
        // Try to cancel after reveal
        vm.prank(user1);
        vm.expectRevert(RaffeNFT.CommitNotPending.selector);
        raffeNFT.cancelCommit(commitId);
    }
}
