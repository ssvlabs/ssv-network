/**
 * Seeded pseudo-random number generator for deterministic simulations.
 *
 * Uses a 64-bit Linear Congruential Generator (LCG) with BigInt arithmetic.
 * Same seed always produces the same sequence.
 *
 * Default seed: 0xDEADBEEFCAFEBABE (overridable via SIMULATION_SEED env var).
 */

/** LCG constants (Knuth MMIX) */
const LCG_MULTIPLIER = 6364136223846793005n;
const LCG_INCREMENT = 1442695040888963407n;
const LCG_MODULUS = 1n << 64n;
const LCG_MASK = LCG_MODULUS - 1n;

const DEFAULT_SEED = 0xDEADBEEFCAFEBABEn;

export class SeededRNG {
  private state: bigint;

  constructor(seed?: bigint) {
    const resolvedSeed = seed ?? this.seedFromEnv() ?? DEFAULT_SEED;
    // Ensure non-zero initial state
    this.state = resolvedSeed === 0n ? DEFAULT_SEED : resolvedSeed & LCG_MASK;
  }

  private seedFromEnv(): bigint | undefined {
    const raw = process.env.SIMULATION_SEED;
    if (!raw || raw.trim() === "") return undefined;
    try {
      return BigInt(raw);
    } catch {
      return undefined;
    }
  }

  /** Advance state and return a 64-bit unsigned integer as bigint. */
  next(): bigint {
    this.state = (LCG_MULTIPLIER * this.state + LCG_INCREMENT) & LCG_MASK;
    return this.state;
  }

  /**
   * Return a bigint in [min, max] (inclusive).
   * Both min and max must be non-negative bigints with min <= max.
   */
  nextInRange(min: bigint, max: bigint): bigint {
    if (min > max) throw new RangeError(`min (${min}) > max (${max})`);
    if (min === max) return min;
    const range = max - min + 1n;
    return min + (this.next() % range);
  }

  /**
   * Return a floating-point number in [0, 1).
   * Uses the upper 53 bits of the 64-bit state for full double precision.
   */
  nextFloat(): number {
    const raw = this.next();
    // Use upper 53 bits for maximum precision in IEEE 754
    const bits53 = raw >> 11n;
    return Number(bits53) / 2 ** 53;
  }

  /** Pick a random element from a non-empty array. */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) throw new RangeError("Cannot pick from empty array");
    const idx = Number(this.next() % BigInt(array.length));
    return array[idx];
  }

  /** Shuffle an array in place (Fisher-Yates) and return it. */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Number(this.next() % BigInt(i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Select a weighted random index from a weights array.
   * Weights are positive numbers (need not sum to 1).
   */
  weightedIndex(weights: number[]): number {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) throw new RangeError("Total weight must be positive");
    let r = this.nextFloat() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }
}
