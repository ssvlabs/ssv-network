/**
 * Shared helpers for cross-module (XG, XF, XV, XL, EB/LQ) scenarios.
 *
 * Provides reusable building blocks for migration, staking, validator
 * registration/removal, EB updates, liquidation, reactivation, and
 * cross-module assertion helpers.
 */

import { ethers } from "ethers";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import type { StateSnapshot } from "../simulation/state-snapshot.ts";
import type { ClusterRecord, OperatorRecord } from "../simulation/types.ts";
import { VERSION_SSV, VERSION_ETH } from "../simulation/types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import { parseClusterFromReceipt } from "../simulation/bookkeeping.ts";
import { computeClusterId, computeEBRoot } from "../helpers/oracle.ts";

// ---------------------------------------------------------------------------
// Entity selection helpers
// ---------------------------------------------------------------------------

/** Pick an active ETH cluster (version == 1). */
export function pickETHCluster(ctx: ScenarioContext): ClusterRecord {
  const ethClusters = [...ctx.simState.clusterBook.values()].filter(
    (c) => c.version === VERSION_ETH && c.cluster.active,
  );
  if (ethClusters.length === 0) {
    throw new ScenarioSkipped("No active ETH clusters available");
  }
  return ctx.rng.pick(ethClusters);
}

/** Pick an SSV (legacy) cluster if available. Throws ScenarioSkipped if none. */
export function pickSSVCluster(ctx: ScenarioContext): ClusterRecord {
  const ssvClusters = [...ctx.simState.clusterBook.values()].filter(
    (c) => c.version === VERSION_SSV && c.cluster.active,
  );
  if (ssvClusters.length === 0) {
    throw new ScenarioSkipped("No SSV clusters available for migration");
  }
  return ctx.rng.pick(ssvClusters);
}

/** Find an active operator in a cluster. Throws ScenarioSkipped if none. */
export function findActiveOp(
  ctx: ScenarioContext,
  record: ClusterRecord,
): OperatorRecord {
  for (const opId of record.operatorIds) {
    const op = ctx.actors.operators.get(opId);
    if (op && op.isActive) return op;
  }
  throw new ScenarioSkipped("No active operator found in cluster");
}

/** Find a second active operator in a cluster (different from excludeId). */
export function findSecondActiveOp(
  ctx: ScenarioContext,
  record: ClusterRecord,
  excludeId: bigint,
): OperatorRecord {
  for (const opId of record.operatorIds) {
    if (opId === excludeId) continue;
    const op = ctx.actors.operators.get(opId);
    if (op && op.isActive) return op;
  }
  throw new ScenarioSkipped("No second active operator found in cluster");
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/** Migrate an SSV cluster to ETH. Updates record in place. */
export async function migrateCluster(
  ctx: ScenarioContext,
  record: ClusterRecord,
  depositEth: string = "50",
): Promise<void> {
  const deposit = ethers.parseEther(depositEth);
  await ctx.provider.send("hardhat_setBalance", [
    record.owner,
    "0x" + (deposit + ethers.parseEther("10")).toString(16),
  ]);
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .migrateClusterToETH(record.operatorIds, record.cluster, {
      value: deposit,
    });
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ClusterMigratedToETH",
  );
  if (updated) record.cluster = updated;
  record.version = 1;
}

// ---------------------------------------------------------------------------
// Staking helpers
// ---------------------------------------------------------------------------

/** Stake SSV tokens. Returns the cSSV balance after staking. */
export async function stakeSSV(
  ctx: ScenarioContext,
  amount: bigint = 1_000_000_000n,
): Promise<bigint> {
  const staker = ctx.actors.stakers[0];
  if (!staker) throw new Error("No staker available");
  // Mint and approve SSV
  await ctx.contracts.ssvToken.mint(staker.signer.address, amount);
  await ctx.contracts.ssvToken
    .connect(staker.signer)
    .approve(await ctx.contracts.network.getAddress(), amount);
  const tx = await ctx.contracts.network.connect(staker.signer).stake(amount);
  await tx.wait();
  staker.cssvBalance += amount;
  return staker.cssvBalance;
}

/** Sync staking fees by calling syncFees. */
export async function syncFees(ctx: ScenarioContext): Promise<void> {
  const tx = await ctx.contracts.network.syncFees();
  await tx.wait();
}

/** Claim ETH rewards for a staker. */
export async function claimRewards(ctx: ScenarioContext): Promise<void> {
  const staker = ctx.actors.stakers[0];
  if (!staker) throw new Error("No staker available");
  const tx = await ctx.contracts.network
    .connect(staker.signer)
    .claimEthRewards();
  await tx.wait();
}

/** Request unstake (partial or full). */
export async function requestUnstake(
  ctx: ScenarioContext,
  amount: bigint,
): Promise<void> {
  const staker = ctx.actors.stakers[0];
  if (!staker) throw new Error("No staker available");
  const tx = await ctx.contracts.network
    .connect(staker.signer)
    .requestUnstake(amount);
  await tx.wait();
  staker.cssvBalance -= amount;
}

// ---------------------------------------------------------------------------
// Cluster action helpers
// ---------------------------------------------------------------------------

/** Deposit ETH into a cluster. Updates record.cluster in place. */
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

/** Withdraw ETH from a cluster. Updates record.cluster in place. */
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

/** Liquidate a cluster (self-liquidation). Updates record.cluster in place. */
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

/** Reactivate a liquidated cluster with ETH deposit. Updates record.cluster. */
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

/** Remove an operator and mark it inactive. */
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

/** Remove a validator from a cluster. Returns the removed pubkey. */
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

/** Commit EB root with oracle quorum and update cluster balance. */
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
  const updated =
    parseClusterFromReceipt(ctx.contracts.network, receipt, "ClusterBalanceUpdated") ??
    parseClusterFromReceipt(ctx.contracts.network, receipt, "ClusterLiquidated");
  if (updated) record.cluster = updated;
}

// ---------------------------------------------------------------------------
// Cross-module assertion helpers
// ---------------------------------------------------------------------------

/** Assert cluster is active. */
export function assertClusterActive(
  snap: StateSnapshot,
  label: string,
): void {
  if (!snap.cluster) throw new Error(`${label}: no cluster in snapshot`);
  if (!snap.cluster.active) throw new Error(`${label}: cluster not active`);
}

/** Assert cluster is liquidated (inactive, balance == 0). */
export function assertClusterLiquidated(
  snap: StateSnapshot,
  label: string,
): void {
  if (!snap.cluster) throw new Error(`${label}: no cluster in snapshot`);
  if (snap.cluster.active) throw new Error(`${label}: cluster still active`);
  if (snap.cluster.balance !== 0n) {
    throw new Error(
      `${label}: cluster balance=${snap.cluster.balance} (expected 0 after liquidation)`,
    );
  }
}

/** Assert cluster balance decreased (fees accrued). */
export function assertBalanceDecreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  label: string,
): void {
  if (!pre.cluster || !post.cluster) {
    throw new Error(`${label}: cluster missing from snapshot`);
  }
  if (post.cluster.balance >= pre.cluster.balance) {
    throw new Error(
      `${label}: balance did not decrease (pre=${pre.cluster.balance}, post=${post.cluster.balance})`,
    );
  }
}

/** Assert cluster balance increased (deposit). */
export function assertBalanceIncreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  label: string,
): void {
  if (!pre.cluster || !post.cluster) {
    throw new Error(`${label}: cluster missing from snapshot`);
  }
  if (post.cluster.balance <= pre.cluster.balance) {
    throw new Error(
      `${label}: balance did not increase (pre=${pre.cluster.balance}, post=${post.cluster.balance})`,
    );
  }
}

/**
 * Assert daoTotalEthVUnits is non-negative.
 * Note: daoTotalEthVUnits is read as uint256, so this is always true.
 * Kept as a no-op for API compatibility with existing scenario call sites.
 */
export function assertDaoVUnitsNonNegative(
  _snap: StateSnapshot,
  _label: string,
): void {
  // uint256 cannot be negative — this check is a no-op by design.
}

/** Assert daoTotalEthVUnits is zero. */
export function assertDaoVUnitsZero(
  snap: StateSnapshot,
  label: string,
): void {
  if (snap.daoTotalEthVUnits !== 0n) {
    throw new Error(
      `${label}: daoTotalEthVUnits=${snap.daoTotalEthVUnits} (expected 0)`,
    );
  }
}

/** Assert daoTotalEthVUnits increased. */
export function assertDaoVUnitsIncreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  label: string,
): void {
  if (post.daoTotalEthVUnits <= pre.daoTotalEthVUnits) {
    throw new Error(
      `${label}: daoTotalEthVUnits did not increase (pre=${pre.daoTotalEthVUnits}, post=${post.daoTotalEthVUnits})`,
    );
  }
}

/** Assert daoTotalEthVUnits decreased. */
export function assertDaoVUnitsDecreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  label: string,
): void {
  if (post.daoTotalEthVUnits >= pre.daoTotalEthVUnits) {
    throw new Error(
      `${label}: daoTotalEthVUnits did not decrease (pre=${pre.daoTotalEthVUnits}, post=${post.daoTotalEthVUnits})`,
    );
  }
}

/** Assert accEthPerShare increased (fees synced). */
export function assertAccEthPerShareIncreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  label: string,
): void {
  if (post.accEthPerShare <= pre.accEthPerShare) {
    throw new Error(
      `${label}: accEthPerShare did not increase (pre=${pre.accEthPerShare}, post=${post.accEthPerShare})`,
    );
  }
}

/** Assert contract ETH balance increased. */
export function assertContractBalanceIncreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  label: string,
): void {
  if (post.contractEthBalance <= pre.contractEthBalance) {
    throw new Error(
      `${label}: contract balance did not increase (pre=${pre.contractEthBalance}, post=${post.contractEthBalance})`,
    );
  }
}

/** Assert an operator is inactive with zero ethVUnits. */
export function assertOperatorRemoved(
  snap: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) throw new Error(`${label}: operator ${opId} not in snapshot`);
  if (opSnap.isActive) {
    throw new Error(`${label}: operator ${opId} still active`);
  }
  if (opSnap.ethVUnits !== 0n) {
    throw new Error(
      `${label}: operator ${opId} ethVUnits=${opSnap.ethVUnits} (expected 0)`,
    );
  }
}

/** Assert an active operator has non-negative ethVUnits. */
export function assertActiveOpVUnitsValid(
  snap: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) throw new Error(`${label}: operator ${opId} not in snapshot`);
  if (!opSnap.isActive) return;
  if (opSnap.ethVUnits < 0n) {
    throw new Error(
      `${label}: active operator ${opId} has negative ethVUnits=${opSnap.ethVUnits}`,
    );
  }
}

/** Assert operator earnings are non-negative. */
export function assertOperatorEarningsValid(
  snap: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) throw new Error(`${label}: operator ${opId} not in snapshot`);
  if (opSnap.earnings < 0n) {
    throw new Error(
      `${label}: operator ${opId} has negative earnings=${opSnap.earnings}`,
    );
  }
}

/** Assert validator count changed. */
export function assertValidatorCountChanged(
  pre: StateSnapshot,
  post: StateSnapshot,
  expectedDelta: number,
  label: string,
): void {
  if (!pre.cluster || !post.cluster) {
    throw new Error(`${label}: cluster missing from snapshot`);
  }
  const actual = post.cluster.validatorCount - pre.cluster.validatorCount;
  if (actual !== expectedDelta) {
    throw new Error(
      `${label}: validatorCount delta=${actual}, expected=${expectedDelta}`,
    );
  }
}
