import {
  DECLARE_OPERATOR_FEE_PERIOD,
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";
import type { SeededRNG } from "../simulation/rng.ts";

export type OperatorSetSize = 4 | 7 | 10 | 13;
export type ValidatorBucket = 1 | 2 | 4;
export type EBMode = "implicit" | "explicit-32" | "explicit-high" | "explicit-max-safe";
export type SolvencyTarget = "healthy" | "threshold-edge" | "liquidatable";
export type FeePhase = "flat" | "declared" | "executed";
export type TimingBucket = "same-block" | "short-delay" | "fee-window" | "long-delay";
export type Topology = "single-cluster" | "dual-cluster-shared-operators";
export type BalanceMove = "deposit" | "safe-withdraw" | "unsafe-withdraw";

export interface TimingPlan {
  bucket: TimingBucket;
  blocks: bigint;
  seconds: bigint;
}

const OPERATOR_SET_SIZES: readonly OperatorSetSize[] = [4, 7, 10, 13];
const VALIDATOR_BUCKETS: readonly ValidatorBucket[] = [1, 2, 4];
const EB_MODES: readonly EBMode[] = [
  "implicit",
  "explicit-32",
  "explicit-high",
  "explicit-max-safe",
];
const SOLVENCY_TARGETS: readonly SolvencyTarget[] = [
  "healthy",
  "threshold-edge",
  "liquidatable",
];
const FEE_PHASES: readonly FeePhase[] = ["flat", "declared", "executed"];
const TIMING_BUCKETS: readonly TimingBucket[] = [
  "same-block",
  "short-delay",
  "fee-window",
  "long-delay",
];
const BALANCE_MOVES: readonly BalanceMove[] = [
  "deposit",
  "safe-withdraw",
  "unsafe-withdraw",
];
const TOPOLOGIES: readonly Topology[] = [
  "single-cluster",
  "dual-cluster-shared-operators",
];

function pickBucket<T>(rng: SeededRNG, values: readonly T[]): T {
  return values[Number(rng.next() % BigInt(values.length))];
}

function alignWei(value: bigint): bigint {
  if (value <= 0n) {
    return ETH_DEDUCTED_DIGITS;
  }
  return ((value + ETH_DEDUCTED_DIGITS - 1n) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
}

export function genOperatorSetSize(rng: SeededRNG): OperatorSetSize {
  return pickBucket(rng, OPERATOR_SET_SIZES);
}

export function genValidatorBucket(rng: SeededRNG): bigint {
  return BigInt(pickBucket(rng, VALIDATOR_BUCKETS));
}

export function genEBMode(rng: SeededRNG): EBMode {
  return pickBucket(rng, EB_MODES);
}

export function genSolvencyTarget(rng: SeededRNG): SolvencyTarget {
  return pickBucket(rng, SOLVENCY_TARGETS);
}

export function genFeePhase(rng: SeededRNG): FeePhase {
  return pickBucket(rng, FEE_PHASES);
}

export function genTimingBucket(rng: SeededRNG): TimingBucket {
  return pickBucket(rng, TIMING_BUCKETS);
}

export function genTopology(rng: SeededRNG): Topology {
  return pickBucket(rng, TOPOLOGIES);
}

export function genBalanceMove(rng: SeededRNG): BalanceMove {
  return pickBucket(rng, BALANCE_MOVES);
}

export function genTimingPlan(rng: SeededRNG, bucket?: TimingBucket): TimingPlan {
  const resolvedBucket = bucket ?? genTimingBucket(rng);
  switch (resolvedBucket) {
    case "same-block":
      return { bucket: resolvedBucket, blocks: 0n, seconds: 0n };
    case "short-delay":
      return {
        bucket: resolvedBucket,
        blocks: rng.nextInRange(1n, 12n),
        seconds: rng.nextInRange(0n, 30n),
      };
    case "fee-window":
      return {
        bucket: resolvedBucket,
        blocks: rng.nextInRange(1n, 5n),
        seconds: DECLARE_OPERATOR_FEE_PERIOD + rng.nextInRange(1n, 90n),
      };
    case "long-delay":
      return {
        bucket: resolvedBucket,
        blocks: rng.nextInRange(100n, 800n),
        seconds: rng.nextInRange(60n, 300n),
      };
  }
}

export function genEffectiveBalance(
  rng: SeededRNG,
  validatorCount: bigint,
  mode: EBMode,
): bigint | undefined {
  if (mode === "implicit") {
    return undefined;
  }

  let perValidator: bigint;
  if (mode === "explicit-32") {
    perValidator = 32n;
  } else if (mode === "explicit-high") {
    perValidator = pickBucket(rng, [64n, 96n, 128n] as const);
  } else {
    perValidator = pickBucket(rng, [256n, 512n] as const);
  }

  return perValidator * validatorCount;
}

export function genInitialDepositAmount(
  rng: SeededRNG,
  liquidationThreshold: bigint,
  solvencyTarget: SolvencyTarget,
): bigint {
  const multiplier = solvencyTarget === "healthy" ? 3n : 2n;
  const padding = alignWei(rng.nextInRange(ETH_DEDUCTED_DIGITS, 5n * 10n ** 17n));
  return alignWei(liquidationThreshold * multiplier + padding);
}

export function genDepositAmount(
  rng: SeededRNG,
  liquidationThreshold: bigint,
): bigint {
  const bonus = rng.nextInRange(ETH_DEDUCTED_DIGITS, 2n * 10n ** 18n);
  return alignWei(liquidationThreshold + bonus);
}

export function genSafeWithdrawalAmount(
  rng: SeededRNG,
  clusterBalance: bigint,
  liquidationThreshold: bigint,
): bigint {
  const safeFloor = liquidationThreshold + rng.nextInRange(2n, 8n) * ETH_DEDUCTED_DIGITS;
  if (clusterBalance <= safeFloor) {
    return 1n;
  }

  const maxWithdraw = clusterBalance - safeFloor;
  return rng.nextInRange(1n, maxWithdraw);
}

export function genThresholdEdgeWithdrawalAmount(
  clusterBalance: bigint,
  liquidationThreshold: bigint,
  burnPerBlock: bigint,
): bigint {
  const targetBalance = liquidationThreshold + burnPerBlock;
  if (clusterBalance <= targetBalance) {
    return 1n;
  }
  return clusterBalance - targetBalance;
}

export function genUnsafeWithdrawalAmount(
  rng: SeededRNG,
  clusterBalance: bigint,
  liquidationThreshold: bigint,
): bigint {
  if (clusterBalance <= liquidationThreshold) {
    return 1n;
  }

  const minWithdraw = clusterBalance - liquidationThreshold + ETH_DEDUCTED_DIGITS;
  const maxWithdraw = clusterBalance - 1n;
  const candidate = minWithdraw > maxWithdraw ? maxWithdraw : rng.nextInRange(minWithdraw, maxWithdraw);
  return candidate;
}

export function genPocSeedsFromEnv(
  defaultSeeds: bigint[],
  maxCasesPerFamily?: number,
): bigint[] {
  const raw = process.env.POC_SEEDS?.trim();
  const parsed = raw && raw.length > 0
    ? raw.split(",").map((seed) => BigInt(seed.trim())).filter((seed) => seed > 0n)
    : defaultSeeds;

  const limit = Number(process.env.POC_CASES_PER_FAMILY ?? maxCasesPerFamily ?? parsed.length);
  return parsed.slice(0, Math.max(1, limit));
}

export const DEFAULT_POC_SEEDS: bigint[] = [
  11n,
  29n,
  73n,
  131n,
  257n,
  521n,
  1069n,
  4099n,
  5088n,
  6709n,
  7290n
];
