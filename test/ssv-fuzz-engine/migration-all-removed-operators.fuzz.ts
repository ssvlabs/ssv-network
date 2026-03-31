import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import type { ClusterRecord, FuzzContext, OperatorRecord, StepFn } from "./core/types.ts";
import {
  assertClusterBalance,
  assertMigratedAllRemovedClusterState,
  assertNetworkEarnings,
  assertNetworkValidatorCount,
  assertPostMigrationAllRemovedClusterState,
  assertPreMigrationAllRemovedLegacyClusterState,
  assertRemovedOperatorsEarningsFrozen,
} from "./core/assertions.ts";
import {
  computeBurnRate,
} from "./core/fuzz-helpers.ts";
import {
  extractEventArgs,
  makePublicKey,
  mineBlocks,
  parseClusterFromEvent,
  setAccountBalance,
  setupLegacyClusterAndUpgradeWithOptions,
} from "../helpers/index.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";
import { Events } from "../common/events.ts";

type Phase = "post-upgrade-legacy-all-removed" | "migrated" | "post-migration-complete";

interface State {
  operators: OperatorRecord[];
  removedOperators: OperatorRecord[];
  cluster: ClusterRecord;
  ssvToken: any;
  phase: Phase;
  migrationEthDeposit: bigint;
  postMigrationBlocks: bigint;
  lastRemovedOperatorsEarnings?: Map<number, bigint>;
  lastClusterBalance?: any;
  lastNetworkEarnings?: any;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

function assertPreMigrationAllRemovedLegacyState<S extends State>(): StepFn<S> {
  return async function assertPreMigrationAllRemovedLegacyState(ctx: FuzzContext<S>): Promise<void> {
    if (ctx.state.phase !== "post-upgrade-legacy-all-removed") return;
    await assertPreMigrationAllRemovedLegacyClusterState(ctx);
  };
}

function migrateAllRemovedLegacyCluster<S extends State>(): StepFn<S> {
  return async function migrateAllRemovedLegacyCluster(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, ssvToken, phase, migrationEthDeposit } = ctx.state;
    if (phase !== "post-upgrade-legacy-all-removed") return;

    const ownerSSVBefore = await ssvToken.balanceOf(cluster.owner.address);
    const ssvBalanceBefore = await ctx.views.getBalanceSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster);
    const burnRateSSV = await ctx.views.getBurnRateSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster);

    await setAccountBalance(ctx.provider, cluster.owner.address, migrationEthDeposit + 10n ** 18n);

    const migrateTx = await ctx.network
      .connect(cluster.owner)
      .migrateClusterToETH(cluster.operatorIds, cluster.cluster, { value: migrationEthDeposit });
    const migrateReceipt = await migrateTx.wait();
    await expect(migrateTx).to.emit(ctx.network, Events.CLUSTER_MIGRATED_TO_ETH);

    const migratedCluster = parseClusterFromEvent(ctx.network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const migrateEventArgs = extractEventArgs(ctx.network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const ownerSSVAfter = await ssvToken.balanceOf(cluster.owner.address);
    const expectedRefund = ssvBalanceBefore - burnRateSSV;

    expect(ownerSSVAfter - ownerSSVBefore).to.equal(expectedRefund);
    expect(BigInt(migrateEventArgs.ssvRefunded)).to.equal(expectedRefund);
    expect(BigInt(migrateEventArgs.ethDeposited)).to.equal(migrationEthDeposit);

    cluster.cluster = migratedCluster;
    ctx.state.phase = "migrated";
  };
}

function assertMigratedAllRemovedState<S extends State>(): StepFn<S> {
  return async function assertMigratedAllRemovedState(ctx: FuzzContext<S>): Promise<void> {
    if (ctx.state.phase === "post-upgrade-legacy-all-removed") return;

    if (ctx.state.phase === "migrated") {
      await assertMigratedAllRemovedClusterState(ctx);
    } else {
      await assertPostMigrationAllRemovedClusterState(ctx);
    }
    await assertRemovedOperatorsEarningsFrozen(ctx);
    await assertClusterBalance(ctx);
    await assertNetworkEarnings(ctx);
    await assertNetworkValidatorCount(ctx);

    const expectedBurnRate = computeBurnRate([], BigInt(await ctx.views.getNetworkFee()), BigInt(ctx.state.cluster.cluster.validatorCount));
    expect(
      await ctx.views.getBurnRate(
        ctx.state.cluster.owner.address,
        ctx.state.cluster.operatorIds,
        ctx.state.cluster.cluster,
      ),
    ).to.equal(expectedBurnRate);
  };
}

function advancePostMigrationWindow<S extends State>(): StepFn<S> {
  return async function advancePostMigrationWindow(ctx: FuzzContext<S>): Promise<void> {
    if (ctx.state.phase !== "migrated") return;
    await mineBlocks(ctx.provider, Number(ctx.state.postMigrationBlocks));
    ctx.state.phase = "post-migration-complete";
  };
}

describe("Fuzz: CAT-1-4 all-operators-removed legacy migration lifecycle", function () {
  for (const seed of seeds) {
    it(`Validates all-removed legacy migration burns only network fee with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const {
            newNetwork,
            newViews,
            ssvToken,
            operatorIds,
            cluster,
            removedOperatorIds,
          } = await setupLegacyClusterAndUpgradeWithOptions(ctx.connection, operatorOwner, clusterOwner, {
            preUpgradeBlocks: 50n,
            removedOperatorIndices: [0, 1, 2, 3],
          });

          ctx.network = newNetwork;
          ctx.views = newViews;
          ctx.ssvToken = ssvToken;

          return {
            operators: [],
            removedOperators: removedOperatorIds.map((id) => ({
              id,
              fee: 0n,
              owner: operatorOwner,
            })),
            cluster: {
              cluster,
              operatorIds,
              owner: clusterOwner,
              validatorKeys: [makePublicKey(123)],
            },
            ssvToken,
            phase: "post-upgrade-legacy-all-removed" as const,
            migrationEthDeposit: ctx.rng.nextInRange(
              MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
              MINIMUM_LIQUIDATION_PERIOD_COLLATERAL + DEFAULT_ETH_REGISTER_VALUE,
            ),
            postMigrationBlocks: ctx.rng.nextInRange(1n, 1500n),
          };
        },

        steps: [
          assertPreMigrationAllRemovedLegacyState(),
          migrateAllRemovedLegacyCluster(),
          assertMigratedAllRemovedState(),
          advancePostMigrationWindow(),
          assertMigratedAllRemovedState(),
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
