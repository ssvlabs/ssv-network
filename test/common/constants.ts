import { ethers } from "ethers";
import { SSVModules } from "./types.ts";
import type { Cluster } from "./types.ts";
import { envBigInt, envBigIntArray } from "./env-helpers.ts";

export const EMPTY_CLUSTER: Cluster = {
  validatorCount: 0n,
  networkFeeIndex: 0n,
  index: 0n,
  balance: 0n,
  active: true,
};

export const SSV_MODULE_CONTRACTS: Record<SSVModules, string> = {
  [SSVModules.SSVOperators]: "SSVOperators",
  [SSVModules.SSVClusters]: "SSVClusters",
  [SSVModules.SSVDAO]: "SSVDAO",
  [SSVModules.SSVViews]: "SSVViews",
  [SSVModules.SSVOperatorsWhitelist]: "SSVOperatorsWhitelist",
  [SSVModules.SSVStaking]: "SSVStaking",
  [SSVModules.SSVValidators]: "SSVValidators",
};
export const DEFAULT_SHARES = "0x1234";
export const DEFAULT_ETH_REGISTER_VALUE: bigint = ethers.parseEther("10");
export const SMALL_ETH_REGISTER_VALUE: bigint = ethers.parseEther("1");
export const DEFAULT_ETH_EB_PER_VALIDATOR: bigint = 32n;
export const CLUSTER_VERSION_SSV = 0n;
export const CLUSTER_VERSION_ETH = 1n;
export const MINIMAL_OPERATOR_ETH_FEE = envBigInt("FORK_MIN_OPERATOR_ETH_FEE", 1770_000_000n);
export const DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000n;
export const MAXIMUM_OPERATORS_FEE = envBigInt("FORK_MAX_OPERATOR_ETH_FEE", 76528650000000n);
export const NETWORK_FEE_ETH = envBigInt("FORK_NETWORK_FEE_ETH", 3000000000n);
export const NETWORK_FEE = envBigInt("FORK_NETWORK_FEE_SSV", 382640000000n);
export const MINIMUM_BLOCKS_BEFORE_LIQUIDATION = envBigInt("FORK_MIN_BLOCKS_BEFORE_LIQUIDATION", 214800n);
export const MINIMUM_LIQUIDATION_PERIOD_COLLATERAL = envBigInt("FORK_MIN_LIQ_COLLATERAL", 1_000_000_000_000_000n);
export const VALIDATORS_PER_OPERATOR_LIMIT = envBigInt("FORK_VALIDATORS_PER_OPERATOR_LIMIT", 3000n);
export const DECLARE_OPERATOR_FEE_PERIOD = envBigInt("FORK_DECLARE_OPERATOR_FEE_PERIOD", 604800n);
export const EXECUTE_OPERATOR_FEE_PERIOD = envBigInt("FORK_EXECUTE_OPERATOR_FEE_PERIOD", 604800n);
export const OPERATOR_MAX_FEE_INCREASE = envBigInt("FORK_OPERATOR_MAX_FEE_INCREASE", 10000n);
export const PRECISION_FACTOR = 10000n;
export const MINIMAL_LIQUIDATION_THRESHOLD = 21480n;
export const STAKE_AMOUNT = ethers.parseEther("10");
export const DEFAULT_ORACLES_IDS = envBigIntArray("FORK_DEFAULT_ORACLE_IDS", [1n, 2n, 3n, 4n]);
export const DEFAULT_UNSTAKE_COOLDOWN = envBigInt(
  "FORK_DEFAULT_UNSTAKE_COOLDOWN",
  7n * 24n * 60n * 60n
);
export const DEDUCTED_DIGITS = 10_000_000n;
export const ETH_DEDUCTED_DIGITS = 100_000n;
export const OPERATOR_FEE_PRECISION = ETH_DEDUCTED_DIGITS;
export const BPS_DENOMINATOR = PRECISION_FACTOR;
export const QUORUM_BPS = envBigInt("FORK_QUORUM_BPS", 7500n);
export const TOKEN_REGISTER_AMOUNT = ethers.parseEther("100");
export const MINIMAL_OPERATOR_FEE_SSV = 1000000000n;
export const OP_ETH_FEE_RAW = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
export const DEFAULT_NETWORK_FEE_RAW = 5_000n;
export const DEFAULT_NETWORK_FEE_UNPACKED = DEFAULT_NETWORK_FEE_RAW * ETH_DEDUCTED_DIGITS;
