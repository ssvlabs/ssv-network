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
  computeEBRoot,
  commitEBRoot,
} from "../helpers/oracle.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

type Phase = "set-max-eb" | "verify-high-burn" | "verified";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  phase: Phase;
  clusterId: string;
  validatorCount: number;
  maxEB: number;
  balanceAfterEB?: bigint;
  blockAfterEB?: bigint;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { cluster, oracles, clusterId, validatorCount } = ctx.state;

  if (ctx.state.phase === "set-max-eb") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    const eb = ctx.state.maxEB;
    const root = computeEBRoot(clusterId, eb);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, eb, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = ebToVUnits(eb);
    expect(expectedVUnits).to.equal(BigInt(validatorCount) * 640000n);

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
    expect(contractEB).to.equal(BigInt(eb));

    ctx.state.balanceAfterEB = BigInt(
      await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    ctx.state.blockAfterEB = BigInt(await ctx.provider.getBlockNumber());

    ctx.state.phase = "verify-high-burn";
    return;
  }

  if (ctx.state.phase === "verify-high-burn") {
    const currentBalance = BigInt(
      await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );

    const opFees: bigint[] = [];
    for (const opId of cluster.operatorIds) {
      opFees.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
    }
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const vUnits = ebToVUnits(ctx.state.maxEB);
    const blocks = BigInt(await ctx.provider.getBlockNumber()) - ctx.state.blockAfterEB!;

    let packedTotal = networkFee / ETH_DEDUCTED_DIGITS;
    for (const fee of opFees) packedTotal += fee / ETH_DEDUCTED_DIGITS;

    const opIndexDelta = (packedTotal - networkFee / ETH_DEDUCTED_DIGITS) * blocks;
    const netIndexDelta = (networkFee / ETH_DEDUCTED_DIGITS) * blocks;
    const usageUnits = ((opIndexDelta + netIndexDelta) * vUnits) / BPS_DENOMINATOR;
    const expectedUsage = usageUnits * ETH_DEDUCTED_DIGITS;

    expect(currentBalance).to.equal(ctx.state.balanceAfterEB! - expectedUsage);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: Max EB (2048 ETH/validator) — massive vUnit deviation and high burn rate", function () {
  for (const seed of seeds) {
    it(`Validates max EB (2048 ETH) vUnit deviation and burn rate with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 8,
        blocksPerTick: { min: 10n, max: 50n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner, staker] = ctx.signers;

          const fees = generateRandomFees(ctx, 4, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees);
          const operatorIds = operators.map(o => o.id);

          const oracles = await setupFuzzOracles(ctx, staker);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 5n));
          const maxEB = validatorCount * 2048;
          const maxVUnits = ebToVUnits(maxEB);
          const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());
          const networkFee = BigInt(await ctx.views.getNetworkFee());

          const { threshold: maxThreshold } = computeLiquidationMetrics(operators.map(o => o.fee), networkFee, maxVUnits, minBlocks);
          const depositPerValidator = (maxThreshold * 20n) / BigInt(validatorCount) + DEFAULT_ETH_REGISTER_VALUE;

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds,
            validatorCount, depositPerValidator,
          );

          return {
            operators, cluster, oracles,
            lastCommittedBlock: 0n,
            phase: "set-max-eb" as Phase,
            clusterId: computeClusterId(clusterOwner.address, operatorIds),
            validatorCount,
            maxEB,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
