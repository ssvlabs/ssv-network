import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { computeBurnRate, ebToVUnits, setupFuzzOracles, generateRandomFees, computeLiquidationMetrics, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import { assertDaoVUnitsMatchCluster } from "./core/assertions.ts";
import {
  computeClusterId,
  computeEBRoot,
  commitEBRoot,
} from "../helpers/oracle.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

type Phase =
  | "below-minimum"
  | "above-maximum"
  | "exact-minimum"
  | "exact-maximum"
  | "verified";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  phase: Phase;
  clusterId: string;
  validatorCount: number;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { cluster, oracles, clusterId, validatorCount } = ctx.state;
  const minEB = validatorCount * 32;
  const maxEB = validatorCount * 2048;

  if (ctx.state.phase === "below-minimum") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const belowEB = minEB - 1;
    const root = computeEBRoot(clusterId, belowEB);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    await expect(
      ctx.network.updateClusterBalance(
        blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, belowEB, [],
      ),
    ).to.be.revertedWithCustomError(ctx.network, Errors.EB_BELOW_MINIMUM);

    ctx.state.phase = "above-maximum";
    return;
  }

  if (ctx.state.phase === "above-maximum") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const aboveEB = maxEB + 1;
    const root = computeEBRoot(clusterId, aboveEB);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    await expect(
      ctx.network.updateClusterBalance(
        blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, aboveEB, [],
      ),
    ).to.be.revertedWithCustomError(ctx.network, Errors.EB_EXCEEDS_MAXIMUM);

    ctx.state.phase = "exact-minimum";
    return;
  }

  if (ctx.state.phase === "exact-minimum") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const root = computeEBRoot(clusterId, minEB);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, minEB, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = ebToVUnits(minEB);
    expect(expectedVUnits).to.equal(BigInt(validatorCount) * BPS_DENOMINATOR);

    const contractEB = BigInt(
      await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(contractEB).to.equal(BigInt(minEB));

    await assertDaoVUnitsMatchCluster(ctx);

    ctx.state.phase = "exact-maximum";
    return;
  }

  if (ctx.state.phase === "exact-maximum") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const root = computeEBRoot(clusterId, maxEB);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, maxEB, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = ebToVUnits(maxEB);
    const opFees: bigint[] = [];
    for (const opId of cluster.operatorIds) {
      opFees.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
    }
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const expectedBurnRate = computeBurnRate(opFees, networkFee, expectedVUnits);
    const contractBurnRate = BigInt(
      await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(contractBurnRate).to.equal(expectedBurnRate);

    const contractEB = BigInt(
      await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(contractEB).to.equal(BigInt(maxEB));

    await assertDaoVUnitsMatchCluster(ctx);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: EB boundary validation — below min, above max, exact boundaries", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 12,
        blocksPerTick: { min: 5n, max: 50n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner, staker] = ctx.signers;

          const fees = generateRandomFees(ctx, 4, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees);
          const operatorIds = operators.map(o => o.id);

          const oracles = await setupFuzzOracles(ctx, staker);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 10n));
          const maxEB = validatorCount * 2048;
          const maxVUnits = ebToVUnits(maxEB);
          const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());
          const networkFee = BigInt(await ctx.views.getNetworkFee());

          const { threshold: maxThreshold } = computeLiquidationMetrics(operators.map(o => o.fee), networkFee, maxVUnits, minBlocks);
          const depositPerValidator = (maxThreshold * 10n) / BigInt(validatorCount) + DEFAULT_ETH_REGISTER_VALUE;

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds,
            validatorCount, depositPerValidator,
          );

          return {
            operators, cluster, oracles,
            lastCommittedBlock: 0n,
            phase: "below-minimum" as Phase,
            clusterId: computeClusterId(clusterOwner.address, operatorIds),
            validatorCount,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
