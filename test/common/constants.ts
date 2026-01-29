import { ethers } from "ethers";
import { SSVModules } from "./types.ts";
import type { Cluster } from "./types.ts";

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

// todo make and object to simplify imports in other files (Constants.NAME_OF_VALUE...)
export const DEFAULT_SHARES = "0x1234";
export const DEFAULT_ETH_REGISTER_VALUE: bigint = ethers.parseEther("10");
export const SMALL_ETH_REGISTER_VALUE: bigint = ethers.parseEther("1");
export const DEFAULT_ETH_EB_PER_VALIDATOR: bigint = 32n;
export const CLUSTER_VERSION_SSV = 0n;
export const CLUSTER_VERSION_ETH = 1n;
export const MINIMAL_OPERATOR_ETH_FEE = 1770_000_000n;
export const VUNITS_PRECISION: bigint = 10_000n;
export const MAXIMUM_OPERATORS_FEE = 76528650000000n;
export const NETWORK_FEE = 382640000000n;
export const MINIMUM_BLOCKS_BEFORE_LIQUIDATION = 214800n;
export const MINIMUM_LIQUIDATION_PERIOD_COLLATERAL = 1_000_000_000_000_000n;
export const VALIDATORS_PER_OPERATOR_LIMIT = 3000n;
export const DECLARE_OPERATOR_FEE_PERIOD = 604800n;
export const EXECUTE_OPERATOR_FEE_PERIOD = 604800n;
export const OPERATOR_MAX_FEE_INCREASE = 10000n;
export const PRECISION_FACTOR = 10000n;
export const MINIMAL_LIQUIDATION_THRESHOLD = 21480n;
export const STAKE_AMOUNT = ethers.parseEther("10");
export const DEFAULT_ORACLES_IDS = [1n, 2n, 3n, 4n];
export const DEFAULT_UNSTAKE_COOLDOWN = 604800n;
