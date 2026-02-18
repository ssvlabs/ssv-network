/**
 * Type definitions for the Monte Carlo upgrade simulation.
 *
 * All ETH/SSV values are bigint (wei-denominated). Cluster structs
 * mirror the on-chain Cluster tuple used by SSVNetwork events and calls.
 */

import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { SSVNetwork, SSVNetworkViews } from "../../types/ethers-contracts/index.js";
import type { Cluster } from "../common/types.ts";
import type { SeededRNG } from "./rng.ts";
import type { SimLogger } from "./sim-logger.ts";

// Re-export Cluster so consumers don't need a second import
export type { Cluster };

/** Version discriminant for dual-cluster system */
export const VERSION_SSV = 0;
export const VERSION_ETH = 1;
export type ClusterVersion = typeof VERSION_SSV | typeof VERSION_ETH;

/**
 * Local record of a cluster tracked by the simulation.
 * The `cluster` field always holds the latest on-chain cluster tuple
 * as returned by the most recent event.
 */
export interface ClusterRecord {
  /** Cluster owner address (checksummed) */
  owner: string;
  /** Signer for the owner — used to call contract functions */
  ownerSigner: HardhatEthersSigner;
  /** Sorted operator IDs in the cluster */
  operatorIds: bigint[];
  /** Latest cluster tuple (mirrors on-chain struct) */
  cluster: Cluster;
  /** Whether this is an SSV-denominated or ETH-denominated cluster */
  version: ClusterVersion;
  /** Public keys of validators registered in this cluster */
  validatorKeys: string[];
}

/**
 * Local record of an operator tracked by the simulation.
 */
export interface OperatorRecord {
  /** On-chain operator ID */
  id: bigint;
  /** Operator owner address */
  owner: string;
  /** Signer for the owner */
  ownerSigner: HardhatEthersSigner;
  /** Current ETH fee (raw packed value, without ETH_DEDUCTED_DIGITS) */
  fee: bigint;
  /** Whether the operator is currently active (not removed) */
  isActive: boolean;
}

/**
 * Local record of a staker in the SSV staking system.
 */
export interface StakerRecord {
  /** Signer for the staker */
  signer: HardhatEthersSigner;
  /** Current cSSV balance (tracked locally for fast lookups) */
  cssvBalance: bigint;
  /** Pending unstake requests: array of { amount, unlockBlock } */
  pendingRequests: Array<{
    amount: bigint;
    unlockBlock: bigint;
  }>;
}

/**
 * Result of executing a single simulation action.
 */
export interface ActionResult {
  /** Name of the action (e.g. "migrateClusterToETH", "deposit", "stake") */
  name: string;
  /** Whether the action succeeded (tx confirmed without revert) */
  success: boolean;
  /** If reverted, the revert reason string */
  revertReason?: string;
  /** If the action modified a cluster, the cluster key that was updated */
  clusterKeyUpdated?: string;
}

/**
 * Bookkeeping totals for conservation-law checking.
 */
export interface BookkeepingTotals {
  /** Total ETH deposited into the SSVNetwork contract */
  totalEthDeposited: bigint;
  /** Total ETH withdrawn from the SSVNetwork contract */
  totalEthWithdrawn: bigint;
  /** Total SSV deposited into the SSVNetwork contract */
  totalSsvDeposited: bigint;
  /** Total SSV withdrawn from the SSVNetwork contract */
  totalSsvWithdrawn: bigint;
  /** Total SSV staked (into staking module) */
  totalSsvStaked: bigint;
  /** Total SSV unstaked (from staking module) */
  totalSsvUnstaked: bigint;
  /** Total ETH claimed as staking rewards */
  totalEthRewardsClaimed: bigint;
}

/**
 * Top-level simulation state. Passed around by reference to all
 * action handlers, bookkeeping, and invariant checkers.
 */
export interface SimulationState {
  /** SSVNetwork proxy contract (connected to default signer) */
  network: SSVNetwork;
  /** SSVNetworkViews contract */
  views: SSVNetworkViews;
  /** Ethers provider */
  provider: any;
  /** Seeded PRNG for deterministic randomness */
  rng: SeededRNG;
  /** Logger for action tracking */
  logger: SimLogger;

  /** Map of clusterKey → ClusterRecord for all tracked clusters */
  clusterBook: Map<string, ClusterRecord>;
  /** Map of operatorId → OperatorRecord for sampled/created operators */
  operatorPool: Map<bigint, OperatorRecord>;
  /** Array of staker records */
  stakerPool: StakerRecord[];

  /** Bookkeeping totals for conservation checks */
  totals: BookkeepingTotals;

  /** Block number when the simulation started */
  startBlock: number;
  /** Current simulation block (updated after each mine) */
  currentBlock: number;

  /** SSVNetwork proxy address */
  networkAddress: string;
  /** SSV token contract */
  ssvToken: any;
  /** cSSV token contract */
  cssvToken: any;

  /** Oracle signers (impersonated) for commitRoot calls */
  oracleSigners: HardhatEthersSigner[];
}

/**
 * Weight map for action selection. Keys are action names,
 * values are relative weights (will be normalized to probabilities).
 */
export type ActionWeights = Record<string, number>;
