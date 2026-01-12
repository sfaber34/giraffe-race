import { Hex, hexToBytes, keccak256 } from "viem";

/**
 * DeterministicDice (TypeScript)
 * Matches the Solidity DeterministicDice library:
 * - Consumes entropy nibble-by-nibble (left-to-right)
 * - Re-hashes entropy when exhausted
 * - Uses rejection sampling to avoid modulo bias
 */
export class DeterministicDice {
  private entropy: Uint8Array;
  private position: number; // nibble position: 0..63

  constructor(seed: Hex) {
    this.entropy = hexToBytes(seed);
    this.position = 0;
  }

  roll(n: bigint): bigint {
    if (n <= 0n) throw new Error("DeterministicDice: n must be > 0");

    const bitsNeeded = ceilLog2(n);
    let hexCharsNeeded = (bitsNeeded + 3n) / 4n; // ceil(bits/4)
    if (hexCharsNeeded === 0n) hexCharsNeeded = 1n;

    const maxValue = 16n ** hexCharsNeeded;
    const threshold = maxValue - (maxValue % n);

    let value: bigint;
    do {
      value = this.consumeNibbles(Number(hexCharsNeeded));
    } while (value >= threshold);

    return value % n;
  }

  private consumeNibbles(count: number): bigint {
    let value = 0n;

    for (let i = 0; i < count; i++) {
      if (this.position >= 64) {
        // Re-hash entropy when exhausted
        this.entropy = hexToBytes(keccak256(this.entropy));
        this.position = 0;
      }

      const nibble = getNibble(this.entropy, this.position);
      value = (value << 4n) + BigInt(nibble);
      this.position++;
    }

    return value;
  }
}

function getNibble(bytes: Uint8Array, pos: number): number {
  const byteIndex = Math.floor(pos / 2);
  const byteValue = bytes[byteIndex] ?? 0;
  return pos % 2 === 0 ? byteValue >> 4 : byteValue & 0x0f;
}

function ceilLog2(n: bigint): bigint {
  if (n <= 1n) return 0n;
  let result = 0n;
  let temp = n - 1n;
  while (temp > 0n) {
    result++;
    temp >>= 1n;
  }
  return result;
}
