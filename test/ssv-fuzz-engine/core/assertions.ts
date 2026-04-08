import { expect } from "chai";
import type { FuzzContext, ClusterRecord, OperatorRecord } from "./types.ts";
import type { LegacyMigrationSnapshot } from "./steps.ts";
import { ETH_DEDUCTED_DIGITS, BPS_DENOMINATOR, DEFAULT_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  computeBurnRate,
  computeClusterBalance,
  computeClusterBalanceWithVUnits,
  ebToVUnits,
} from "./fuzz-helpers.ts";

export interface ParsedEvent<TArgs = any> {
  index: number;
  name: string;
  args: TArgs;
  log: any;
}

export function collectParsedEvents(
  ctx: Pick<FuzzContext<any>, "network">,
  receipt: { logs?: readonly any[] } | null | undefined,
): ParsedEvent[] {
  const orderedEvents: ParsedEvent[] = [];
  const logs = receipt?.logs ?? [];
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    let parsed;
    try {
      parsed = ctx.network.interface.parseLog(log);
    } catch {
      continue;
    }
    if (!parsed) continue;
    orderedEvents.push({
      index: i,
      name: parsed.name,
      args: parsed.args,
      log,
    });
  }
  return orderedEvents;
}

export function collectParsedEventsByName<TArgs = any>(
  ctx: Pick<FuzzContext<any>, "network">,
  receipt: { logs?: readonly any[] } | null | undefined,
  eventName: string,
): ParsedEvent<TArgs>[] {
  return collectParsedEvents(ctx, receipt)
    .filter((event) => event.name === eventName) as ParsedEvent<TArgs>[];
}

interface OperatorFeeExecutedArgs {
  operatorId: bigint;
  fee: bigint;
}

function collectOperatorFeeExecutedEvents(
  ctx: Pick<FuzzContext<any>, "network">,
  receipt: { logs?: readonly any[] } | null | undefined,
): OperatorFeeExecutedArgs[] {
  return collectParsedEventsByName(ctx, receipt, Events.OPERATOR_FEE_EXECUTED).map((event) => ({
    operatorId: BigInt(event.args.operatorId),
    fee: BigInt(event.args.fee),
  }));
}

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

export function resetPhaseAwareSnapshots<S extends {
  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}>(
  ctx: FuzzContext<S>,
  options?: { resetContractBalanceWithDeltas?: boolean },
): void {
  ctx.state.lastPhaseAwareOperatorEarnings = undefined;
  ctx.state.lastPhaseAwareClusterBalance = undefined;
  ctx.state.lastPhaseAwareNetworkEarnings = undefined;
  if (options?.resetContractBalanceWithDeltas) {
    ctx.state.lastContractBalanceWithDeltas = undefined;
  }
}

export function resetEBSnapshots<S extends {
  lastEBOperatorEarnings?: EBOperatorEarningsSnapshot;
  lastEBClusterBalance?: EBClusterBalanceSnapshot;
  lastEBNetworkEarnings?: EBNetworkEarningsSnapshot;
  tickDepositDelta?: bigint;
}>(
  ctx: FuzzContext<S>,
  options?: { resetTickDepositDelta?: boolean },
): void {
  ctx.state.lastEBOperatorEarnings = undefined;
  ctx.state.lastEBClusterBalance = undefined;
  ctx.state.lastEBNetworkEarnings = undefined;
  if (options?.resetTickDepositDelta) {
    ctx.state.tickDepositDelta = 0n;
  }
}

export interface InactiveSettlementSnapshot {
  networkEarnings: bigint;
  operatorEarnings: Map<number, bigint>;
  clusterBalance: bigint;
  onchainClusterBalance?: bigint;
  contractEthBalance: bigint;
}

async function captureSettlementSnapshot<S extends { operators: OperatorRecord[]; cluster: ClusterRecord }>(
  ctx: FuzzContext<S>,
): Promise<InactiveSettlementSnapshot> {
  const operatorEarnings = new Map<number, bigint>();
  for (const op of ctx.state.operators) {
    operatorEarnings.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
  }
  const localClusterBalance = BigInt(ctx.state.cluster.cluster.balance);
  const readOnchainClusterBalance = async (): Promise<bigint> => BigInt(
    await ctx.views.getBalance(
      ctx.state.cluster.owner.address,
      ctx.state.cluster.operatorIds,
      ctx.state.cluster.cluster,
    ),
  );
  const contractEthBalance = await getContractEthBalance(ctx);

  let onchainClusterBalance: bigint | undefined;
  try {
    onchainClusterBalance = await readOnchainClusterBalance();
  } catch {
    await expect(
      ctx.views.getBalance(
        ctx.state.cluster.owner.address,
        ctx.state.cluster.operatorIds,
        ctx.state.cluster.cluster,
      ),
    ).to.be.revertedWithCustomError(ctx.network, Errors.CLUSTER_IS_LIQUIDATED);
    onchainClusterBalance = undefined;
  }
  if (onchainClusterBalance !== undefined) {
    expect(
      onchainClusterBalance,
      "Local cluster snapshot diverged from on-chain balance",
    ).to.equal(localClusterBalance);
  }
  return {
    networkEarnings: BigInt(await ctx.views.getNetworkEarnings()),
    operatorEarnings,
    clusterBalance: localClusterBalance,
    onchainClusterBalance,
    contractEthBalance,
  };
}

export async function assertInactiveClusterNoSettlement<S extends { cluster: ClusterRecord; operators: OperatorRecord[] }>(
  ctx: FuzzContext<S>,
  previous?: InactiveSettlementSnapshot,
  options?: { expectedClusterBalanceDelta?: bigint },
): Promise<InactiveSettlementSnapshot> {
  expect(ctx.state.cluster.cluster.active).to.equal(false, "Expected inactive cluster");
  const current = await captureSettlementSnapshot(ctx);
  if (previous !== undefined) {
    const expectedClusterBalanceDelta = options?.expectedClusterBalanceDelta ?? 0n;
    expect(current.networkEarnings).to.equal(previous.networkEarnings);
    for (const [opId, earnings] of previous.operatorEarnings.entries()) {
      expect(
        current.operatorEarnings.get(opId),
        `Operator ${opId} earnings changed while cluster is inactive`,
      ).to.equal(earnings);
    }
    expect(
      current.clusterBalance,
      "Inactive cluster balance changed beyond expected explicit deposit/withdraw delta",
    ).to.equal(previous.clusterBalance + expectedClusterBalanceDelta);
    expect(
      current.contractEthBalance,
      "Contract ETH balance changed beyond expected explicit deposit/withdraw delta",
    ).to.equal(previous.contractEthBalance + expectedClusterBalanceDelta);
    if (previous.onchainClusterBalance !== undefined && current.onchainClusterBalance !== undefined) {
      expect(
        current.onchainClusterBalance,
        "On-chain inactive cluster balance changed beyond expected explicit deposit/withdraw delta",
      ).to.equal(previous.onchainClusterBalance + expectedClusterBalanceDelta);
    } else if (previous.onchainClusterBalance !== undefined && current.onchainClusterBalance === undefined) {
      const expectedOnchainBalance = previous.onchainClusterBalance + expectedClusterBalanceDelta;
      // getBalance() is expected to become unreadable when inactive cluster reaches zero balance.
      expect(
        expectedOnchainBalance,
        "On-chain balance became unreadable before expected zero-balance liquidated state",
      ).to.equal(0n);
    }
  }
  return current;
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

export async function assertValidatorCounts<S extends { operators: OperatorRecord[] }>(
  ctx: FuzzContext<S>,
  expectedByOperator: Record<number, bigint> | Map<number, bigint>,
): Promise<void> {
  const expectedEntries = expectedByOperator instanceof Map
    ? expectedByOperator.entries()
    : Object.entries(expectedByOperator).map(([id, count]) => [Number(id), count] as const);

  for (const [operatorId, expected] of expectedEntries) {
    const opData = await ctx.views.getOperatorById(Number(operatorId));
    expect(BigInt(opData.validatorCount)).to.equal(
      expected,
      `Unexpected validatorCount for operator ${operatorId}`,
    );
  }
}

export function computeEBAccrualDelta(blocks: bigint, packedFee: bigint, vUnits: bigint): bigint {
  return ((blocks * packedFee * vUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
}

export interface EBOperatorEarningsSnapshot {
  block: bigint;
  earnings: Map<number, bigint>;
  vUnits: bigint;
}

export interface EBTransitionSnapshot {
  block: bigint;
  clusterBalance: bigint;
  networkEarnings: bigint;
  operatorEarnings: Map<number, bigint>;
}

export async function captureEBTransitionSnapshot<S extends { cluster: ClusterRecord; operators: OperatorRecord[] }>(
  ctx: FuzzContext<S>,
): Promise<EBTransitionSnapshot> {
  const { cluster, operators } = ctx.state;

  const operatorEarnings = new Map<number, bigint>();
  for (const op of operators) {
    operatorEarnings.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
  }

  return {
    block: BigInt(await ctx.provider.getBlockNumber()),
    clusterBalance: BigInt(await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster)),
    networkEarnings: BigInt(await ctx.views.getNetworkEarnings()),
    operatorEarnings,
  };
}

export async function assertEBTransitionSettledAtVUnits<
  S extends { cluster: ClusterRecord; operators: OperatorRecord[] }
>(
  ctx: FuzzContext<S>,
  snapshot: EBTransitionSnapshot,
  settledVUnits: bigint,
  clusterBalanceOverride?: bigint,
): Promise<void> {
  const { cluster, operators } = ctx.state;
  const block = BigInt(await ctx.provider.getBlockNumber());
  const blocks = block - snapshot.block;
  const networkFee = BigInt(await ctx.views.getNetworkFee());

  const operatorFees = operators.map(op => op.fee);

  let packedTotal = networkFee / ETH_DEDUCTED_DIGITS;
  for (const fee of operatorFees) {
    packedTotal += fee / ETH_DEDUCTED_DIGITS;
  }
  const expectedClusterBalance = computeClusterBalanceWithVUnits(
    snapshot.clusterBalance,
    operatorFees,
    networkFee,
    settledVUnits,
    blocks,
  );

  const currentClusterBalance = clusterBalanceOverride ?? BigInt(
    await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
  );
  expect(currentClusterBalance).to.equal(expectedClusterBalance);

  const packedNetworkFee = networkFee / ETH_DEDUCTED_DIGITS;
  const expectedNetworkDelta = computeEBAccrualDelta(blocks, packedNetworkFee, settledVUnits);
  const currentNetworkEarnings = BigInt(await ctx.views.getNetworkEarnings());
  expect(currentNetworkEarnings).to.equal(snapshot.networkEarnings + expectedNetworkDelta);

  for (const op of operators) {
    const packedFee = op.fee / ETH_DEDUCTED_DIGITS;
    const expectedOpDelta = computeEBAccrualDelta(blocks, packedFee, settledVUnits);
    const currentOpEarnings = BigInt(await ctx.views.getOperatorEarnings(op.id));
    expect(currentOpEarnings).to.equal(snapshot.operatorEarnings.get(op.id)! + expectedOpDelta);
  }
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
        const expectedDelta = computeEBAccrualDelta(blocks, packedFee, prev.vUnits);
        expect(currentEarnings.get(op.id)).to.equal(prev.earnings.get(op.id)! + expectedDelta);
      }
    }
  }

  ctx.state.lastEBOperatorEarnings = { block, earnings: currentEarnings, vUnits: currentVUnits };
}

export interface EBNetworkEarningsSnapshot {
  block: bigint;
  earnings: bigint;
  vUnits: bigint;
}

export async function assertNetworkEarningsWithEB<S extends {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  lastEBNetworkEarnings?: EBNetworkEarningsSnapshot;
}>(ctx: FuzzContext<S>): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster } = ctx.state;
  const currentEarnings = BigInt(await ctx.views.getNetworkEarnings());
  const networkFee = BigInt(await ctx.views.getNetworkFee());

  let currentVUnits: bigint;
  if (cluster.cluster.active && BigInt(cluster.cluster.validatorCount) > 0n) {
    const eb = BigInt(await ctx.views.getEffectiveBalance(
      cluster.owner.address, cluster.operatorIds, cluster.cluster,
    ));
    currentVUnits = ebToVUnits(eb);
  } else {
    currentVUnits = 0n;
  }

  if (ctx.state.lastEBNetworkEarnings !== undefined) {
    const prev = ctx.state.lastEBNetworkEarnings;
    if (prev.vUnits === currentVUnits) {
      const blocks = block - prev.block;
      const packedNetFee = networkFee / ETH_DEDUCTED_DIGITS;
      const expectedDelta = computeEBAccrualDelta(blocks, packedNetFee, prev.vUnits);
      expect(currentEarnings).to.equal(prev.earnings + expectedDelta);
    }
  }

  ctx.state.lastEBNetworkEarnings = { block, earnings: currentEarnings, vUnits: currentVUnits };
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

const DISCONTINUOUS_EB_SNAPSHOT_VUNITS = -1n;

export async function assertClusterBalanceWithEB<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; lastEBClusterBalance?: EBClusterBalanceSnapshot; tickDepositDelta: bigint }>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const block = BigInt(await ctx.provider.getBlockNumber());
  const { cluster, operators } = ctx.state;

  if (!cluster.cluster.active || BigInt(cluster.cluster.validatorCount) === 0n) {
    // This is a test-local continuity marker, not a protocol statement about
    // on-chain EB. Explicit cluster vUnits can survive liquidation, but balance
    // burn is suspended while inactive and when validatorCount is zero.
    ctx.state.lastEBClusterBalance = {
      block,
      balance: BigInt(cluster.cluster.balance),
      vUnits: DISCONTINUOUS_EB_SNAPSHOT_VUNITS,
    };
    return;
  }

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
  const feeEvents = collectOperatorFeeExecutedEvents(ctx, migrateReceipt);

  expect(feeEvents.length).to.equal(operatorIds.length);

  for (const opId of operatorIds) {
    const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
    expect(ev, `OperatorFeeExecuted missing for operator ${opId}`).to.not.be.undefined;
    expect(ev!.fee).to.equal(BigInt(DEFAULT_OPERATOR_ETH_FEE));
  }
}

export async function assertMixedFeeEnsureETHDefaultsTransition<S extends {
  migrationSnapshot: LegacyMigrationSnapshot;
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  ssvFees: bigint[];
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { migrateReceipt } = ctx.state.migrationSnapshot;
  const { operatorIds } = ctx.state.cluster;
  const { ssvFees } = ctx.state;
  const feeEvents = collectOperatorFeeExecutedEvents(ctx, migrateReceipt);

  const expectedEventCount = ssvFees.filter(f => f !== 0n).length;
  expect(feeEvents.length).to.equal(
    expectedEventCount,
    `Expected ${expectedEventCount} OperatorFeeExecuted events for non-zero SSV fee operators`,
  );

  for (let i = 0; i < operatorIds.length; i++) {
    const opId = operatorIds[i];
    const ssvFee = ssvFees[i];

    if (ssvFee === 0n) {
      const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
      expect(ev, `Zero-fee operator ${opId} must NOT have OperatorFeeExecuted event`).to.be.undefined;

      const opETH = await ctx.views.getOperatorById(opId);
      expect(BigInt(opETH.fee)).to.equal(0n, `Zero-fee operator ${opId} must have ethFee == 0`);
    } else {
      const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
      expect(ev, `Non-zero-fee operator ${opId} must have OperatorFeeExecuted event`).to.not.be.undefined;
      expect(ev!.fee).to.equal(BigInt(DEFAULT_OPERATOR_ETH_FEE));
    }
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
  const feeEvents = collectOperatorFeeExecutedEvents(ctx, migrateReceipt);

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
  const feeEvents = collectOperatorFeeExecutedEvents(ctx, migrateReceipt);

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
  const feeEvents = collectOperatorFeeExecutedEvents(ctx, migrateReceipt);

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
  const foundReactivation = collectParsedEventsByName(ctx, migrateReceipt, Events.CLUSTER_REACTIVATED).length > 0;
  expect(foundReactivation, "ClusterReactivated event not emitted on liquidated cluster migration").to.equal(true);
  expect(ctx.state.cluster.cluster.active).to.equal(true);
}

export async function assertLargeClusterMigrationEvents<S extends {
  migrationSnapshot: LegacyMigrationSnapshot;
  cluster: ClusterRecord;
  ssvFees: bigint[];
  removedOperatorIds: number[];
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { migrateReceipt } = ctx.state.migrationSnapshot;
  const { operatorIds } = ctx.state.cluster;
  const { ssvFees, removedOperatorIds } = ctx.state;
  const feeEvents = collectOperatorFeeExecutedEvents(ctx, migrateReceipt);

  const expectedEventCount = operatorIds.filter((id, i) =>
    ssvFees[i] !== 0n && !removedOperatorIds.includes(id),
  ).length;
  expect(feeEvents.length).to.equal(
    expectedEventCount,
    `Expected ${expectedEventCount} OperatorFeeExecuted events (non-zero fee, non-removed)`,
  );

  for (let i = 0; i < operatorIds.length; i++) {
    const opId = operatorIds[i];
    const ssvFee = ssvFees[i];
    const isRemoved = removedOperatorIds.includes(opId);

    if (isRemoved) {
      const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
      expect(ev, `Removed operator ${opId} must NOT have OperatorFeeExecuted`).to.be.undefined;

      const opETH = await ctx.views.getOperatorById(opId);
      expect(BigInt(opETH.validatorCount)).to.equal(
        0n, `Removed operator ${opId} must have ethValidatorCount == 0`,
      );
      const opSSV = await ctx.views.getOperatorByIdSSV(opId);
      expect(BigInt(opSSV.validatorCount)).to.equal(
        0n, `Removed operator ${opId} must have SSV validatorCount == 0`,
      );
    } else if (ssvFee === 0n) {
      const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
      expect(ev, `Zero-fee operator ${opId} must NOT have OperatorFeeExecuted`).to.be.undefined;

      const opETH = await ctx.views.getOperatorById(opId);
      expect(BigInt(opETH.fee)).to.equal(0n, `Zero-fee operator ${opId} must have ethFee == 0`);
    } else {
      const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
      expect(ev, `Normal operator ${opId} must have OperatorFeeExecuted`).to.not.be.undefined;
      expect(ev!.fee).to.equal(BigInt(DEFAULT_OPERATOR_ETH_FEE));
    }
  }
}

export async function assertPendingFeeOperatorsMigrationEvents<S extends {
  migrationSnapshot: LegacyMigrationSnapshot;
  cluster: ClusterRecord;
  pendingOperatorIds: number[];
}>(
  ctx: FuzzContext<S>,
): Promise<void> {
  const { migrateReceipt } = ctx.state.migrationSnapshot;
  const { operatorIds } = ctx.state.cluster;
  const { pendingOperatorIds } = ctx.state;
  const feeEvents = collectOperatorFeeExecutedEvents(ctx, migrateReceipt);

  const normalOpIds = operatorIds.filter(id => !pendingOperatorIds.includes(id));
  expect(feeEvents.length).to.equal(
    normalOpIds.length,
    `Expected ${normalOpIds.length} OperatorFeeExecuted events (only normal ops, not pending-fee ops)`,
  );

  for (const opId of pendingOperatorIds) {
    const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
    expect(ev, `Pending-fee operator ${opId} must NOT have OperatorFeeExecuted during migration (already ETH-initialized by declareOperatorFee)`).to.be.undefined;
  }

  for (const opId of normalOpIds) {
    const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
    expect(ev, `Normal operator ${opId} must have OperatorFeeExecuted during migration`).to.not.be.undefined;
    expect(ev!.fee).to.equal(BigInt(DEFAULT_OPERATOR_ETH_FEE));
  }
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
