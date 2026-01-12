// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title DeterministicDice
 * @notice A deterministic random number generator seeded by a bytes32 hash.
 * @dev Consumes entropy nibble-by-nibble and re-hashes when exhausted.
 *      Uses rejection sampling to avoid modulo bias.
 *
 *      This implementation matches the TypeScript DeterministicDice class
 *      for JS/Solidity parity in game simulations.
 */
library DeterministicDice {
    /**
     * @notice State for the deterministic dice
     * @param entropy The current 32-byte entropy pool
     * @param position Current nibble position (0-63, since bytes32 has 64 nibbles)
     */
    struct Dice {
        bytes32 entropy;
        uint8 position;
    }

    /**
     * @notice Create a new dice instance from a seed
     * @param seed The bytes32 seed to initialize entropy
     * @return A new Dice struct ready for rolling
     */
    function create(bytes32 seed) internal pure returns (Dice memory) {
        return Dice({ entropy: seed, position: 0 });
    }

    /**
     * @notice Roll a random number from 0 to n-1 (n possible values)
     * @dev Uses rejection sampling to avoid modulo bias
     * @param self The dice state
     * @param n The number of possible outcomes (must be > 0)
     * @return result The random number in range [0, n-1]
     * @return updatedDice The updated dice state (must be used for subsequent rolls)
     */
    function roll(Dice memory self, uint256 n) internal pure returns (uint256 result, Dice memory updatedDice) {
        require(n > 0, "DeterministicDice: n must be > 0");

        // Calculate bits needed to represent the range
        uint256 bitsNeeded = _ceilLog2(n);

        // Calculate hex chars (nibbles) needed: ceil(bitsNeeded / 4)
        uint256 hexCharsNeeded = (bitsNeeded + 3) / 4;
        if (hexCharsNeeded == 0) hexCharsNeeded = 1;

        // Max value that can be represented with hexCharsNeeded nibbles
        uint256 maxValue = 16 ** hexCharsNeeded;

        // Threshold for rejection sampling - largest multiple of n <= maxValue
        uint256 threshold = maxValue - (maxValue % n);

        uint256 value;
        do {
            (value, self) = _consumeNibbles(self, hexCharsNeeded);
        } while (value >= threshold);

        return (value % n, self);
    }

    /**
     * @notice Consume a specified number of nibbles from entropy
     * @dev Re-hashes entropy when exhausted
     * @param self The dice state
     * @param count Number of nibbles to consume
     * @return value The combined value from consumed nibbles
     * @return updatedDice The updated dice state
     */
    function _consumeNibbles(Dice memory self, uint256 count)
        private
        pure
        returns (uint256 value, Dice memory updatedDice)
    {
        value = 0;

        for (uint256 i = 0; i < count; i++) {
            // If we've exhausted all 64 nibbles, re-hash
            if (self.position >= 64) {
                self.entropy = keccak256(abi.encodePacked(self.entropy));
                self.position = 0;
            }

            // Extract the nibble at current position
            // Position 0 is the leftmost (most significant) nibble
            uint256 nibble = _getNibble(self.entropy, self.position);

            // Shift existing value left by 4 bits and add new nibble
            value = (value << 4) + nibble;

            self.position++;
        }

        return (value, self);
    }

    /**
     * @notice Extract a single nibble (4 bits) from a bytes32 at a given position
     * @dev Position 0 is the leftmost nibble (most significant)
     * @param data The bytes32 to extract from
     * @param pos The nibble position (0-63)
     * @return The nibble value (0-15)
     */
    function _getNibble(bytes32 data, uint8 pos) private pure returns (uint256) {
        // Each byte has 2 nibbles
        // Byte index: pos / 2
        // Within byte: pos % 2 == 0 means high nibble, == 1 means low nibble
        uint8 byteIndex = pos / 2;
        uint8 byteValue = uint8(data[byteIndex]);

        if (pos % 2 == 0) {
            // High nibble (left 4 bits)
            return byteValue >> 4;
        } else {
            // Low nibble (right 4 bits)
            return byteValue & 0x0F;
        }
    }

    /**
     * @notice Calculate ceil(log2(n)) - the number of bits needed to represent n values
     * @dev Returns 0 for n=1 (special case: 1 value needs 0 bits of entropy)
     * @param n The number of possible values
     * @return The ceiling of log2(n)
     */
    function _ceilLog2(uint256 n) private pure returns (uint256) {
        if (n <= 1) return 0;

        // Find position of highest set bit
        uint256 result = 0;
        uint256 temp = n - 1; // -1 because we want ceil, not floor

        while (temp > 0) {
            result++;
            temp >>= 1;
        }

        return result;
    }
}

