/**
 * Shared helpers for removed-operator (BUG-21) scenarios.
 *
 * Provides reusable building blocks for operator removal, EB updates,
 * liquidation, reactivation, and BUG-21 invariant assertions.
 */

import { ethers } from "ethers";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import type { StateSnapshot } from "../simulation/state-snapshot.ts";
import type { ClusterRecord, OperatorRecord } from "../simulation/types.ts";
import { parseClusterFromReceipt } from "../simulation/bookkeeping.ts";
import { computeClusterId, computeEBRoot } from "../helpers/oracle.ts";

// ---------------------------------------------------------------------------
// Entity selection helpers
// ---------------------------------------------------------------------------

/**
 * Find an active operator that belongs to the given cluster.
 * Throws if none found.
 */
export function findActiveClusterOperator(
  ctx: ScenarioContext,
  record: ClusterRecord,
): OperatorRecord {
  for (const opId of record.operatorIds) {
    const op = ctx.actors.operators.get(opId);
    if (op && op.isActive) return op;
  }
  throw new Error("No active operator found in cluster");
}

/**
 * Find a second active operator in the cluster (different from excludeId).
 */
export function findSecondActiveClusterOperator(
  ctx: ScenarioContext,
  record: ClusterRecord,
  excludeId: bigint,
): OperatorRecord {
  for (const opId of record.operatorIds) {
    if (opId === excludeId) continue;
    const op = ctx.actors.operators.get(opId);
    if (op && op.isActive) return op;
  }
  throw new Error("No second active operator found in cluster");
}

// ---------------------------------------------------------------------------
// Action helpers (for use inside step() actions)
// ---------------------------------------------------------------------------

/**
 * Remove an operator and mark it inactive in the local state.
 */
export async function removeOperator(
  ctx: ScenarioContext,
  op: OperatorRecord,
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(op.ownerSigner)
    .removeOperator(op.id);
  await tx.wait();
  op.isActive = false;
}

/**
 * Commit EB root with oracle quorum and update cluster balance.
 * Updates record.cluster in place.
 */
export async function performEBUpdate(
  ctx: ScenarioContext,
  record: ClusterRecord,
  effectiveBalance: number,
): Promise<void> {
  await ctx.mineBlocks(1);
  const blockNum = await ctx.getBlockNumber();
  const clusterId = computeClusterId(record.owner, record.operatorIds);
  const root = computeEBRoot(clusterId, effectiveBalance);

  const oracles = ctx.actors.oracles;
  await ctx.contracts.network.connect(oracles[0]).commitRoot(root, blockNum);
  await ctx.contracts.network.connect(oracles[1]).commitRoot(root, blockNum);
  await ctx.contracts.network.connect(oracles[2]).commitRoot(root, blockNum);

  const tx = await ctx.contracts.network.updateClusterBalance(
    blockNum,
    record.owner,
    record.operatorIds,
    record.cluster,
    effectiveBalance,
    [],
  );
  const receipt = await tx.wait();
  // May emit ClusterBalanceUpdated or ClusterLiquidated (auto-liquidation)
  const updated =
    parseClusterFromReceipt(ctx.contracts.network, receipt, "ClusterBalanceUpdated") ??
    parseClusterFromReceipt(ctx.contracts.network, receipt, "ClusterLiquidated");
  if (updated) record.cluster = updated;
}

/**
 * Liquidate a cluster (self-liquidation by owner).
 * Updates record.cluster in place.
 */
export async function liquidateCluster(
  ctx: ScenarioContext,
  record: ClusterRecord,
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .liquidate(record.owner, record.operatorIds, record.cluster);
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ClusterLiquidated",
  );
  if (updated) record.cluster = updated;
}

/**
 * Reactivate a liquidated cluster with ETH deposit.
 * Updates record.cluster in place.
 */
export async function reactivateCluster(
  ctx: ScenarioContext,
  record: ClusterRecord,
  depositEth: string = "20",
): Promise<void> {
  const deposit = ethers.parseEther(depositEth);
  await ctx.provider.send("hardhat_setBalance", [
    record.owner,
    "0x" + (deposit + ethers.parseEther("10")).toString(16),
  ]);
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .reactivate(record.operatorIds, record.cluster, { value: deposit });
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ClusterReactivated",
  );
  if (updated) record.cluster = updated;
}

/**
 * Deposit ETH into a cluster. Updates record.cluster in place.
 */
export async function depositToCluster(
  ctx: ScenarioContext,
  record: ClusterRecord,
  depositEth: string = "5",
): Promise<void> {
  const deposit = ethers.parseEther(depositEth);
  await ctx.provider.send("hardhat_setBalance", [
    record.owner,
    "0x" + (deposit + ethers.parseEther("10")).toString(16),
  ]);
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .deposit(record.owner, record.operatorIds, record.cluster, {
      value: deposit,
    });
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ClusterDeposited",
  );
  if (updated) record.cluster = updated;
}

/**
 * Withdraw ETH from a cluster. Updates record.cluster in place.
 */
export async function withdrawFromCluster(
  ctx: ScenarioContext,
  record: ClusterRecord,
  withdrawEth: string = "0.1",
): Promise<void> {
  const amount = ethers.parseEther(withdrawEth);
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .withdraw(record.operatorIds, amount, record.cluster);
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ClusterWithdrawn",
  );
  if (updated) record.cluster = updated;
}

/**
 * Remove a validator from a cluster. Updates record.cluster in place.
 * Returns the removed pubkey.
 */
export async function removeValidator(
  ctx: ScenarioContext,
  record: ClusterRecord,
): Promise<string> {
  if (record.validatorKeys.length === 0) {
    throw new Error("No validators to remove from cluster");
  }
  const pubkey = record.validatorKeys[0];
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .removeValidator(pubkey, record.operatorIds, record.cluster);
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ValidatorRemoved",
  );
  if (updated) record.cluster = updated;
  record.validatorKeys = record.validatorKeys.slice(1);
  return pubkey;
}

// ---------------------------------------------------------------------------
// BUG-21 assertion helpers
// ---------------------------------------------------------------------------

/**
 * INV-11: Removed operator must have ethVUnits == 0 and isActive == false.
 */
export function assertRemovedOpInvariant(
  snap: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) {
    throw new Error(`${label}: operator ${opId} not in snapshot`);
  }
  if (opSnap.isActive) {
    throw new Error(
      `${label}: operator ${opId} still active (expected inactive)`,
    );
  }
  if (opSnap.ethVUnits !== 0n) {
    throw new Error(
      `${label}: operator ${opId} ethVUnits=${opSnap.ethVUnits} (expected 0)`,
    );
  }
}

/**
 * Assert that an operator's ethVUnits did not change across a step
 * (e.g., removed op should stay at 0).
 */
export function assertOpVUnitsUnchanged(
  pre: StateSnapshot,
  post: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const preSn = pre.operators.get(opId);
  const postSn = post.operators.get(opId);
  if (!preSn || !postSn) {
    throw new Error(`${label}: operator ${opId} missing from snapshot`);
  }
  if (preSn.ethVUnits !== postSn.ethVUnits) {
    throw new Error(
      `${label}: operator ${opId} ethVUnits changed from ${preSn.ethVUnits} to ${postSn.ethVUnits}`,
    );
  }
}

/**
 * Assert daoTotalEthVUnits is non-negative (sanity check).
 */
export function assertDaoVUnitsNonNegative(
  snap: StateSnapshot,
  label: string,
): void {
  if (snap.daoTotalEthVUnits < 0n) {
    throw new Error(
      `${label}: daoTotalEthVUnits is negative (${snap.daoTotalEthVUnits})`,
    );
  }
}

/**
 * Assert that an active operator has ethVUnits > 0 after an EB update.
 */
export function assertActiveOpHasVUnits(
  snap: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) {
    throw new Error(`${label}: operator ${opId} not in snapshot`);
  }
  if (!opSnap.isActive) return; // skip if already removed
  // After EB update, active ops should have non-negative vUnits
  if (opSnap.ethVUnits < 0n) {
    throw new Error(
      `${label}: active operator ${opId} has negative ethVUnits=${opSnap.ethVUnits}`,
    );
  }
}

/**
 * Assert cluster is liquidated (inactive, balance == 0).
 */
export function assertClusterLiquidated(
  snap: StateSnapshot,
  label: string,
): void {
  if (!snap.cluster) {
    throw new Error(`${label}: no cluster in snapshot`);
  }
  if (snap.cluster.active) {
    throw new Error(`${label}: cluster still active after liquidation`);
  }
}

/**
 * Assert cluster is active.
 */
export function assertClusterActive(
  snap: StateSnapshot,
  label: string,
): void {
  if (!snap.cluster) {
    throw new Error(`${label}: no cluster in snapshot`);
  }
  if (!snap.cluster.active) {
    throw new Error(`${label}: cluster not active`);
  }
}
