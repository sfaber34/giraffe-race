// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./WinProbTableShard0.sol";
import "./WinProbTableShard1.sol";
import "./WinProbTableShard2.sol";
import "./WinProbTableShard3.sol";
import "./WinProbTableShard4.sol";
import "./WinProbTableShard5.sol";

/// @notice Router for 6-lane win probability lookup table.
/// @dev Routes queries to the correct shard based on the global index.
/// Index order is all sorted tuples (a<=b<=c<=d<=e<=f) with a,b,c,d,e,f in [1..10], in nested-loop order.
contract WinProbTable6 {
    uint8 internal constant LANE_COUNT = 6;
    uint256 internal constant ENTRY_BYTES = 12;
    uint256 internal constant TABLE_LEN = 5005;
    uint256 internal constant ENTRIES_PER_SHARD = 850;

    WinProbTableShard0 public immutable shard0;
    WinProbTableShard1 public immutable shard1;
    WinProbTableShard2 public immutable shard2;
    WinProbTableShard3 public immutable shard3;
    WinProbTableShard4 public immutable shard4;
    WinProbTableShard5 public immutable shard5;

    constructor(address _shard0, address _shard1, address _shard2, address _shard3, address _shard4, address _shard5) {
        shard0 = WinProbTableShard0(_shard0);
        shard1 = WinProbTableShard1(_shard1);
        shard2 = WinProbTableShard2(_shard2);
        shard3 = WinProbTableShard3(_shard3);
        shard4 = WinProbTableShard4(_shard4);
        shard5 = WinProbTableShard5(_shard5);
    }

    /// @notice Compute the global index for a sorted 6-tuple.
    /// @dev Uses combinatorial formulas to avoid iterating through all tuples.
    /// Tuple must be sorted: a <= b <= c <= d <= e <= f, each in [1..10].
    function _indexSorted(uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f) internal pure returns (uint256 idx) {
        require(a >= 1 && f <= 10, "WinProbTable6: bad tuple");
        require(a <= b && b <= c && c <= d && d <= e && e <= f, "WinProbTable6: not sorted");

        // Count tuples lexicographically smaller using combinatorial formulas.
        // For each position, count how many valid tuples have a smaller value at that position.
        
        // Position 0 (a): count tuples where first element < a
        // For each value i, tuples starting with i have remaining 5 elements in [i, 10]
        // Count = C(10-i+1+5-1, 5) = C(15-i, 5)
        for (uint8 i = 1; i < a; i++) {
            idx += _c5(uint8(15 - i)); // C(15-i, 5)
        }
        
        // Position 1 (b): given a fixed, count tuples where second element < b
        // For j in [a, b-1], remaining 4 elements in [j, 10]: C(10-j+1+4-1, 4) = C(14-j, 4)
        for (uint8 j = a; j < b; j++) {
            idx += _c4(uint8(14 - j)); // C(14-j, 4)
        }
        
        // Position 2 (c): count tuples starting with (a,b) where third element < c
        // For k in [b, c-1], remaining 3 elements in [k, 10]: C(13-k, 3)
        for (uint8 k = b; k < c; k++) {
            idx += _c3(uint8(13 - k)); // C(13-k, 3)
        }
        
        // Position 3 (d): count tuples starting with (a,b,c) where fourth element < d
        // For l in [c, d-1], remaining 2 elements in [l, 10]: C(12-l, 2)
        for (uint8 l = c; l < d; l++) {
            idx += _c2(uint8(12 - l)); // C(12-l, 2)
        }
        
        // Position 4 (e): count tuples starting with (a,b,c,d) where fifth element < e
        // For m in [d, e-1], remaining 1 element in [m, 10]: C(11-m, 1) = 11-m
        for (uint8 m = d; m < e; m++) {
            idx += uint256(11 - m); // C(11-m, 1) = 11-m
        }
        
        // Position 5 (f): count tuples starting with (a,b,c,d,e) where sixth element < f
        // Just f - e (number of values in [e, f-1])
        idx += uint256(f - e);
    }

    function _c2(uint8 n) private pure returns (uint256) {
        if (n < 2) return 0;
        return (uint256(n) * uint256(n - 1)) / 2;
    }

    function _c3(uint8 n) private pure returns (uint256) {
        if (n < 3) return 0;
        return (uint256(n) * uint256(n - 1) * uint256(n - 2)) / 6;
    }

    function _c4(uint8 n) private pure returns (uint256) {
        if (n < 4) return 0;
        return (uint256(n) * uint256(n - 1) * uint256(n - 2) * uint256(n - 3)) / 24;
    }

    function _c5(uint8 n) private pure returns (uint256) {
        if (n < 5) return 0;
        return (uint256(n) * uint256(n - 1) * uint256(n - 2) * uint256(n - 3) * uint256(n - 4)) / 120;
    }

    /// @notice Get win probabilities for a sorted 6-tuple.
    /// @param a First score (smallest), b second, ..., f sixth (largest)
    /// @return probsBps Win probability in basis points for each sorted position
    function getSorted(uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f) 
        external 
        view 
        returns (uint16[LANE_COUNT] memory probsBps) 
    {
        uint256 idx = _indexSorted(a, b, c, d, e, f);
        return _getByIndex(idx);
    }

    /// @notice Get win probabilities by global table index.
    function _getByIndex(uint256 idx) internal view returns (uint16[LANE_COUNT] memory probsBps) {
        require(idx < TABLE_LEN, "WinProbTable6: index out of bounds");
        
        if (idx < 850) {
            return shard0.getByGlobalIndex(idx);
        } else if (idx < 1700) {
            return shard1.getByGlobalIndex(idx);
        } else if (idx < 2550) {
            return shard2.getByGlobalIndex(idx);
        } else if (idx < 3400) {
            return shard3.getByGlobalIndex(idx);
        } else if (idx < 4250) {
            return shard4.getByGlobalIndex(idx);
        } else {
            return shard5.getByGlobalIndex(idx);
        }
    }

    /// @notice Convenience: get probabilities for any 6 scores (auto-sorts them).
    /// @dev Returns probabilities in the ORIGINAL order (not sorted order).
    /// This handles the permutation so callers don't need to sort themselves.
    function get(uint8[LANE_COUNT] memory scores) external view returns (uint16[LANE_COUNT] memory probsBps) {
        // Sort scores while tracking original indices
        uint8[LANE_COUNT] memory sorted;
        uint8[LANE_COUNT] memory sortedToOriginal;
        
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            sorted[i] = scores[i];
            sortedToOriginal[i] = i;
        }
        
        // Simple insertion sort (small fixed size)
        for (uint8 i = 1; i < LANE_COUNT; i++) {
            uint8 key = sorted[i];
            uint8 keyIdx = sortedToOriginal[i];
            uint8 j = i;
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                sortedToOriginal[j] = sortedToOriginal[j - 1];
                j--;
            }
            sorted[j] = key;
            sortedToOriginal[j] = keyIdx;
        }
        
        // Clamp scores to [1, 10]
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            if (sorted[i] < 1) sorted[i] = 1;
            if (sorted[i] > 10) sorted[i] = 10;
        }
        
        // Get probabilities for sorted tuple
        uint16[LANE_COUNT] memory sortedProbs = this.getSorted(
            sorted[0], sorted[1], sorted[2], sorted[3], sorted[4], sorted[5]
        );
        
        // Map back to original order
        for (uint8 i = 0; i < LANE_COUNT; i++) {
            probsBps[sortedToOriginal[i]] = sortedProbs[i];
        }
    }
}
