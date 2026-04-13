import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { setAccountBalance } from "../helpers/blocks.ts";
import { computeBurnRate, ebToVUnits, setupFuzzOracles, generateRandomFees, computeLiquidationMetrics, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  computeClusterId,
  computeEBRoot,
  commitEBRoot,
} from "../helpers/oracle.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  BPS_DENOMINATOR,
  STAKE_AMOUNT,
} from "../common/constants.ts";

type Phase = "pre-liquidation" | "liquidated" | "reactivated" | "survived";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  phase: Phase;
  highEB: number;
  postEB: number;
  reactivateDeposit: bigint;
  clusterId: string;
}

async function getOperatorFees(ctx: FuzzContext<State>): Promise<bigint[]> {
  const fees: bigint[] = [];
  for (const opId of ctx.state.cluster.operatorIds) {
    fees.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
  }
  return fees;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { cluster, oracles, clusterId } = ctx.state;

  if (ctx.state.phase === "pre-liquidation") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    expect(await ctx.views.isLiquidatable(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(false);

    await commitEBRoot(ctx.network, computeEBRoot(clusterId, ctx.state.highEB), Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, ctx.state.highEB, [],
    );
    const receipt = await tx.wait();
    const gasUsed = BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice);

    let hasBalanceUpdated = false;
    let hasLiquidated = false;
    for (const log of receipt.logs ?? []) {
      try {
        const parsed = ctx.network.interface.parseLog(log);
        if (parsed?.name === Events.CLUSTER_BALANCE_UPDATED) hasBalanceUpdated = true;
        if (parsed?.name === Events.CLUSTER_LIQUIDATED) hasLiquidated = true;
      } catch {}
    }
    expect(hasBalanceUpdated).to.equal(true);
    expect(hasLiquidated).to.equal(true);

    cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_LIQUIDATED);
    expect(cluster.cluster.active).to.equal(false);
    expect(BigInt(cluster.cluster.balance)).to.equal(0n);

    for (const op of ctx.state.operators) {
      const opData = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opData.validatorCount)).to.equal(0n);
    }

    ctx.state.phase = "liquidated";
    return;
  }

  if (ctx.state.phase === "liquidated") {
    await setAccountBalance(ctx.provider, cluster.owner.address, ctx.state.reactivateDeposit + 10n ** 18n);
    const tx = await ctx.network.connect(cluster.owner)
      .reactivate(cluster.operatorIds, cluster.cluster, { value: ctx.state.reactivateDeposit });
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_REACTIVATED);

    const opFees = await getOperatorFees(ctx);
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    expect(BigInt(await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster)))
      .to.equal(computeBurnRate(opFees, networkFee, ebToVUnits(ctx.state.highEB)));
    expect(await ctx.views.isLiquidatable(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(false);

    const expectedValCount = BigInt(cluster.cluster.validatorCount);
    for (const op of ctx.state.operators) {
      const opData = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opData.validatorCount)).to.equal(expectedValCount);
    }

    ctx.state.phase = "reactivated";
    return;
  }

  if (ctx.state.phase === "reactivated") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    await commitEBRoot(ctx.network, computeEBRoot(clusterId, ctx.state.postEB), Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, ctx.state.postEB, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const opFees = await getOperatorFees(ctx);
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    expect(BigInt(await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster)))
      .to.equal(computeBurnRate(opFees, networkFee, ebToVUnits(ctx.state.postEB)));
    expect(await ctx.views.isLiquidatable(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(false);

    ctx.state.phase = "survived";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: EB auto-liquidation → reactivation → survival", function () {
  for (const seed of seeds) {
    it(`Validates EB auto-liquidation → reactivation → post-liq EB update survival with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 10,
        blocksPerTick: { min: 10n, max: 100n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner, staker] = ctx.signers;

          const fees = generateRandomFees(ctx, 4, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees);
          const operatorIds = operators.map(o => o.id);

          const oracles = await setupFuzzOracles(ctx, staker);

          const validatorCount = 2;
          const highEBPerVal = Number(ctx.rng.nextInRange(96n, 512n));
          const highEB = highEBPerVal * validatorCount;
          const postEB = Number(ctx.rng.nextInRange(32n, BigInt(highEBPerVal))) * validatorCount;

          const vUnitsImplicit = BigInt(validatorCount) * BPS_DENOMINATOR;
          const vUnitsHigh = ebToVUnits(highEB);
          const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());
          const networkFee = BigInt(await ctx.views.getNetworkFee());

          const opFees = operators.map(o => o.fee);
          const { threshold: implicitThreshold } = computeLiquidationMetrics(opFees, networkFee, vUnitsImplicit, minBlocks);
          const { threshold: highThreshold } = computeLiquidationMetrics(opFees, networkFee, vUnitsHigh, minBlocks);

          const fundingMin = implicitThreshold * 15n / 10n;
          const fundingMax = highThreshold * 8n / 10n;
          const totalFunding = ctx.rng.nextInRange(fundingMin, fundingMax > fundingMin ? fundingMax : fundingMin * 2n);

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds,
            validatorCount, totalFunding / BigInt(validatorCount),
          );

          return {
            operators, cluster, oracles,
            lastCommittedBlock: 0n,
            phase: "pre-liquidation" as Phase,
            highEB, postEB,
            reactivateDeposit: highThreshold * ctx.rng.nextInRange(5n, 10n),
            clusterId: computeClusterId(clusterOwner.address, operatorIds),
          };
        },

        steps: [lifecycle],
        expectedPhase: "survived",
      }, seed);
    });
  }
});
