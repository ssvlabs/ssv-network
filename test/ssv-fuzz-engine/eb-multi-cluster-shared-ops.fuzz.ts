import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { computeBurnRate, ebToVUnits, setupFuzzOracles, generateRandomFees, computeLiquidationMetrics, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  computeClusterId,
  generateMerkleForClusterEB,
  commitEBRoot,
} from "../helpers/oracle.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

type Phase =
  | "update-a-high-eb"
  | "update-b-no-deviation"
  | "verify-burn-rates"
  | "liquidate-a"
  | "verify-post-liquidation"
  | "verified";

interface State {
  operators: OperatorRecord[];
  clusterA: ClusterRecord;
  clusterB: ClusterRecord;
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  phase: Phase;
  clusterIdA: string;
  clusterIdB: string;
  valCountA: number;
  valCountB: number;
  highEBA: number;
  noDevEB_B: number;
  proofs: Record<string, string[]>;
  burnRateAAfterEB?: bigint;
  burnRateBAfterEB?: bigint;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { clusterA, clusterB, oracles, clusterIdA, clusterIdB } = ctx.state;

  if (ctx.state.phase === "update-a-high-eb") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const entries = [
      { clusterId: clusterIdA, effectiveBalance: ctx.state.highEBA },
      { clusterId: clusterIdB, effectiveBalance: ctx.state.noDevEB_B },
    ];
    const { root, proofs } = generateMerkleForClusterEB(ctx.connection, entries);

    ctx.state.proofs = proofs;
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const txA = await ctx.network.updateClusterBalance(
      blockNum, clusterA.owner.address, clusterA.operatorIds, clusterA.cluster,
      ctx.state.highEBA, proofs[clusterIdA],
    );
    clusterA.cluster = parseClusterFromEvent(ctx.network, await txA.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const vUnitsA = ebToVUnits(ctx.state.highEBA);
    const opFeesA: bigint[] = [];
    for (const opId of clusterA.operatorIds) {
      opFeesA.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
    }
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const expectedBurnRateA = computeBurnRate(opFeesA, networkFee, vUnitsA);
    const contractBurnRateA = BigInt(
      await ctx.views.getBurnRate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
    );
    expect(contractBurnRateA).to.equal(expectedBurnRateA);

    ctx.state.phase = "update-b-no-deviation";
    return;
  }

  if (ctx.state.phase === "update-b-no-deviation") {
    const blockNum = ctx.state.lastCommittedBlock;

    const txB = await ctx.network.updateClusterBalance(
      blockNum, clusterB.owner.address, clusterB.operatorIds, clusterB.cluster,
      ctx.state.noDevEB_B, ctx.state.proofs[clusterIdB],
    );
    clusterB.cluster = parseClusterFromEvent(ctx.network, await txB.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const vUnitsB = ebToVUnits(ctx.state.noDevEB_B);
    expect(vUnitsB).to.equal(BigInt(ctx.state.valCountB) * BPS_DENOMINATOR);

    const opFeesB: bigint[] = [];
    for (const opId of clusterB.operatorIds) {
      opFeesB.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
    }
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const expectedBurnRateB = computeBurnRate(opFeesB, networkFee, vUnitsB);
    const contractBurnRateB = BigInt(
      await ctx.views.getBurnRate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
    );
    expect(contractBurnRateB).to.equal(expectedBurnRateB);

    ctx.state.burnRateAAfterEB = BigInt(
      await ctx.views.getBurnRate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
    );
    ctx.state.burnRateBAfterEB = contractBurnRateB;

    ctx.state.phase = "verify-burn-rates";
    return;
  }

  if (ctx.state.phase === "verify-burn-rates") {
    const burnRateA = BigInt(
      await ctx.views.getBurnRate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
    );
    expect(burnRateA).to.equal(ctx.state.burnRateAAfterEB!);

    const burnRateB = BigInt(
      await ctx.views.getBurnRate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
    );
    expect(burnRateB).to.equal(ctx.state.burnRateBAfterEB!);

    const liquidatable = await ctx.views.isLiquidatable(
      clusterA.owner.address, clusterA.operatorIds, clusterA.cluster,
    );
    if (!liquidatable) return;

    ctx.state.phase = "liquidate-a";
    return;
  }

  if (ctx.state.phase === "liquidate-a") {
    const [liquidator] = ctx.signers;
    const tx = await ctx.network
      .connect(liquidator)
      .liquidate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster);
    clusterA.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_LIQUIDATED);

    expect(clusterA.cluster.active).to.equal(false);

    ctx.state.phase = "verify-post-liquidation";
    return;
  }

  if (ctx.state.phase === "verify-post-liquidation") {
    const burnRateB = BigInt(
      await ctx.views.getBurnRate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
    );
    expect(burnRateB).to.equal(ctx.state.burnRateBAfterEB!);

    expect(
      await ctx.views.isLiquidatable(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
    ).to.equal(false);

    for (const opId of clusterA.operatorIds) {
      const opData = await ctx.views.getOperatorById(opId);
      const isShared = clusterB.operatorIds.includes(opId);
      if (isShared) {
        expect(BigInt(opData.validatorCount)).to.equal(BigInt(ctx.state.valCountB));
      } else {
        expect(BigInt(opData.validatorCount)).to.equal(0n);
      }
    }

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: Multiple clusters with different EBs sharing operators", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 30,
        blocksPerTick: { min: 50n, max: 500n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwnerA, staker, clusterOwnerB] = ctx.signers;

          const fees = generateRandomFees(ctx, 5, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 5, fees);

          const idsA = [operators[0].id, operators[1].id, operators[2].id, operators[3].id];
          const idsB = [operators[0].id, operators[1].id, operators[2].id, operators[4].id];

          const oracles = await setupFuzzOracles(ctx, staker);

          const valCountA = Number(ctx.rng.nextInRange(1n, 5n));
          const valCountB = Number(ctx.rng.nextInRange(1n, 5n));

          const highEBPerValA = Number(ctx.rng.nextInRange(64n, 512n));
          const highEBA = highEBPerValA * valCountA;
          const noDevEB_B = valCountB * 32;

          const highVUnitsA = ebToVUnits(highEBA);
          const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());
          const networkFee = BigInt(await ctx.views.getNetworkFee());

          const feesA = idsA.map(id => operators.find(o => o.id === id)!.fee);
          const metricsA = computeLiquidationMetrics(feesA, networkFee, highVUnitsA, minBlocks);
          const extraBlocksA = ctx.rng.nextInRange(200n, 800n);
          const totalDepositA = metricsA.threshold + metricsA.burnPerBlock * extraBlocksA;
          const depositPerValA = totalDepositA / BigInt(valCountA) + 1n;

          const clusterA = await registerFuzzCluster(
            ctx, clusterOwnerA, operatorOwner, idsA, valCountA, depositPerValA, 2000,
          );

          const clusterB = await registerFuzzCluster(
            ctx, clusterOwnerB, operatorOwner, idsB, valCountB, DEFAULT_ETH_REGISTER_VALUE, 3000,
          );

          return {
            operators,
            clusterA, clusterB,
            oracles,
            lastCommittedBlock: 0n,
            phase: "update-a-high-eb" as Phase,
            clusterIdA: computeClusterId(clusterOwnerA.address, idsA),
            clusterIdB: computeClusterId(clusterOwnerB.address, idsB),
            valCountA, valCountB,
            highEBA,
            noDevEB_B,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
