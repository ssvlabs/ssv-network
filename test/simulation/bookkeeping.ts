/**
 * Bookkeeping utilities for the simulation.
 *
 * Tracks cluster state updates from transaction receipts and
 * maintains ETH/SSV flow totals for conservation-law checking.
 */

import type { SimulationState, ClusterRecord } from "./types.ts";
import type { Cluster } from "../common/types.ts";

/**
 * Event ABI fragments for parsing cluster tuples from receipts.
 * Matches the patterns in test/common/helpers.ts.
 */
const CLUSTER_EVENT_ABI = [
  "event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterLiquidated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterReactivated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ValidatorAdded(address indexed owner, uint64[] operatorIds, bytes publicKey, bytes shares, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ValidatorRemoved(address indexed owner, uint64[] operatorIds, bytes publicKey, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterMigratedToETH(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterBalanceUpdated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
] as const;

/**
 * Compute a deterministic cluster key from owner and operatorIds.
 * Matches the on-chain keccak256(abi.encodePacked(owner, operatorIds)).
 *
 * @param ethers - ethers namespace (for keccak256/solidityPacked)
 * @param owner - cluster owner address
 * @param operatorIds - sorted operator IDs
 */
export function clusterKey(ethers: any, owner: string, operatorIds: bigint[]): string {
  const sorted = [...operatorIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ethers.keccak256(
    ethers.solidityPacked(
      ["address", "uint64[]"],
      [owner, sorted],
    ),
  );
}

/**
 * Parse a cluster tuple from a transaction receipt event log.
 *
 * Mirrors the pattern from test/common/helpers.ts:parseClusterFromEvent
 * but uses the SSVNetwork contract interface for parsing.
 *
 * @param contract - SSVNetwork contract instance (for interface.parseLog)
 * @param receipt - transaction receipt
 * @param eventName - name of the event to look for
 * @returns parsed Cluster or null if not found
 */
export function parseClusterFromReceipt(
  contract: any,
  receipt: any,
  eventName: string,
): Cluster | null {
  for (const log of receipt.logs ?? []) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name === eventName) {
      const clusterTuple = parsed.args[parsed.args.length - 1];
      const [validatorCount, networkFeeIndex, index, active, balance] = clusterTuple;
      return {
        validatorCount: BigInt(validatorCount),
        networkFeeIndex: BigInt(networkFeeIndex),
        index: BigInt(index),
        active: Boolean(active),
        balance: BigInt(balance),
      };
    }
  }
  return null;
}

/**
 * Update the simulation's cluster book from a transaction receipt.
 *
 * Looks for the specified event in the receipt logs, extracts the
 * cluster tuple, and updates the corresponding ClusterRecord.
 *
 * @param state - simulation state (clusterBook will be mutated)
 * @param ethers - ethers namespace
 * @param receipt - transaction receipt
 * @param expectedEvent - event name to look for
 * @param owner - cluster owner address
 * @param operatorIds - sorted operator IDs
 * @returns true if the cluster was updated, false if event not found
 */
export function updateClusterFromReceipt(
  state: SimulationState,
  ethers: any,
  receipt: any,
  expectedEvent: string,
  owner: string,
  operatorIds: bigint[],
): boolean {
  const cluster = parseClusterFromReceipt(state.network, receipt, expectedEvent);
  if (!cluster) return false;

  const key = clusterKey(ethers, owner, operatorIds);
  const record = state.clusterBook.get(key);

  if (record) {
    record.cluster = cluster;
  }

  return true;
}

/** Direction of ETH/SSV flow relative to the SSVNetwork contract */
export type FlowDirection = "in" | "out";

/**
 * Track an ETH flow into or out of the SSVNetwork contract.
 *
 * @param state - simulation state (totals will be mutated)
 * @param direction - "in" for deposits, "out" for withdrawals
 * @param amount - wei amount
 */
export function trackEthFlow(
  state: SimulationState,
  direction: FlowDirection,
  amount: bigint,
): void {
  if (direction === "in") {
    state.totals.totalEthDeposited += amount;
  } else {
    state.totals.totalEthWithdrawn += amount;
  }
}

/**
 * Track an SSV token flow into or out of the SSVNetwork contract.
 *
 * @param state - simulation state (totals will be mutated)
 * @param direction - "in" for deposits, "out" for withdrawals
 * @param amount - wei amount (SSV tokens)
 */
export function trackSsvFlow(
  state: SimulationState,
  direction: FlowDirection,
  amount: bigint,
): void {
  if (direction === "in") {
    state.totals.totalSsvDeposited += amount;
  } else {
    state.totals.totalSsvWithdrawn += amount;
  }
}

/**
 * Track SSV staking flow.
 *
 * @param state - simulation state
 * @param direction - "in" for stake, "out" for unstake completion
 * @param amount - SSV amount
 */
export function trackStakingFlow(
  state: SimulationState,
  direction: FlowDirection,
  amount: bigint,
): void {
  if (direction === "in") {
    state.totals.totalSsvStaked += amount;
  } else {
    state.totals.totalSsvUnstaked += amount;
  }
}

/**
 * Track ETH rewards claimed from the staking module.
 *
 * @param state - simulation state
 * @param amount - ETH claimed (wei)
 */
export function trackRewardsClaimed(
  state: SimulationState,
  amount: bigint,
): void {
  state.totals.totalEthRewardsClaimed += amount;
}

/**
 * Create a fresh BookkeepingTotals with all zeros.
 */
export function emptyTotals() {
  return {
    totalEthDeposited: 0n,
    totalEthWithdrawn: 0n,
    totalSsvDeposited: 0n,
    totalSsvWithdrawn: 0n,
    totalSsvStaked: 0n,
    totalSsvUnstaked: 0n,
    totalEthRewardsClaimed: 0n,
  };
}
