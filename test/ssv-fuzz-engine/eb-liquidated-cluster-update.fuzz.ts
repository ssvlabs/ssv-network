import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { ebToVUnits, setupFuzzOracles, generateRandomFees, computeLiquidationMetrics, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  computeClusterId,
  computeEBRoot,
  commitEBRoot,
} from "../helpers/oracle.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  BPS_DENOMINATOR,
} from "../common/constants.ts";

type Phase =
  | "set-explicit-eb"
  | "liquidate"
  | "eb-update-while-liquidated"
  | "verify-no-side-effects"
  | "verified";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  phase: Phase;
  clusterId: string;
  validatorCount: number;
  initialEB: number;
  liquidatedEB: number;
  operatorEarningsBeforeUpdate: Map<number, bigint>;
  networkEarningsBeforeUpdate: bigint;
  burnRateBeforeLiquidation: bigint;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { cluster, oracles, clusterId, validatorCount } = ctx.state;

  if (ctx.state.phase === "set-explicit-eb") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const root = computeEBRoot(clusterId, ctx.state.initialEB);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, ctx.state.initialEB, [],
    );
    const receipt = await tx.wait();

    const liqEvent = receipt.logs?.find((log: any) => {
      try { return ctx.network.interface.parseLog(log)?.name === Events.CLUSTER_LIQUIDATED; } catch { return false; }
    });
    if (liqEvent) {
      cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_LIQUIDATED);
      expect(cluster.cluster.active).to.equal(false);
      ctx.state.phase = "eb-update-while-liquidated";
    } else {
      cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);
      ctx.state.phase = "liquidate";
    }
    return;
  }

  if (ctx.state.phase === "liquidate") {
    const liquidatable = await ctx.views.isLiquidatable(
      cluster.owner.address, cluster.operatorIds, cluster.cluster,
    );
    if (!liquidatable) return;

    const [liquidator] = ctx.signers;
    const tx = await ctx.network
      .connect(liquidator)
      .liquidate(cluster.owner.address, cluster.operatorIds, cluster.cluster);
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_LIQUIDATED);

    expect(cluster.cluster.active).to.equal(false);

    ctx.state.phase = "eb-update-while-liquidated";
    return;
  }

  if (ctx.state.phase === "eb-update-while-liquidated") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const earningsMap = new Map<number, bigint>();
    for (const op of ctx.state.operators) {
      earningsMap.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
    }
    ctx.state.operatorEarningsBeforeUpdate = earningsMap;
    ctx.state.networkEarningsBeforeUpdate = BigInt(await ctx.views.getNetworkEarnings());

    const root = computeEBRoot(clusterId, ctx.state.liquidatedEB);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, ctx.state.liquidatedEB, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    expect(cluster.cluster.active).to.equal(false);

    ctx.state.phase = "verify-no-side-effects";
    return;
  }

  if (ctx.state.phase === "verify-no-side-effects") {
    for (const op of ctx.state.operators) {
      const current = BigInt(await ctx.views.getOperatorEarnings(op.id));
      expect(current).to.equal(ctx.state.operatorEarningsBeforeUpdate.get(op.id)!);
    }

    const networkEarningsAfter = BigInt(await ctx.views.getNetworkEarnings());
    expect(networkEarningsAfter).to.equal(ctx.state.networkEarningsBeforeUpdate);

    expect(BigInt(cluster.cluster.balance)).to.equal(0n);
    expect(cluster.cluster.active).to.equal(false);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: EB update on liquidated ETH cluster — snapshot stored, no accounting", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 20,
        blocksPerTick: { min: 50n, max: 500n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner, staker] = ctx.signers;

          const fees = generateRandomFees(ctx, 4, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees);
          const operatorIds = operators.map(o => o.id);

          const oracles = await setupFuzzOracles(ctx, staker);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 5n));
          const initialEBPerVal = Number(ctx.rng.nextInRange(32n, 512n));
          const initialEB = initialEBPerVal * validatorCount;
          const liquidatedEBPerVal = Number(ctx.rng.nextInRange(32n, 2048n));
          const liquidatedEB = liquidatedEBPerVal * validatorCount;

          const initialVUnits = ebToVUnits(initialEB);
          const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());
          const networkFee = BigInt(await ctx.views.getNetworkFee());

          const { threshold, burnPerBlock } = computeLiquidationMetrics(operators.map(o => o.fee), networkFee, initialVUnits, minBlocks);
          const extraBlocks = ctx.rng.nextInRange(100n, 500n);
          const totalDeposit = threshold + burnPerBlock * extraBlocks;
          const depositPerValidator = totalDeposit / BigInt(validatorCount) + 1n;

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds,
            validatorCount, depositPerValidator,
          );

          return {
            operators, cluster, oracles,
            lastCommittedBlock: 0n,
            phase: "set-explicit-eb" as Phase,
            clusterId: computeClusterId(clusterOwner.address, operatorIds),
            validatorCount,
            initialEB,
            liquidatedEB,
            operatorEarningsBeforeUpdate: new Map(),
            networkEarningsBeforeUpdate: 0n,
            burnRateBeforeLiquidation: 0n,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
