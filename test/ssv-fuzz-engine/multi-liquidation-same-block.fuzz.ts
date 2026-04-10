import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { computeLiquidationMetrics, generateRandomFees, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

type Phase =
  | "wait-liquidatable"
  | "liquidate-same-block"
  | "verify"
  | "verified";

interface State {
  operatorsA: OperatorRecord[];
  operatorsB: OperatorRecord[];
  clusterA: ClusterRecord;
  clusterB: ClusterRecord;
  phase: Phase;
  valCountA: number;
  valCountB: number;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { clusterA, clusterB, operatorsA, operatorsB } = ctx.state;

  if (ctx.state.phase === "wait-liquidatable") {
    const liqA = await ctx.views.isLiquidatable(
      clusterA.owner.address, clusterA.operatorIds, clusterA.cluster,
    );
    const liqB = await ctx.views.isLiquidatable(
      clusterB.owner.address, clusterB.operatorIds, clusterB.cluster,
    );
    if (!liqA || !liqB) return;

    ctx.state.phase = "liquidate-same-block";
    return;
  }

  if (ctx.state.phase === "liquidate-same-block") {
    const [liquidator] = ctx.signers;

    const contractAddr = await ctx.network.getAddress();
    const contractBalBefore = BigInt(await ctx.provider.getBalance(contractAddr));
    const liquidatorBalBefore = BigInt(await ctx.provider.getBalance(liquidator.address));

    await ctx.provider.send("evm_setAutomine", [false]);

    const txA = await ctx.network.connect(liquidator)
      .liquidate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster);
    const txB = await ctx.network.connect(liquidator)
      .liquidate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster);

    await ctx.provider.send("evm_mine", []);
    await ctx.provider.send("evm_setAutomine", [true]);

    const receiptA = await txA.wait();
    const receiptB = await txB.wait();

    expect(receiptA.blockNumber).to.equal(receiptB.blockNumber);

    clusterA.cluster = parseClusterFromEvent(ctx.network, receiptA, Events.CLUSTER_LIQUIDATED);
    clusterB.cluster = parseClusterFromEvent(ctx.network, receiptB, Events.CLUSTER_LIQUIDATED);

    expect(clusterA.cluster.active).to.equal(false);
    expect(clusterB.cluster.active).to.equal(false);
    expect(BigInt(clusterA.cluster.balance)).to.equal(0n);
    expect(BigInt(clusterB.cluster.balance)).to.equal(0n);

    const gasA = BigInt(receiptA.gasUsed) * BigInt(receiptA.gasPrice);
    const gasB = BigInt(receiptB.gasUsed) * BigInt(receiptB.gasPrice);
    const liquidatorBalAfter = BigInt(await ctx.provider.getBalance(liquidator.address));
    const totalBounty = liquidatorBalAfter - liquidatorBalBefore + gasA + gasB;

    const contractBalAfter = BigInt(await ctx.provider.getBalance(contractAddr));
    expect(contractBalBefore - contractBalAfter).to.equal(totalBounty);

    ctx.state.phase = "verify";
    return;
  }

  if (ctx.state.phase === "verify") {
    for (const op of operatorsA) {
      const opData = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opData.validatorCount)).to.equal(0n);
    }

    for (const op of operatorsB) {
      const opData = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opData.validatorCount)).to.equal(0n);
    }

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: Multiple liquidations in same block (CAT-5-6)", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 30,
        blocksPerTick: { min: 50n, max: 500n },

        async setup(ctx) {
          const [, opOwnerA, clusterOwnerA, opOwnerB, clusterOwnerB] = ctx.signers;

          const feesA: bigint[] = [];
          for (let i = 0; i < 4; i++) {
            feesA.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n)));
          }
          const operatorsA = await registerFuzzOperators(ctx, opOwnerA, 4, feesA);
          const idsA = operatorsA.map(o => o.id);

          const feesB = generateRandomFees(ctx, 4, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n);
          const operatorsB = await registerFuzzOperators(ctx, opOwnerB, 4, feesB, 5000);
          const idsB = operatorsB.map(o => o.id);

          const valCountA = Number(ctx.rng.nextInRange(1n, 5n));
          const valCountB = Number(ctx.rng.nextInRange(1n, 5n));

          const networkFee = BigInt(await ctx.views.getNetworkFee());
          const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());

          const vUnitsA = BigInt(valCountA) * BPS_DENOMINATOR;
          const metricsA = computeLiquidationMetrics(operatorsA.map(o => o.fee), networkFee, vUnitsA, minBlocks);
          const extraBlocksA = ctx.rng.nextInRange(200n, 800n);
          const totalDepositA = metricsA.threshold + metricsA.burnPerBlock * extraBlocksA;

          const vUnitsB = BigInt(valCountB) * BPS_DENOMINATOR;
          const metricsB = computeLiquidationMetrics(operatorsB.map(o => o.fee), networkFee, vUnitsB, minBlocks);
          const extraBlocksB = ctx.rng.nextInRange(200n, 800n);
          const totalDepositB = metricsB.threshold + metricsB.burnPerBlock * extraBlocksB;

          const clusterA = await registerFuzzCluster(
            ctx, clusterOwnerA, opOwnerA, idsA,
            valCountA, totalDepositA / BigInt(valCountA) + 1n, 2000,
          );
          const clusterB = await registerFuzzCluster(
            ctx, clusterOwnerB, opOwnerB, idsB,
            valCountB, totalDepositB / BigInt(valCountB) + 1n, 3000,
          );

          return {
            operatorsA, operatorsB,
            clusterA, clusterB,
            phase: "wait-liquidatable" as Phase,
            valCountA, valCountB,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
