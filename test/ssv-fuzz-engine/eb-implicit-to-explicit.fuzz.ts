import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
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
  | "implicit"
  | "explicit-no-deviation"
  | "explicit-with-deviation"
  | "verified";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  phase: Phase;
  clusterId: string;
  validatorCount: number;
  noDeviationEB: number;
  highEB: number;
}

async function getOperatorFees(ctx: FuzzContext<State>): Promise<bigint[]> {
  const fees: bigint[] = [];
  for (const opId of ctx.state.cluster.operatorIds) {
    fees.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
  }
  return fees;
}

async function assertBurnRateMatchesVUnits(
  ctx: FuzzContext<State>,
  expectedVUnits: bigint,
): Promise<void> {
  const { cluster } = ctx.state;
  const opFees = await getOperatorFees(ctx);
  const networkFee = BigInt(await ctx.views.getNetworkFee());
  const expectedBurnRate = computeBurnRate(opFees, networkFee, expectedVUnits);
  const contractBurnRate = BigInt(
    await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
  );
  expect(contractBurnRate).to.equal(expectedBurnRate);
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { cluster, oracles, clusterId, validatorCount } = ctx.state;

  if (ctx.state.phase === "implicit") {
    const implicitVUnits = BigInt(validatorCount) * BPS_DENOMINATOR;
    await assertBurnRateMatchesVUnits(ctx, implicitVUnits);

    const eb = BigInt(
      await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(eb).to.equal(BigInt(validatorCount) * 32n);

    await assertDaoVUnitsMatchCluster(ctx);

    ctx.state.phase = "explicit-no-deviation";
    return;
  }

  if (ctx.state.phase === "explicit-no-deviation") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const eb = ctx.state.noDeviationEB;
    const root = computeEBRoot(clusterId, eb);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, eb, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = ebToVUnits(eb);
    expect(expectedVUnits).to.equal(BigInt(validatorCount) * BPS_DENOMINATOR);

    await assertBurnRateMatchesVUnits(ctx, expectedVUnits);

    const contractEB = BigInt(
      await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(contractEB).to.equal(BigInt(eb));

    await assertDaoVUnitsMatchCluster(ctx);

    ctx.state.phase = "explicit-with-deviation";
    return;
  }

  if (ctx.state.phase === "explicit-with-deviation") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const eb = ctx.state.highEB;
    const root = computeEBRoot(clusterId, eb);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, eb, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const newVUnits = ebToVUnits(eb);
    await assertBurnRateMatchesVUnits(ctx, newVUnits);

    const contractEB = BigInt(
      await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(contractEB).to.equal(BigInt(eb));

    expect(await ctx.views.isLiquidatable(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(false);

    await assertDaoVUnitsMatchCluster(ctx);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: Implicit EB → explicit EB (no deviation) → explicit EB (positive deviation)", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 10,
        blocksPerTick: { min: 10n, max: 200n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner, staker] = ctx.signers;

          const fees = generateRandomFees(ctx, 4);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees);
          const operatorIds = operators.map(o => o.id);

          const oracles = await setupFuzzOracles(ctx, staker);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 10n));
          const noDeviationEB = validatorCount * 32;

          const highEBPerVal = Number(ctx.rng.nextInRange(33n, 2048n));
          const highEB = highEBPerVal * validatorCount;

          const highVUnits = ebToVUnits(highEB);
          const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());
          const networkFee = BigInt(await ctx.views.getNetworkFee());

          const { threshold: highThreshold } = computeLiquidationMetrics(operators.map(o => o.fee), networkFee, highVUnits, minBlocks);
          const depositPerValidator = (highThreshold * 10n) / BigInt(validatorCount) + DEFAULT_ETH_REGISTER_VALUE;

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds,
            validatorCount, depositPerValidator,
          );

          return {
            operators, cluster, oracles,
            lastCommittedBlock: 0n,
            phase: "implicit" as Phase,
            clusterId: computeClusterId(clusterOwner.address, operatorIds),
            validatorCount,
            noDeviationEB,
            highEB,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
