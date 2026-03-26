import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { FuzzContext, ClusterRecord, OperatorRecord, StepFn } from "./types.ts";
import { parseClusterFromEvent } from "../../helpers/cluster.ts";
import { Events } from "../../common/events.ts";
import { setAccountBalance } from "../../helpers/blocks.ts";
import { makePublicKey } from "../../helpers/keys.ts";
import { ETH_DEDUCTED_DIGITS, BPS_DENOMINATOR, DEFAULT_SHARES, DEFAULT_ETH_REGISTER_VALUE } from "../../common/constants.ts";
import {
  computeClusterId,
  computeEBRoot,
  generateMerkleForClusterEB,
  commitEBRoot,
} from "../../helpers/oracle.ts";

export function removeValidators<S extends { cluster: ClusterRecord }>(min: number, max: number): StepFn<S> {
  return async function removeValidators(ctx: FuzzContext<S>): Promise<void> {
    const { cluster } = ctx.state;
    if (cluster.validatorKeys.length === 0) return;

    const count = Math.min(
      Number(ctx.rng.nextInRange(BigInt(min), BigInt(max))),
      cluster.validatorKeys.length,
    );
    const keysToRemove = cluster.validatorKeys.splice(0, count);

    const tx = await ctx.network
      .connect(cluster.owner)
      .bulkRemoveValidator(keysToRemove, cluster.operatorIds, cluster.cluster);
    const receipt = await tx.wait();
    cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_REMOVED);
  };
}

export interface DepositWithdrawTracker {
  totalDeposited: bigint;
  totalWithdrawn: bigint;
}

export function depositOrWithdraw<S extends { cluster: ClusterRecord; tracker: DepositWithdrawTracker }>(
  depositMin: bigint,
  depositMax: bigint,
): StepFn<S> {
  return async function depositOrWithdraw(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, tracker } = ctx.state;
    let shouldDeposit = ctx.rng.nextInRange(0n, 1n) === 0n;

    if (!shouldDeposit) {
      const balance = BigInt(
        await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
      );
      const burnRate = BigInt(
        await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
      );
      const pct = ctx.rng.nextInRange(1n, 95n);
      const amount = (balance * pct) / 100n;
      const remaining = balance - amount;

      const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());
      const networkFee = BigInt(await ctx.views.getNetworkFee());
      const validatorCount = BigInt(cluster.cluster.validatorCount);
      const vUnits = validatorCount * BPS_DENOMINATOR;
      let packedOpTotal = 0n;
      for (const op of await Promise.all(
        cluster.operatorIds.map(id => ctx.views.getOperatorById(id)),
      )) {
        packedOpTotal += BigInt(op.fee) / ETH_DEDUCTED_DIGITS;
      }
      const packedRate = packedOpTotal + networkFee / ETH_DEDUCTED_DIGITS;
      const thresholdUnits = (minBlocks * packedRate * vUnits) / BPS_DENOMINATOR;
      const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;

      if (amount === 0n || amount > balance || remaining < liquidationThreshold) {
        shouldDeposit = true;
      } else {
        const tx = await ctx.network
          .connect(cluster.owner)
          .withdraw(cluster.operatorIds, amount, cluster.cluster);
        const receipt = await tx.wait();
        cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_WITHDRAWN);
        tracker.totalWithdrawn += amount;
        return;
      }
    }

    if (shouldDeposit) {
      const amount = ctx.rng.nextInRange(depositMin, depositMax);
      await setAccountBalance(ctx.provider, cluster.owner.address, amount + 10n ** 18n);

      const tx = await ctx.network
        .connect(cluster.owner)
        .deposit(cluster.owner.address, cluster.operatorIds, cluster.cluster, { value: amount });
      const receipt = await tx.wait();
      cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_DEPOSITED);
      tracker.totalDeposited += amount;
    }
  };
}

export type LiquidationPhase = "pre-liquidation" | "liquidated" | "reactivated";

export function liquidateOrReactivate<S extends { cluster: ClusterRecord; phase: LiquidationPhase }>(
  reactivateDeposit: bigint,
): StepFn<S> {
  return async function liquidateOrReactivate(ctx: FuzzContext<S>): Promise<void> {
    const { cluster } = ctx.state;

    if (ctx.state.phase === "pre-liquidation") {
      const liquidatable = await ctx.views.isLiquidatable(
        cluster.owner.address,
        cluster.operatorIds,
        cluster.cluster,
      );
      if (!liquidatable) return;

      const tx = await ctx.network
        .connect(cluster.owner)
        .liquidate(cluster.owner.address, cluster.operatorIds, cluster.cluster);
      const receipt = await tx.wait();
      cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_LIQUIDATED);
      ctx.state.phase = "liquidated";
    } else if (ctx.state.phase === "liquidated") {
      await setAccountBalance(ctx.provider, cluster.owner.address, reactivateDeposit + 10n ** 18n);

      const tx = await ctx.network
        .connect(cluster.owner)
        .reactivate(cluster.operatorIds, cluster.cluster, { value: reactivateDeposit });
      const receipt = await tx.wait();
      cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_REACTIVATED);
      ctx.state.phase = "reactivated";
    }
  };
}

export async function setupFuzzOracles(
  ctx: FuzzContext<any>,
  oracles: HardhatEthersSigner[],
): Promise<void> {
  for (let i = 0; i < oracles.length; i++) {
    await ctx.network.replaceOracle(i + 1, oracles[i].address);
  }
}

export interface OracleState {
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
}

export function updateAllClusterBalances<S extends { clusters: ClusterRecord[]; oracle: OracleState }>(
  ebPerValidatorMin: number,
  ebPerValidatorMax: number,
): StepFn<S> {
  return async function updateAllClusterBalances(ctx: FuzzContext<S>): Promise<void> {
    const { clusters, oracle } = ctx.state;
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= oracle.lastCommittedBlock) return;

    const ebPerValidator = Number(ctx.rng.nextInRange(BigInt(ebPerValidatorMin), BigInt(ebPerValidatorMax)));

    const entries = clusters.map(c => ({
      clusterId: computeClusterId(c.owner.address, c.operatorIds),
      effectiveBalance: Number(c.cluster.validatorCount) * ebPerValidator,
    }));
    const { root, proofs } = generateMerkleForClusterEB(ctx.connection, entries);

    await commitEBRoot(ctx.network, root, Number(blockNum), oracle.oracles);
    oracle.lastCommittedBlock = blockNum;

    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const clusterId = entries[i].clusterId;
      const tx = await ctx.network.updateClusterBalance(
        blockNum,
        c.owner.address,
        c.operatorIds,
        c.cluster,
        entries[i].effectiveBalance,
        proofs[clusterId],
      );
      const receipt = await tx.wait();
      c.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);
    }

    await ctx.network.syncFees();
  };
}

export function ebValidatorLifecycle<S extends { cluster: ClusterRecord; operators: OperatorRecord[]; oracle: OracleState; nextKeyOffset: number; tickDepositDelta: bigint }>(
  ebPerValidatorMin: number,
  ebPerValidatorMax: number,
): StepFn<S> {
  return async function ebValidatorLifecycle(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, oracle } = ctx.state;
    ctx.state.tickDepositDelta = 0n;
    const action = Number(ctx.rng.nextInRange(0n, 2n));

    if (action === 0) {
      const blockNum = BigInt(await ctx.provider.getBlockNumber());
      if (blockNum <= oracle.lastCommittedBlock) return;
      if (cluster.cluster.validatorCount === 0n) return;

      const ebPerValidator = Number(ctx.rng.nextInRange(BigInt(ebPerValidatorMin), BigInt(ebPerValidatorMax)));
      const eb = Number(cluster.cluster.validatorCount) * ebPerValidator;
      const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
      const root = computeEBRoot(clusterId, eb);

      await commitEBRoot(ctx.network, root, Number(blockNum), oracle.oracles);
      oracle.lastCommittedBlock = blockNum;

      const tx = await ctx.network.updateClusterBalance(
        blockNum,
        cluster.owner.address,
        cluster.operatorIds,
        cluster.cluster,
        eb,
        [],
      );
      const receipt = await tx.wait();
      cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);
    } else if (action === 1) {
      if (cluster.validatorKeys.length === 0) return;

      const count = Math.min(
        Number(ctx.rng.nextInRange(1n, 5n)),
        cluster.validatorKeys.length,
      );
      const keysToRemove = cluster.validatorKeys.splice(0, count);

      const tx = await ctx.network
        .connect(cluster.owner)
        .bulkRemoveValidator(keysToRemove, cluster.operatorIds, cluster.cluster);
      const receipt = await tx.wait();
      cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_REMOVED);
    } else {
      const count = Number(ctx.rng.nextInRange(1n, 5n));
      const keys: string[] = [];
      const shares: string[] = [];
      for (let i = 0; i < count; i++) {
        keys.push(makePublicKey(ctx.state.nextKeyOffset++));
        shares.push(DEFAULT_SHARES);
      }

      const deposit = DEFAULT_ETH_REGISTER_VALUE * BigInt(count);
      await setAccountBalance(ctx.provider, cluster.owner.address, deposit + 10n ** 18n);

      const tx = await ctx.network
        .connect(cluster.owner)
        .bulkRegisterValidator(keys, cluster.operatorIds, shares, cluster.cluster, { value: deposit });
      const receipt = await tx.wait();
      cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_ADDED);
      cluster.validatorKeys.push(...keys);
      ctx.state.tickDepositDelta = deposit;
    }
  };
}
