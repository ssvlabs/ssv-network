import { expect } from "chai";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./types.ts";
import { parseClusterFromEvent } from "../../helpers/cluster.ts";
import { Events } from "../../common/events.ts";
import { setAccountBalance } from "../../helpers/blocks.ts";
import { makePublicKey } from "../../helpers/keys.ts";
import { computeBurnRate } from "./fuzz-helpers.ts";
import { alignFee } from "./setup.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  DEFAULT_SHARES,
  MINIMAL_LIQUIDATION_THRESHOLD,
  MAXIMUM_OPERATORS_FEE,
} from "../../common/constants.ts";

export interface ChaosState {
  operators: OperatorRecord[];
  clusters: ClusterRecord[];
  nextKeyOffset: number;
}

async function tryAction(action: () => Promise<any>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    return false;
  }
}

function pickCluster(ctx: FuzzContext<ChaosState>): ClusterRecord {
  return ctx.state.clusters[Number(ctx.rng.nextInRange(0n, BigInt(ctx.state.clusters.length - 1)))];
}

async function depositToCluster(ctx: FuzzContext<ChaosState>): Promise<void> {
  const cluster = pickCluster(ctx);
  if (!cluster.cluster.active) return;

  const amount = ctx.rng.nextInRange(ETH_DEDUCTED_DIGITS, DEFAULT_ETH_REGISTER_VALUE);
  await setAccountBalance(ctx.provider, cluster.owner.address, amount + 10n ** 18n);

  const tx = await ctx.network
    .connect(cluster.owner)
    .deposit(cluster.owner.address, cluster.operatorIds, cluster.cluster, { value: amount });
  cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_DEPOSITED);
}

async function withdrawFromCluster(ctx: FuzzContext<ChaosState>): Promise<void> {
  const cluster = pickCluster(ctx);
  if (!cluster.cluster.active || BigInt(cluster.cluster.validatorCount) === 0n) return;

  const balance = BigInt(
    await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
  );
  if (balance === 0n) return;

  const amount = (balance * ctx.rng.nextInRange(1n, 30n)) / 100n;
  if (amount === 0n) return;

  await tryAction(async () => {
    const tx = await ctx.network
      .connect(cluster.owner)
      .withdraw(cluster.operatorIds, amount, cluster.cluster);
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_WITHDRAWN);
  });
}

async function registerValidator(ctx: FuzzContext<ChaosState>): Promise<void> {
  const cluster = pickCluster(ctx);
  if (!cluster.cluster.active) return;

  const key = makePublicKey(ctx.state.nextKeyOffset++);
  await setAccountBalance(ctx.provider, cluster.owner.address, DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n);

  const tx = await ctx.network
    .connect(cluster.owner)
    .bulkRegisterValidator([key], cluster.operatorIds, [DEFAULT_SHARES], cluster.cluster, {
      value: DEFAULT_ETH_REGISTER_VALUE,
    });
  cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.VALIDATOR_ADDED);
  cluster.validatorKeys.push(key);
}

async function removeValidator(ctx: FuzzContext<ChaosState>): Promise<void> {
  const cluster = pickCluster(ctx);
  if (!cluster.cluster.active || cluster.validatorKeys.length === 0) return;

  const key = cluster.validatorKeys.splice(0, 1)[0];
  const tx = await ctx.network
    .connect(cluster.owner)
    .bulkRemoveValidator([key], cluster.operatorIds, cluster.cluster);
  cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.VALIDATOR_REMOVED);
}

async function attemptLiquidation(ctx: FuzzContext<ChaosState>): Promise<void> {
  const cluster = pickCluster(ctx);
  if (!cluster.cluster.active) return;
  if (!await ctx.views.isLiquidatable(cluster.owner.address, cluster.operatorIds, cluster.cluster)) return;

  const liquidator = ctx.signers[9];
  await setAccountBalance(ctx.provider, liquidator.address, 10n ** 18n);
  const tx = await ctx.network
    .connect(liquidator)
    .liquidate(cluster.owner.address, cluster.operatorIds, cluster.cluster);
  cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_LIQUIDATED);

  expect(cluster.cluster.active).to.equal(false);
  expect(BigInt(cluster.cluster.balance)).to.equal(0n);
}

async function attemptReactivation(ctx: FuzzContext<ChaosState>): Promise<void> {
  const inactive = ctx.state.clusters.filter(c => !c.cluster.active);
  if (inactive.length === 0) return;

  const cluster = ctx.rng.pick(inactive);
  const deposit = DEFAULT_ETH_REGISTER_VALUE * 10n;
  await setAccountBalance(ctx.provider, cluster.owner.address, deposit + 10n ** 18n);

  const succeeded = await tryAction(async () => {
    const tx = await ctx.network
      .connect(cluster.owner)
      .reactivate(cluster.operatorIds, cluster.cluster, { value: deposit });
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_REACTIVATED);
  });

  if (succeeded) {
    expect(cluster.cluster.active).to.equal(true);
  }
}

async function withdrawOperatorEarnings(ctx: FuzzContext<ChaosState>): Promise<void> {
  const op = ctx.rng.pick(ctx.state.operators);
  if (BigInt(await ctx.views.getOperatorEarnings(op.id)) === 0n) return;
  await tryAction(() => ctx.network.connect(op.owner).withdrawAllOperatorEarnings(op.id));
}

async function withdrawNetworkSSVEarnings(ctx: FuzzContext<ChaosState>): Promise<void> {
  const earnings = BigInt(await ctx.views.getNetworkEarningsSSV());
  if (earnings === 0n) return;
  await tryAction(() => ctx.network.withdrawNetworkSSVEarnings(earnings));
}

async function changeNetworkFee(ctx: FuzzContext<ChaosState>): Promise<void> {
  await ctx.network.updateNetworkFee(
    alignFee(ctx.rng.nextInRange(ETH_DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS * 100n)),
  );
}

async function changeLiquidationThreshold(ctx: FuzzContext<ChaosState>): Promise<void> {
  await ctx.network.updateLiquidationThresholdPeriod(
    ctx.rng.nextInRange(MINIMAL_LIQUIDATION_THRESHOLD, MINIMAL_LIQUIDATION_THRESHOLD * 10n),
  );
}

async function changeMinCollateral(ctx: FuzzContext<ChaosState>): Promise<void> {
  await ctx.network.updateMinimumLiquidationCollateral(
    alignFee(ctx.rng.nextInRange(0n, ETH_DEDUCTED_DIGITS * 10000n)),
  );
}

async function changeMinOperatorFee(ctx: FuzzContext<ChaosState>): Promise<void> {
  const maxFee = BigInt(await ctx.views.getMaximumOperatorFee());
  if (maxFee <= MINIMAL_OPERATOR_ETH_FEE) return;
  await tryAction(() =>
    ctx.network.updateMinimumOperatorEthFee(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, maxFee))),
  );
}

async function changeMaxOperatorFee(ctx: FuzzContext<ChaosState>): Promise<void> {
  await tryAction(() =>
    ctx.network.updateMaximumOperatorFee(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MAXIMUM_OPERATORS_FEE))),
  );
}

async function declareOperatorFee(ctx: FuzzContext<ChaosState>): Promise<void> {
  const op = ctx.rng.pick(ctx.state.operators);
  const maxFee = BigInt(await ctx.views.getMaximumOperatorFee());
  const minFee = BigInt(await ctx.views.getMinimumOperatorEthFee());
  if (maxFee <= minFee + ETH_DEDUCTED_DIGITS) return;
  await tryAction(() => ctx.network.connect(op.owner).declareOperatorFee(op.id, alignFee(ctx.rng.nextInRange(minFee, maxFee))));
}

async function executeOperatorFee(ctx: FuzzContext<ChaosState>): Promise<void> {
  const op = ctx.rng.pick(ctx.state.operators);
  const periods = await ctx.views.getOperatorFeePeriods();
  await ctx.provider.send("evm_increaseTime", [Number(periods[0]) + 1]);
  await ctx.provider.send("evm_mine", []);

  if (await tryAction(() => ctx.network.connect(op.owner).executeOperatorFee(op.id))) {
    op.fee = BigInt((await ctx.views.getOperatorById(op.id)).fee);
  }
}

async function reduceOperatorFee(ctx: FuzzContext<ChaosState>): Promise<void> {
  const op = ctx.rng.pick(ctx.state.operators);
  if (op.fee === 0n) return;

  if (ctx.rng.nextInRange(0n, 3n) === 0n) {
    if (await tryAction(() => ctx.network.connect(op.owner).reduceOperatorFee(op.id, 0))) op.fee = 0n;
  } else {
    const minFee = BigInt(await ctx.views.getMinimumOperatorEthFee());
    if (minFee >= op.fee) return;
    const target = alignFee(ctx.rng.nextInRange(minFee, op.fee));
    if (await tryAction(() => ctx.network.connect(op.owner).reduceOperatorFee(op.id, target))) op.fee = target;
  }
}

async function cancelDeclaredOperatorFee(ctx: FuzzContext<ChaosState>): Promise<void> {
  const op = ctx.rng.pick(ctx.state.operators);
  await tryAction(() => ctx.network.connect(op.owner).cancelDeclaredOperatorFee(op.id));
}

export async function checkChaosInvariants(ctx: FuzzContext<ChaosState>): Promise<void> {
  const { clusters, operators } = ctx.state;

  const operatorClusterMap = new Map<number, number[]>();
  for (let ci = 0; ci < clusters.length; ci++) {
    for (const opId of clusters[ci].operatorIds) {
      const existing = operatorClusterMap.get(opId) || [];
      existing.push(ci);
      operatorClusterMap.set(opId, existing);
    }
  }

  for (const op of operators) {
    let expected = 0n;
    for (const ci of operatorClusterMap.get(op.id) || []) {
      if (clusters[ci].cluster.active) expected += BigInt(clusters[ci].cluster.validatorCount);
    }
    expect(BigInt((await ctx.views.getOperatorById(op.id)).validatorCount)).to.equal(expected);
  }

  let expectedNetworkCount = 0n;
  for (const c of clusters) {
    if (c.cluster.active) expectedNetworkCount += BigInt(c.cluster.validatorCount);
  }
  expect(BigInt(await ctx.views.getNetworkValidatorsCount())).to.equal(expectedNetworkCount);

  for (const c of clusters) {
    if (!c.cluster.active || BigInt(c.cluster.validatorCount) === 0n) continue;
    const opFees: bigint[] = [];
    for (const opId of c.operatorIds) {
      opFees.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
    }
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const vUnits = BigInt(c.cluster.validatorCount) * BPS_DENOMINATOR;
    expect(BigInt(await ctx.views.getBurnRate(c.owner.address, c.operatorIds, c.cluster)))
      .to.equal(computeBurnRate(opFees, networkFee, vUnits));
  }

  let totalClusterBalance = 0n;
  for (const c of clusters) {
    if (!c.cluster.active) continue;
    if (BigInt(c.cluster.validatorCount) === 0n) {
      totalClusterBalance += BigInt(c.cluster.balance);
    } else {
      totalClusterBalance += BigInt(
        await ctx.views.getBalance(c.owner.address, c.operatorIds, c.cluster),
      );
    }
  }

  const seenOps = new Set<number>();
  let totalOpEarnings = 0n;
  for (const op of operators) {
    if (seenOps.has(op.id)) continue;
    seenOps.add(op.id);
    totalOpEarnings += BigInt(await ctx.views.getOperatorEarnings(op.id));
  }

  const networkEarnings = BigInt(await ctx.views.getNetworkEarnings());
  const contractBalance = BigInt(await ctx.provider.getBalance(await ctx.network.getAddress()));
  expect(totalClusterBalance + totalOpEarnings + networkEarnings).to.equal(contractBalance);

  for (const c of clusters) {
    if (!c.cluster.active) {
      expect(BigInt(c.cluster.balance)).to.equal(0n);
    }
  }
}

export const ALL_CHAOS_ACTIONS: { fn: (ctx: FuzzContext<ChaosState>) => Promise<void>; weight: number }[] = [
  { fn: changeNetworkFee, weight: 10 },
  { fn: changeLiquidationThreshold, weight: 5 },
  { fn: changeMinCollateral, weight: 5 },
  { fn: changeMinOperatorFee, weight: 3 },
  { fn: changeMaxOperatorFee, weight: 3 },
  { fn: declareOperatorFee, weight: 8 },
  { fn: executeOperatorFee, weight: 5 },
  { fn: reduceOperatorFee, weight: 5 },
  { fn: cancelDeclaredOperatorFee, weight: 3 },
  { fn: depositToCluster, weight: 12 },
  { fn: withdrawFromCluster, weight: 8 },
  { fn: registerValidator, weight: 5 },
  { fn: removeValidator, weight: 5 },
  { fn: attemptLiquidation, weight: 10 },
  { fn: attemptReactivation, weight: 8 },
  { fn: withdrawOperatorEarnings, weight: 3 },
  { fn: withdrawNetworkSSVEarnings, weight: 2 },
];
