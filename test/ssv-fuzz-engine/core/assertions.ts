import { expect } from "chai";
import type { FuzzContext, ClusterRecord, OperatorRecord } from "./types.ts";
import { ETH_DEDUCTED_DIGITS, BPS_DENOMINATOR } from "../../common/constants.ts";
import { computeBurnRate, computeClusterBalance } from "./fuzz-helpers.ts";

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
