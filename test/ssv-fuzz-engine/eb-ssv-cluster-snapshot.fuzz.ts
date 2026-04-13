import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { computeBurnRate, ebToVUnits, setupFuzzOracles, generateRandomFees, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  computeClusterId,
  computeEBRoot,
  commitEBRoot,
} from "../helpers/oracle.ts";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  STAKE_AMOUNT,
} from "../common/constants.ts";
import type { LegacyMigrationSnapshot, DepositWithdrawTracker } from "./core/steps.ts";
import { migrateLegacyCluster } from "./core/steps.ts";

type Phase =
  | "eb-update-ssv"
  | "verify-no-accounting-change"
  | "migrate"
  | "verify-deviation-applied"
  | "verified";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  phase: Phase;
  clusterId: string;
  validatorCount: number;
  eb: number;
  ssvBalanceBefore: bigint;
  ssvBurnRateBefore: bigint;
  migrationSnapshot?: LegacyMigrationSnapshot;
  tracker: DepositWithdrawTracker;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { cluster, oracles, clusterId, validatorCount } = ctx.state;

  if (ctx.state.phase === "eb-update-ssv") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    ctx.state.ssvBalanceBefore = BigInt(
      await ctx.views.getBalanceSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    ctx.state.ssvBurnRateBefore = BigInt(
      await ctx.views.getBurnRateSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );

    const root = computeEBRoot(clusterId, ctx.state.eb);
    await commitEBRoot(ctx.network, root, Number(blockNum), oracles);
    ctx.state.lastCommittedBlock = blockNum;

    const tx = await ctx.network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, ctx.state.eb, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    ctx.state.phase = "verify-no-accounting-change";
    return;
  }

  if (ctx.state.phase === "verify-no-accounting-change") {
    const ssvBurnRateAfter = BigInt(
      await ctx.views.getBurnRateSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(ssvBurnRateAfter).to.equal(ctx.state.ssvBurnRateBefore);

    for (const op of ctx.state.operators) {
      const opData = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opData.validatorCount)).to.equal(0n);
    }

    ctx.state.phase = "migrate";
    return;
  }

  if (ctx.state.phase === "migrate") {
    const migrateStep = migrateLegacyCluster<State>(DEFAULT_ETH_REGISTER_VALUE, DEFAULT_ETH_REGISTER_VALUE * 5n);
    await migrateStep(ctx);

    ctx.state.phase = "verify-deviation-applied";
    return;
  }

  if (ctx.state.phase === "verify-deviation-applied") {
    const baseline = BigInt(validatorCount) * BPS_DENOMINATOR;
    const expectedVUnits = ebToVUnits(ctx.state.eb);
    const expectedDeviation = expectedVUnits > baseline ? expectedVUnits - baseline : 0n;

    const opFees: bigint[] = [];
    for (const op of ctx.state.operators) {
      const opData = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opData.validatorCount)).to.equal(BigInt(validatorCount));
      opFees.push(BigInt(opData.fee));
    }

    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const expectedBurnRate = computeBurnRate(opFees, networkFee, expectedVUnits);
    const contractBurnRate = BigInt(
      await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(contractBurnRate).to.equal(expectedBurnRate);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: EB update on SSV cluster — snapshot stored, no accounting until migration", function () {
  for (const seed of seeds) {
    it(`Validates EB snapshot stored on SSV cluster without accounting impact until migration with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 12,
        blocksPerTick: { min: 5n, max: 50n },

        async setup(ctx) {
          const [, , , staker] = ctx.signers;

          const ssvFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 3n),
          );
          const validatorCount = Number(ctx.rng.nextInRange(1n, 5n));

          const seed = await setupLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee,
            validatorCount,
            ssvDepositPerValidator: ctx.rng.nextInRange(TOKEN_REGISTER_AMOUNT, TOKEN_REGISTER_AMOUNT * 3n),
            preUpgradeBlocks: Number(ctx.rng.nextInRange(10n, 50n)),
          });

          const oracles = await setupFuzzOracles(ctx, staker);

          const ebPerVal = Number(ctx.rng.nextInRange(32n, 2048n));
          const eb = ebPerVal * validatorCount;

          const cluster: ClusterRecord = {
            cluster: seed.preUpgradeCluster,
            operatorIds: seed.operatorIds,
            owner: seed.clusterOwner,
            validatorKeys: [...seed.validatorKeys],
          };

          return {
            operators: seed.operators,
            cluster,
            oracles,
            lastCommittedBlock: 0n,
            phase: "eb-update-ssv" as Phase,
            clusterId: computeClusterId(seed.clusterOwner.address, seed.operatorIds),
            validatorCount,
            eb,
            ssvBalanceBefore: 0n,
            ssvBurnRateBefore: 0n,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
