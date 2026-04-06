// Seeded Mulberry32 PRNG for reproducible stress test sequences.

export interface RNG {
  next(): bigint;
  nextInt(max: bigint): bigint;
}

export function mulberry32(seed: bigint): RNG {
  let s = Number(seed & 0xFFFFFFFFn) >>> 0;

  function next(): bigint {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return BigInt((t ^ (t >>> 14)) >>> 0);
  }

  function nextInt(max: bigint): bigint {
    if (max <= 0n) return 0n;
    return next() % max;
  }

  return { next, nextInt };
}

export function pickFrom<T>(rng: RNG, arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Number(rng.nextInt(BigInt(arr.length)))];
}

export function pickFromRequired<T>(rng: RNG, arr: T[]): T {
  if (arr.length === 0) throw new Error('Cannot pick from empty array');
  return arr[Number(rng.nextInt(BigInt(arr.length)))];
}

export interface WeightedItem<T> {
  item: T;
  weight: number;
}

export function pickWeighted<T>(rng: RNG, items: WeightedItem<T>[]): T | undefined {
  const eligible = items.filter(i => i.weight > 0);
  if (eligible.length === 0) return undefined;
  const total = eligible.reduce((sum, i) => sum + i.weight, 0);
  let r = Number(rng.nextInt(BigInt(total)));
  for (const { item, weight } of eligible) {
    r -= weight;
    if (r < 0) return item;
  }
  return eligible[eligible.length - 1].item;
}

/** Return a random bigint in [min, max) */
export function randRange(rng: RNG, min: bigint, max: bigint): bigint {
  if (max <= min) return min;
  return min + rng.nextInt(max - min);
}
