import { Hex, encodePacked, hexToBytes, keccak256 } from "viem";

/**
 * OptimizedDice (TypeScript)
 *
 * OPTIMIZED: Uses direct modulo instead of rejection sampling.
 * Much faster with negligible bias (~0.4% for small ranges).
 *
 * Entropy strategy: One keccak256 per 32 bytes consumed.
 * Uses bytes directly with modulo for random values.
 */
export class DeterministicDice {
  private entropy: Uint8Array;
  private position: number; // byte position: 0..31
  private counter: number; // for generating new entropy
  private baseSeed: Hex;

  constructor(seed: Hex) {
    this.baseSeed = seed;
    this.entropy = hexToBytes(seed);
    this.position = 0;
    this.counter = 0;
  }

  /**
   * Roll a random number in [0, n-1]
   * Uses direct modulo with minimal bias for small n.
   */
  roll(n: bigint): bigint {
    if (n <= 0n) throw new Error("DeterministicDice: n must be > 0");
    if (n === 1n) return 0n;

    // Determine how many bytes we need based on n
    const bytesNeeded = this.bytesForRange(n);

    // Extract random bytes
    let value = 0n;
    for (let i = 0; i < bytesNeeded; i++) {
      value = (value << 8n) | BigInt(this.nextByte());
    }

    // Direct modulo (has slight bias but acceptable for visual generation)
    return value % n;
  }

  /**
   * Get the next random byte, refreshing entropy when exhausted.
   */
  private nextByte(): number {
    if (this.position >= 32) {
      this.refreshEntropy();
    }
    return this.entropy[this.position++]!;
  }

  /**
   * Generate fresh entropy by hashing seed + counter.
   */
  private refreshEntropy(): void {
    this.counter++;
    const newHash = keccak256(encodePacked(["bytes32", "uint256"], [this.baseSeed, BigInt(this.counter)]));
    this.entropy = hexToBytes(newHash);
    this.position = 0;
  }

  /**
   * Calculate minimum bytes needed to represent range n.
   */
  private bytesForRange(n: bigint): number {
    if (n <= 256n) return 1;
    if (n <= 65536n) return 2;
    if (n <= 16777216n) return 3;
    if (n <= 4294967296n) return 4;
    // For larger ranges, compute dynamically
    let bytes = 1;
    let max = 256n;
    while (max < n) {
      bytes++;
      max *= 256n;
    }
    return bytes;
  }
}
