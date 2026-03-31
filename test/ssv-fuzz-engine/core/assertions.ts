import { expect } from "chai";
import type { FuzzContext, ClusterRecord, OperatorRecord } from "./types.ts";
import { Errors } from "../../common/errors.ts";
import {
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  CLUSTER_VERSION_ETH,
  CLUSTER_VERSION_SSV,
  DEFAULT_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { computeBurnRate, computeClusterBalance, computeClusterBalanceWithVUnits } from "./fuzz-helpers.ts";

export async function getContractEthBalance(ctx: FuzzContext<any>): Promise<bigint> {
  const address = await ctx.network.getAddress();
  return BigInt(await ctx.provider.getBalance(address));
}

export async function assertContractBalanceUnchanged<S extends { lastContractBalance?: bigint }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const current = await getContractEthBalance(ctx);
  if (ctx.state.lastContractBalance !== undefined) {
    expect(current).to.equal(ctx.state.lastContractBalance);
  }
  ctx.state.lastContractBalance = current;
}

export interface ContractBalanceWithDeltasSnapshot {
  balance: bigint;
  trackerDeposited: bigint;
  trackerWithdrawn: bigint;
}

export async function assertContractBalanceWithDeltas<S extends { tracker: { totalDeposited: bigint; totalWithdrawn: bigint }; lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const current = await getContractEthBalance(ctx);
  const { tracker } = ctx.state;

  if (ctx.state.lastContractBalanceWithDeltas !== undefined) {
    const prev = ctx.state.lastContractBalanceWithDeltas;
    const deposited = tracker.totalDeposited - prev.trackerDeposited;
    const withdrawn = tracker.totalWithdrawn - prev.trackerWithdrawn;
    expect(current).to.equal(prev.balance + deposited - withdrawn);
  }

  ctx.state.lastContractBalanceWithDeltas = {
    balance: current,
    trackerDeposited: tracker.totalDeposited,
    trackerWithdrawn: tracker.totalWithdrawn,
  };
}

export interface OperatorEarningsSnapshot {
  block: bigint;
  earnings: Map<number, bigint>;
  validatorCount: bigint;
}

export async function assertOperatorEarnings<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; lastOperatorEarnings?: OperatorEarningsSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, operators } = ctx.state;

  const currentEarnings = new Map<number, bigint>();
  for (const op of operators) {
    currentEarnings.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
  }

  if (ctx.state.lastOperatorEarnings !== undefined) {
    const prev = ctx.state.lastOperatorEarnings;
    const blocks = block - prev.block;
    const vUnits = prev.validatorCount * BPS_DENOMINATOR;

    for (const op of operators) {
      const packedFee = op.fee / ETH_DEDUCTED_DIGITS;
      const expectedDelta = ((packedFee * vUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS * blocks;
      expect(currentEarnings.get(op.id)).to.equal(prev.earnings.get(op.id)! + expectedDelta);
    }
  }

  ctx.state.lastOperatorEarnings = { block, earnings: currentEarnings, validatorCount: BigInt(cluster.cluster.validatorCount) };
}

export interface PhaseAwareOperatorEarningsSnapshot {
  block: bigint;
  earnings: Map<number, bigint>;
  validatorCount: bigint;
  phase: string;
}

export async function assertPhaseAwareOperatorEarnings<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; phase: string; lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, operators, phase } = ctx.state;

  const currentEarnings = new Map<number, bigint>();
  for (const op of operators) {
    currentEarnings.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
  }

  const prev = ctx.state.lastPhaseAwareOperatorEarnings;
  if (prev !== undefined && prev.phase === phase) {
    const blocks = block - prev.block;

    if (phase === "liquidated") {
      for (const op of operators) {
        expect(currentEarnings.get(op.id)).to.equal(prev.earnings.get(op.id)!);
      }
    } else {
      const vUnits = prev.validatorCount * BPS_DENOMINATOR;
      for (const op of operators) {
        const packedFee = op.fee / ETH_DEDUCTED_DIGITS;
        const expectedDelta = ((packedFee * vUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS * blocks;
        expect(currentEarnings.get(op.id)).to.equal(prev.earnings.get(op.id)! + expectedDelta);
      }
    }
  }

  ctx.state.lastPhaseAwareOperatorEarnings = {
    block,
    earnings: currentEarnings,
    validatorCount: BigInt(cluster.cluster.validatorCount),
    phase,
  };
}

export interface ClusterBalanceSnapshot {
  block: bigint;
  balance: bigint;
  validatorCount: bigint;
}

export async function assertClusterBalance<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; lastClusterBalance?: ClusterBalanceSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, operators } = ctx.state;
  const validatorCount = BigInt(cluster.cluster.validatorCount);
  const operatorFees = operators.map(op => op.fee);
  const networkFee = BigInt(await ctx.views.getNetworkFee());

  if (validatorCount > 0n && cluster.cluster.active) {
    const expectedBurnRate = computeBurnRate(operatorFees, networkFee, validatorCount);
    const contractBurnRate = BigInt(await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster));
    expect(expectedBurnRate).to.equal(contractBurnRate);
  }

  if (cluster.cluster.active) {
    const contractBalance = BigInt(await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));

    if (ctx.state.lastClusterBalance !== undefined) {
      const prev = ctx.state.lastClusterBalance;
      const expectedBalance = computeClusterBalance(prev.balance, operatorFees, networkFee, prev.validatorCount, block - prev.block);
      expect(contractBalance).to.equal(expectedBalance);
    }

    ctx.state.lastClusterBalance = { block, balance: contractBalance, validatorCount };
  }
}

export interface PhaseAwareClusterBalanceSnapshot {
  block: bigint;
  balance: bigint;
  validatorCount: bigint;
  phase: string;
}

export async function assertPhaseAwareClusterBalance<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; phase: string; lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, operators, phase } = ctx.state;
  const validatorCount = BigInt(cluster.cluster.validatorCount);
  const operatorFees = operators.map(op => op.fee);
  const networkFee = BigInt(await ctx.views.getNetworkFee());

  if (phase === "liquidated") {
    expect(cluster.cluster.active).to.equal(false);
    expect(BigInt(cluster.cluster.balance)).to.equal(0n);
    ctx.state.lastPhaseAwareClusterBalance = { block, balance: 0n, validatorCount, phase };
    return;
  }

  expect(cluster.cluster.active).to.equal(true);

  if (validatorCount > 0n) {
    const expectedBurnRate = computeBurnRate(operatorFees, networkFee, validatorCount);
    const contractBurnRate = BigInt(await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster));
    expect(expectedBurnRate).to.equal(contractBurnRate);
  }

  const contractBalance = BigInt(await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));

  const prev = ctx.state.lastPhaseAwareClusterBalance;
  if (prev !== undefined && prev.phase === phase) {
    const expectedBalance = computeClusterBalance(prev.balance, operatorFees, networkFee, prev.validatorCount, block - prev.block);
    expect(contractBalance).to.equal(expectedBalance);
  }

  ctx.state.lastPhaseAwareClusterBalance = { block, balance: contractBalance, validatorCount, phase };
}

export interface ClusterBalanceWithDeltasSnapshot {
  block: bigint;
  balance: bigint;
  validatorCount: bigint;
  trackerDeposited: bigint;
  trackerWithdrawn: bigint;
}

export async function assertClusterBalanceWithDeltas<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; tracker: { totalDeposited: bigint; totalWithdrawn: bigint }; lastClusterBalanceWithDeltas?: ClusterBalanceWithDeltasSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, operators, tracker } = ctx.state;
  const validatorCount = BigInt(cluster.cluster.validatorCount);
  const operatorFees = operators.map(op => op.fee);
  const networkFee = BigInt(await ctx.views.getNetworkFee());

  if (validatorCount > 0n && cluster.cluster.active) {
    const expectedBurnRate = computeBurnRate(operatorFees, networkFee, validatorCount);
    const contractBurnRate = BigInt(await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster));
    expect(expectedBurnRate).to.equal(contractBurnRate);
  }

  if (cluster.cluster.active) {
    const contractBalance = BigInt(await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));

    if (ctx.state.lastClusterBalanceWithDeltas !== undefined) {
      const prev = ctx.state.lastClusterBalanceWithDeltas;
      const deposited = tracker.totalDeposited - prev.trackerDeposited;
      const withdrawn = tracker.totalWithdrawn - prev.trackerWithdrawn;
      const expectedBalance = computeClusterBalance(prev.balance + deposited - withdrawn, operatorFees, networkFee, prev.validatorCount, block - prev.block);
      expect(contractBalance).to.equal(expectedBalance);
    }

    ctx.state.lastClusterBalanceWithDeltas = {
      block,
      balance: contractBalance,
      validatorCount,
      trackerDeposited: tracker.totalDeposited,
      trackerWithdrawn: tracker.totalWithdrawn,
    };
  }
}

export interface NetworkEarningsSnapshot {
  block: bigint;
  earnings: bigint;
  validatorCount: bigint;
}

export async function assertNetworkEarnings<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; lastNetworkEarnings?: NetworkEarningsSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster } = ctx.state;
  const currentEarnings = BigInt(await ctx.views.getNetworkEarnings());
  const networkFee = BigInt(await ctx.views.getNetworkFee());

  if (ctx.state.lastNetworkEarnings !== undefined) {
    const prev = ctx.state.lastNetworkEarnings;
    const blocks = block - prev.block;
    const vUnits = prev.validatorCount * BPS_DENOMINATOR;
    const packedNetFee = networkFee / ETH_DEDUCTED_DIGITS;
    const expectedDelta = ((blocks * packedNetFee * vUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    expect(currentEarnings).to.equal(prev.earnings + expectedDelta);
  }

  ctx.state.lastNetworkEarnings = { block, earnings: currentEarnings, validatorCount: BigInt(cluster.cluster.validatorCount) };
}

export async function assertEthConservation<S extends { cluster: ClusterRecord; operators: OperatorRecord[] }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const clusterBalance = BigInt(
    await ctx.views.getBalance(ctx.state.cluster.owner.address, ctx.state.cluster.operatorIds, ctx.state.cluster.cluster),
  );
  let operatorEarnings = 0n;
  for (const op of ctx.state.operators) {
    operatorEarnings += BigInt(await ctx.views.getOperatorEarnings(op.id));
  }
  const networkEarnings = BigInt(await ctx.views.getNetworkEarnings());
  const contractBalance = await getContractEthBalance(ctx);
  expect(clusterBalance + operatorEarnings + networkEarnings).to.equal(contractBalance);
}

export interface PhaseAwareNetworkEarningsSnapshot {
  block: bigint;
  earnings: bigint;
  validatorCount: bigint;
  phase: string;
}

export async function assertPhaseAwareNetworkEarnings<S extends { cluster: ClusterRecord; phase: string; lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, phase } = ctx.state;
  const currentEarnings = BigInt(await ctx.views.getNetworkEarnings());
  const networkFee = BigInt(await ctx.views.getNetworkFee());

  const prev = ctx.state.lastPhaseAwareNetworkEarnings;
  if (prev !== undefined && prev.phase === phase) {
    const blocks = block - prev.block;

    if (phase === "liquidated") {
      expect(currentEarnings).to.equal(prev.earnings);
    } else {
      const vUnits = prev.validatorCount * BPS_DENOMINATOR;
      const packedNetFee = networkFee / ETH_DEDUCTED_DIGITS;
      const expectedDelta = ((blocks * packedNetFee * vUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      expect(currentEarnings).to.equal(prev.earnings + expectedDelta);
    }
  }

  ctx.state.lastPhaseAwareNetworkEarnings = {
    block,
    earnings: currentEarnings,
    validatorCount: BigInt(cluster.cluster.validatorCount),
    phase,
  };
}

export async function assertRemovedOperatorEarningsFrozen<S extends { removedOperator: OperatorRecord | null; lastRemovedOperatorEarnings?: bigint }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  if (ctx.state.removedOperator === null) return;

  const current = BigInt(await ctx.views.getOperatorEarnings(ctx.state.removedOperator.id));

  if (ctx.state.lastRemovedOperatorEarnings !== undefined) {
    expect(current).to.equal(ctx.state.lastRemovedOperatorEarnings);
  }

  ctx.state.lastRemovedOperatorEarnings = current;
}

export async function assertNetworkValidatorCount<S extends { cluster: ClusterRecord }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const expected = ctx.state.cluster.cluster.active ? BigInt(ctx.state.cluster.cluster.validatorCount) : 0n;
  const actual = BigInt(await ctx.views.getNetworkValidatorsCount());
  expect(actual).to.equal(expected);
}

export async function assertOperatorValidatorCounts<S extends { cluster: ClusterRecord; operators: OperatorRecord[] }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const expectedCount = ctx.state.cluster.cluster.active ? BigInt(ctx.state.cluster.cluster.validatorCount) : 0n;
  for (const op of ctx.state.operators) {
    const opData = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opData.validatorCount)).to.equal(expectedCount);
  }
}

export interface LiquidatedLegacyPostUpgradeSnapshot {
  networkValidatorCount: bigint;
  operatorSSVValidatorCounts: Map<number, bigint>;
  operatorETHValidatorCounts: Map<number, bigint>;
  operatorETHFees: Map<number, bigint>;
}

export async function assertLiquidatedLegacyPostUpgradeSnapshot<S extends {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;
  postUpgradeSnapshot: LiquidatedLegacyPostUpgradeSnapshot;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  if (ctx.state.phase !== "post-upgrade-liquidated-legacy") return;

  const { cluster, operators, postUpgradeSnapshot } = ctx.state;
  expect(await ctx.views.getClusterAssetType(cluster.owner.address, cluster.operatorIds)).to.equal(CLUSTER_VERSION_SSV);
  expect(await ctx.views.isLiquidated(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(true);
  expect(cluster.cluster.active).to.equal(false);
  expect(BigInt(cluster.cluster.balance)).to.equal(0n);
  expect(BigInt(await ctx.views.getNetworkValidatorsCount())).to.equal(postUpgradeSnapshot.networkValidatorCount);

  for (const op of operators) {
    const opSSV = await ctx.views.getOperatorByIdSSV(op.id);
    const opETH = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opSSV.validatorCount)).to.equal(postUpgradeSnapshot.operatorSSVValidatorCounts.get(op.id));
    expect(BigInt(opETH.validatorCount)).to.equal(postUpgradeSnapshot.operatorETHValidatorCounts.get(op.id));
    expect(BigInt(opETH.fee)).to.equal(postUpgradeSnapshot.operatorETHFees.get(op.id));
  }
}

export async function assertLiquidatedLegacyVersionTransition<S extends {
  cluster: ClusterRecord;
  phase: string;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { cluster, phase } = ctx.state;
  const assetType = BigInt(await ctx.views.getClusterAssetType(cluster.owner.address, cluster.operatorIds));

  if (phase === "post-upgrade-liquidated-legacy") {
    expect(assetType).to.equal(CLUSTER_VERSION_SSV);
    return;
  }

  expect(assetType).to.equal(CLUSTER_VERSION_ETH);
  await expect(
    ctx.views.getBalanceSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster),
  ).to.be.revertedWithCustomError(ctx.views, Errors.INCORRECT_CLUSTER_VERSION);
  await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster);
}

export async function assertLiquidatedLegacyMigrationRefund<S extends {
  phase: string;
  actualRefund?: bigint;
  migrationEventRefund?: bigint;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  if (ctx.state.phase === "post-upgrade-liquidated-legacy") return;
  expect(ctx.state.actualRefund).to.equal(0n);
  expect(ctx.state.migrationEventRefund).to.equal(0n);
}

export async function assertLiquidatedLegacyMigrationReactivated<S extends {
  cluster: ClusterRecord;
  phase: string;
  migrationEthDeposit: bigint;
  reactivatedEmitted?: boolean;
  migrationEventEthDeposited?: bigint;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  if (ctx.state.phase !== "migrated-reactivated") return;

  const { cluster, migrationEthDeposit } = ctx.state;
  expect(ctx.state.reactivatedEmitted).to.equal(true);
  expect(ctx.state.migrationEventEthDeposited).to.equal(migrationEthDeposit);
  expect(cluster.cluster.active).to.equal(true);
  expect(BigInt(cluster.cluster.balance)).to.equal(migrationEthDeposit);
  expect(BigInt(cluster.cluster.validatorCount)).to.equal(1n);
  expect(await ctx.views.isLiquidated(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(false);
}

export async function assertLiquidatedLegacyOperatorTrackingTransition<S extends {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { cluster, operators, phase } = ctx.state;
  const expectedETHCount = phase === "post-upgrade-liquidated-legacy"
    ? 0n
    : BigInt(cluster.cluster.validatorCount);

  for (const op of operators) {
    const opSSV = await ctx.views.getOperatorByIdSSV(op.id);
    const opETH = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opSSV.validatorCount)).to.equal(0n);
    expect(BigInt(opETH.validatorCount)).to.equal(expectedETHCount);
  }
}

export async function assertLiquidatedLegacyEnsureETHDefaultsTransition<S extends {
  operators: OperatorRecord[];
  phase: string;
  migrationBlockNumber?: bigint;
  postUpgradeSnapshot: LiquidatedLegacyPostUpgradeSnapshot;
  defaultFeeExecutedEvents?: Map<number, { owner: string; blockNumber: bigint; fee: bigint }>;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  if (ctx.state.phase === "post-upgrade-liquidated-legacy") return;

  expect(ctx.state.migrationBlockNumber).to.not.be.undefined;
  expect(ctx.state.defaultFeeExecutedEvents).to.not.be.undefined;
  expect(ctx.state.defaultFeeExecutedEvents!.size).to.equal(ctx.state.operators.length);

  for (const op of ctx.state.operators) {
    const preMigrationFeeEntry = Array.from(ctx.state.postUpgradeSnapshot.operatorETHFees.entries()).find(([operatorId]) =>
      BigInt(operatorId) === BigInt(op.id)
    );
    expect(preMigrationFeeEntry).to.not.be.undefined;
    expect(preMigrationFeeEntry![1]).to.equal(DEFAULT_OPERATOR_ETH_FEE);

    const feeExecutedEntry = Array.from(ctx.state.defaultFeeExecutedEvents!.entries()).find(([operatorId]) =>
      BigInt(operatorId) === BigInt(op.id)
    );
    expect(feeExecutedEntry).to.not.be.undefined;
    const [, feeExecuted] = feeExecutedEntry!;
    expect(feeExecuted.owner.toLowerCase()).to.equal(op.owner.address.toLowerCase());
    expect(feeExecuted.blockNumber).to.equal(ctx.state.migrationBlockNumber);
    expect(feeExecuted.fee).to.equal(DEFAULT_OPERATOR_ETH_FEE);

    const opETH = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
  }
}

export async function assertLiquidatedLegacyNetworkValidatorCountTransition<S extends {
  cluster: ClusterRecord;
  phase: string;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const expected = ctx.state.phase === "post-upgrade-liquidated-legacy"
    ? 0n
    : BigInt(ctx.state.cluster.cluster.validatorCount);
  expect(BigInt(await ctx.views.getNetworkValidatorsCount())).to.equal(expected);
}

export async function assertLiquidatedLegacyQuantitativeInvariants<S extends {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  tracker: { totalDeposited: bigint; totalWithdrawn: bigint };
  phase: string;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
  lastClusterBalanceWithDeltas?: ClusterBalanceWithDeltasSnapshot;
  lastOperatorEarnings?: OperatorEarningsSnapshot;
  lastNetworkEarnings?: NetworkEarningsSnapshot;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  if (ctx.state.phase === "post-upgrade-liquidated-legacy") return;

  await assertContractBalanceWithDeltas(ctx);
  await assertClusterBalanceWithDeltas(ctx);
  await assertOperatorEarnings(ctx);
  await assertNetworkEarnings(ctx);
  await assertEthConservation(ctx);
}

export async function assertLiquidatedLegacyPostMigrationValidatorCount<S extends {
  cluster: ClusterRecord;
  phase: string;
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  if (ctx.state.phase !== "post-migration-complete") return;
  expect(BigInt(ctx.state.cluster.cluster.validatorCount)).to.equal(2n);
  expect(BigInt(await ctx.views.getNetworkValidatorsCount())).to.equal(2n);
}

function ebToVUnits(effectiveBalance: bigint): bigint {
  const vUnits = effectiveBalance * BPS_DENOMINATOR;
  if (vUnits === 0n) return 0n;
  return (vUnits - 1n) / 32n + 1n;
}

export interface EBOperatorEarningsSnapshot {
  block: bigint;
  earnings: Map<number, bigint>;
  vUnits: bigint;
}

export async function assertOperatorEarningsWithEB<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; lastEBOperatorEarnings?: EBOperatorEarningsSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, operators } = ctx.state;

  const currentEarnings = new Map<number, bigint>();
  for (const op of operators) {
    currentEarnings.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
  }

  let currentVUnits: bigint;
  if (cluster.cluster.active && BigInt(cluster.cluster.validatorCount) > 0n) {
    const eb = BigInt(await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));
    currentVUnits = ebToVUnits(eb);
  } else {
    currentVUnits = 0n;
  }

  if (ctx.state.lastEBOperatorEarnings !== undefined) {
    const prev = ctx.state.lastEBOperatorEarnings;
    if (prev.vUnits === currentVUnits) {
      const blocks = block - prev.block;

      for (const op of operators) {
        const packedFee = op.fee / ETH_DEDUCTED_DIGITS;
        const expectedDelta = ((packedFee * prev.vUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS * blocks;
        expect(currentEarnings.get(op.id)).to.equal(prev.earnings.get(op.id)! + expectedDelta);
      }
    }
  }

  ctx.state.lastEBOperatorEarnings = { block, earnings: currentEarnings, vUnits: currentVUnits };
}

export async function assertDaoVUnitsMatchCluster<S extends { cluster: ClusterRecord; operators: OperatorRecord[] }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { cluster, operators } = ctx.state;
  const validatorCount = BigInt(cluster.cluster.validatorCount);

  if (validatorCount === 0n || !cluster.cluster.active) return;

  const contractEB = BigInt(await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));
  const clusterVUnits = ebToVUnits(contractEB);

  const operatorFees = operators.map(op => op.fee);
  const networkFee = BigInt(await ctx.views.getNetworkFee());

  let packedTotal = networkFee / ETH_DEDUCTED_DIGITS;
  for (const fee of operatorFees) {
    packedTotal += fee / ETH_DEDUCTED_DIGITS;
  }
  const expectedBurnRate = (packedTotal * ETH_DEDUCTED_DIGITS * clusterVUnits) / BPS_DENOMINATOR;

  const contractBurnRate = BigInt(await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster));
  expect(contractBurnRate).to.equal(expectedBurnRate);
}

export interface EBClusterBalanceSnapshot {
  block: bigint;
  balance: bigint;
  vUnits: bigint;
}

export async function assertClusterBalanceWithEB<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; lastEBClusterBalance?: EBClusterBalanceSnapshot; tickDepositDelta: bigint }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, operators } = ctx.state;

  if (!cluster.cluster.active || BigInt(cluster.cluster.validatorCount) === 0n) return;

  const eb = BigInt(await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));
  const currentVUnits = ebToVUnits(eb);
  const contractBalance = BigInt(await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));

  if (ctx.state.lastEBClusterBalance !== undefined) {
    const prev = ctx.state.lastEBClusterBalance;
    if (prev.vUnits === currentVUnits) {
      const operatorFees = operators.map(op => op.fee);
      const networkFee = BigInt(await ctx.views.getNetworkFee());
      const expectedBalance = computeClusterBalanceWithVUnits(prev.balance, operatorFees, networkFee, prev.vUnits, block - prev.block) + ctx.state.tickDepositDelta;
      expect(contractBalance).to.equal(expectedBalance);
    }
  }

  ctx.state.lastEBClusterBalance = { block, balance: contractBalance, vUnits: currentVUnits };
}

export async function assertCSSVTotalSupply<S extends { stakers: { signer: { address: string }; staked: bigint }[] }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const totalSupply = BigInt(await ctx.cssvToken.totalSupply());
  let expectedSupply = 0n;
  for (const staker of ctx.state.stakers) {
    expectedSupply += staker.staked;
  }
  expect(totalSupply).to.equal(expectedSupply);
}

export async function assertStakerCSSVBalances<S extends { stakers: { signer: { address: string }; staked: bigint }[] }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  for (const staker of ctx.state.stakers) {
    const balance = BigInt(await ctx.cssvToken.balanceOf(staker.signer.address));
    expect(balance).to.equal(staker.staked);
  }
}

const PRECISION = 10n ** 18n;

export async function assertStakingRewards<S extends { stakers: { signer: { address: string }; staked: bigint }[] }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const totalCSSV = BigInt(await ctx.cssvToken.totalSupply());
  if (totalCSSV === 0n) return;

  const storedAcc = BigInt(await ctx.views.accEthPerShare());
  const currentEarnings = BigInt(await ctx.views.getNetworkEarnings());
  const poolBalance = BigInt(await ctx.views.stakingEthPoolBalance());

  const packedCurrent = currentEarnings / ETH_DEDUCTED_DIGITS;
  const packedPrevious = poolBalance / ETH_DEDUCTED_DIGITS;

  let liveAcc = storedAcc;
  if (packedCurrent > packedPrevious) {
    const packedNewFees = packedCurrent - packedPrevious;
    const newFeesWei = packedNewFees * ETH_DEDUCTED_DIGITS;
    liveAcc = storedAcc + (newFeesWei * PRECISION) / totalCSSV;
  }

  let totalClaimable = 0n;
  for (const staker of ctx.state.stakers) {
    const expected = (staker.staked * liveAcc) / PRECISION;
    const claimable = BigInt(await ctx.views.previewClaimableEth(staker.signer.address));
    expect(claimable).to.equal(expected);
    totalClaimable += claimable;
  }

  // dust from integer division in accEthPerShare and per-staker truncation is expected
  const livePoolBalance = packedCurrent * ETH_DEDUCTED_DIGITS;
  const dust = livePoolBalance - totalClaimable;
  expect(dust).to.approximately(0n, BigInt(ctx.state.stakers.length) * ETH_DEDUCTED_DIGITS);
}

export interface Snapshot {
  block: bigint;
  balance: bigint;
  burnRate: bigint;
  validatorCount: bigint;
  operatorValidatorCounts: Map<number, bigint>;
  operatorEarnings: Map<number, bigint>;
  operatorFees: Map<number, bigint>;
  networkEarnings: bigint;
  networkFee: bigint;
  networkValidatorCount: bigint;
}
