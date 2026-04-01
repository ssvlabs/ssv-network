import { expect } from "chai";
import type { FuzzContext, ClusterRecord, OperatorRecord } from "./types.ts";
import type { LegacyMigrationSnapshot } from "./steps.ts";
import { ETH_DEDUCTED_DIGITS, BPS_DENOMINATOR, DEFAULT_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
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

export async function assertLegacyMigrationRefund<S extends { migrationSnapshot: LegacyMigrationSnapshot }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const snap = ctx.state.migrationSnapshot;
  const expectedRefund = snap.ssvBalanceBefore - snap.ssvBurnRate;
  expect(snap.ssvRefund).to.equal(expectedRefund);

  const tokenDelta = snap.ownerSSVAfter - snap.ownerSSVBefore;
  expect(tokenDelta).to.equal(snap.ssvRefund);
}

export async function assertLegacyEnsureETHDefaultsTransition<S extends { migrationSnapshot: LegacyMigrationSnapshot; cluster: ClusterRecord }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { migrateReceipt } = ctx.state.migrationSnapshot;
  const { operatorIds } = ctx.state.cluster;

  const feeEvents: { operatorId: bigint; fee: bigint }[] = [];
  for (const log of migrateReceipt.logs ?? []) {
    let parsed;
    try {
      parsed = ctx.network.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed && parsed.name === Events.OPERATOR_FEE_EXECUTED) {
      feeEvents.push({
        operatorId: BigInt(parsed.args.operatorId),
        fee: BigInt(parsed.args.fee),
      });
    }
  }

  expect(feeEvents.length).to.equal(operatorIds.length);

  for (const opId of operatorIds) {
    const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
    expect(ev, `OperatorFeeExecuted missing for operator ${opId}`).to.not.be.undefined;
    expect(ev!.fee).to.equal(BigInt(DEFAULT_OPERATOR_ETH_FEE));
  }
}

export async function assertLegacyOperatorDualTracking<S extends { cluster: ClusterRecord; operators: OperatorRecord[] }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { cluster, operators } = ctx.state;
  const expectedEthCount = BigInt(cluster.cluster.validatorCount);

  for (const op of operators) {
    const opSSV = await ctx.views.getOperatorByIdSSV(op.id);
    expect(BigInt(opSSV.validatorCount)).to.equal(0n);

    const opETH = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opETH.validatorCount)).to.equal(expectedEthCount);
  }
}

export async function assertRemovedOperatorMigrationSkip<S extends {
  migrationSnapshot: LegacyMigrationSnapshot;
  cluster: ClusterRecord;
  removedOperator: OperatorRecord;
  operators: OperatorRecord[];
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { migrateReceipt } = ctx.state.migrationSnapshot;
  const { operatorIds } = ctx.state.cluster;
  const removedId = ctx.state.removedOperator.id;
  const activeIds = operatorIds.filter(id => id !== removedId);

  const feeEvents: { operatorId: bigint; fee: bigint }[] = [];
  for (const log of migrateReceipt.logs ?? []) {
    let parsed;
    try {
      parsed = ctx.network.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed && parsed.name === Events.OPERATOR_FEE_EXECUTED) {
      feeEvents.push({
        operatorId: BigInt(parsed.args.operatorId),
        fee: BigInt(parsed.args.fee),
      });
    }
  }

  expect(feeEvents.length).to.equal(activeIds.length);

  for (const opId of activeIds) {
    const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
    expect(ev, `OperatorFeeExecuted missing for active operator ${opId}`).to.not.be.undefined;
    expect(ev!.fee).to.equal(BigInt(DEFAULT_OPERATOR_ETH_FEE));
  }

  expect(
    feeEvents.find(e => e.operatorId === BigInt(removedId)),
    `OperatorFeeExecuted must NOT be emitted for removed operator ${removedId}`,
  ).to.be.undefined;

  const removedOpETH = await ctx.views.getOperatorById(removedId);
  expect(BigInt(removedOpETH.validatorCount)).to.equal(
    0n,
    `Removed operator ${removedId} must have ethValidatorCount == 0`,
  );
  expect(BigInt(removedOpETH.fee)).to.equal(
    0n,
    `Removed operator ${removedId} must have ethFee == 0 (ensureETHDefaults must not execute)`,
  );

  const removedOpSSV = await ctx.views.getOperatorByIdSSV(removedId);
  expect(BigInt(removedOpSSV.validatorCount)).to.equal(
    0n,
    `Removed operator ${removedId} must have SSV validatorCount == 0`,
  );
}

export async function assertAllOperatorsSkippedOnMigration<S extends {
  migrationSnapshot: LegacyMigrationSnapshot;
  cluster: ClusterRecord;
  removedOperators: OperatorRecord[];
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { migrateReceipt } = ctx.state.migrationSnapshot;

  const feeEvents: { operatorId: bigint; fee: bigint }[] = [];
  for (const log of migrateReceipt.logs ?? []) {
    let parsed;
    try {
      parsed = ctx.network.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed && parsed.name === Events.OPERATOR_FEE_EXECUTED) {
      feeEvents.push({
        operatorId: BigInt(parsed.args.operatorId),
        fee: BigInt(parsed.args.fee),
      });
    }
  }

  expect(feeEvents.length).to.equal(0, "No OperatorFeeExecuted events expected when all operators are removed");

  for (const op of ctx.state.removedOperators) {
    const opETH = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opETH.validatorCount)).to.equal(
      0n, `Removed operator ${op.id} must have ethValidatorCount == 0`,
    );

    const opSSV = await ctx.views.getOperatorByIdSSV(op.id);
    expect(BigInt(opSSV.validatorCount)).to.equal(
      0n, `Removed operator ${op.id} must have SSV validatorCount == 0`,
    );

    expect(opETH.isActive).to.equal(
      false, `Removed operator ${op.id} must remain uninitialized (isActive == false)`,
    );

    const earnings = BigInt(await ctx.views.getOperatorEarnings(op.id));
    expect(earnings).to.equal(
      0n, `Removed operator ${op.id} must have zero ETH earnings`,
    );
  }
}

export async function assertZeroFeeOperatorsPostMigration<S extends {
  migrationSnapshot: LegacyMigrationSnapshot;
  cluster: ClusterRecord;
  operators: OperatorRecord[];
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { migrateReceipt } = ctx.state.migrationSnapshot;
  const expectedEthCount = BigInt(ctx.state.cluster.cluster.validatorCount);

  const feeEvents: { operatorId: bigint }[] = [];
  for (const log of migrateReceipt.logs ?? []) {
    let parsed;
    try {
      parsed = ctx.network.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed && parsed.name === Events.OPERATOR_FEE_EXECUTED) {
      feeEvents.push({ operatorId: BigInt(parsed.args.operatorId) });
    }
  }

  expect(feeEvents.length).to.equal(0, "No OperatorFeeExecuted events expected for zero-fee operators");

  for (const op of ctx.state.operators) {
    const opETH = await ctx.views.getOperatorById(op.id);
    expect(opETH.isActive).to.equal(
      true, `Zero-fee operator ${op.id} must be active after migration`,
    );
    expect(BigInt(opETH.validatorCount)).to.equal(
      expectedEthCount, `Zero-fee operator ${op.id} must have ethValidatorCount == ${expectedEthCount}`,
    );
    expect(BigInt(opETH.fee)).to.equal(
      0n, `Zero-fee operator ${op.id} must have ethFee == 0`,
    );
  }
}

export async function assertLegacyReactivationOnMigration<S extends { migrationSnapshot: LegacyMigrationSnapshot; cluster: ClusterRecord }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { migrateReceipt } = ctx.state.migrationSnapshot;

  let foundReactivation = false;
  for (const log of migrateReceipt.logs ?? []) {
    let parsed;
    try {
      parsed = ctx.network.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed && parsed.name === Events.CLUSTER_REACTIVATED) {
      foundReactivation = true;
      break;
    }
  }
  expect(foundReactivation, "ClusterReactivated event not emitted on liquidated cluster migration").to.equal(true);
  expect(ctx.state.cluster.cluster.active).to.equal(true);
}

export async function assertEthConservation<S extends { cluster: ClusterRecord; operators: OperatorRecord[] }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { cluster, operators } = ctx.state;

  if (!cluster.cluster.active || BigInt(cluster.cluster.validatorCount) === 0n) return;

  const clusterBalance = BigInt(
    await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
  );

  let totalOperatorEarnings = 0n;
  for (const op of operators) {
    totalOperatorEarnings += BigInt(await ctx.views.getOperatorEarnings(op.id));
  }

  const networkEarnings = BigInt(await ctx.views.getNetworkEarnings());

  const contractAddress = await ctx.network.getAddress();
  const contractBalance = BigInt(await ctx.provider.getBalance(contractAddress));

  expect(clusterBalance + totalOperatorEarnings + networkEarnings).to.equal(contractBalance);
}
