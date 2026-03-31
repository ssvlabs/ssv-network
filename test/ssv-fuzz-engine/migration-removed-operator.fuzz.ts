import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import type { ClusterRecord, FuzzContext, OperatorRecord, StepFn } from "./core/types.ts";
import {
  assertClusterBalanceWithDeltas,
  assertMigratedRemovedOperatorClusterState,
  assertNetworkEarnings,
  assertNetworkValidatorCount,
  assertOperatorEarnings,
  assertOperatorValidatorCounts,
  assertPreMigrationRemovedOperatorLegacyClusterState,
  assertRemovedOperatorRegistrationBlockedAfterMigration,
  assertRemovedOperatorEarningsFrozen,
} from "./core/assertions.ts";
import {
  calcClusterBurn,
  calcLiquidationThreshold,
  defaultVUnits,
  extractEventArgs,
  makePublicKey,
  mineBlocks,
  parseClusterFromEvent,
  setAccountBalance,
  setupLegacyClusterAndUpgradeWithOptions,
} from "../helpers/index.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";
import { Events } from "../common/events.ts";

type Phase = "post-upgrade-legacy-removed-op" | "migrated" | "post-migration-complete";

interface State {
  operators: OperatorRecord[];
  removedOperator: OperatorRecord;
  cluster: ClusterRecord;
  ssvToken: any;
  phase: Phase;
  migrationEthDeposit: bigint;
  tracker: {
    totalDeposited: bigint;
    totalWithdrawn: bigint;
  };
  checkedRegistrationBlocked?: boolean;
  lastRemovedOperatorEarnings?: bigint;
  lastOperatorEarnings?: any;
  lastClusterBalanceWithDeltas?: any;
  lastNetworkEarnings?: any;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

function assertPreMigrationRemovedOperatorLegacyState<S extends State>(): StepFn<S> {
  return async function assertPreMigrationRemovedOperatorLegacyState(ctx: FuzzContext<S>): Promise<void> {
    if (ctx.state.phase !== "post-upgrade-legacy-removed-op") return;
    await assertPreMigrationRemovedOperatorLegacyClusterState(ctx);
  };
}

function migrateRemovedOperatorLegacyCluster<S extends State>(): StepFn<S> {
  return async function migrateRemovedOperatorLegacyCluster(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, ssvToken, phase, migrationEthDeposit } = ctx.state;
    if (phase !== "post-upgrade-legacy-removed-op") return;

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

function assertMigratedRemovedOperatorState<S extends State>(): StepFn<S> {
  return async function assertMigratedRemovedOperatorState(ctx: FuzzContext<S>): Promise<void> {
    if (ctx.state.phase === "post-upgrade-legacy-removed-op") return;
    await assertMigratedRemovedOperatorClusterState(ctx);
  };
}

function accrueAndWithdrawPostMigration<S extends State>(): StepFn<S> {
  return async function accrueAndWithdrawPostMigration(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, operators, phase, tracker } = ctx.state;
    if (phase !== "migrated" || ctx.tick === 0) return;

    const postMigrationBlocks = 200n;
    await mineBlocks(ctx.provider, Number(postMigrationBlocks));

    const liveBalance = await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster);
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: BigInt(await ctx.views.getLiquidationThresholdPeriod()),
      numOperators: BigInt(operators.length),
      ethFee: DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS,
      networkFee: networkFee / ETH_DEDUCTED_DIGITS,
      effectiveVUnits: BigInt(cluster.cluster.validatorCount) * 10_000n,
    });

    const withdrawAmount = (liveBalance - threshold) / 2n;
    if (withdrawAmount <= 0n) {
      throw new Error(`Expected positive withdraw amount, got ${withdrawAmount}`);
    }

    const withdrawTx = await ctx.network.connect(cluster.owner).withdraw(
      cluster.operatorIds,
      withdrawAmount,
      cluster.cluster,
    );
    const withdrawReceipt = await withdrawTx.wait();
    cluster.cluster = parseClusterFromEvent(ctx.network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);
    tracker.totalWithdrawn += withdrawAmount;
    ctx.state.phase = "post-migration-complete";
  };
}

function assertPostMigrationRemovedOperatorState<S extends State>(): StepFn<S> {
  return async function assertPostMigrationRemovedOperatorState(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, phase } = ctx.state;
    if (phase === "post-upgrade-legacy-removed-op") return;

    await assertMigratedRemovedOperatorClusterState(ctx);

    await assertRemovedOperatorEarningsFrozen(ctx);
    await assertOperatorValidatorCounts(ctx);
    await assertNetworkValidatorCount(ctx);
    await assertOperatorEarnings(ctx);
    await assertClusterBalanceWithDeltas(ctx);
    await assertNetworkEarnings(ctx);

    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const expectedBurnRate = calcClusterBurn({
      blockDiff: 1n,
      numOperators: BigInt(ctx.state.operators.length),
      ethFee: DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS,
      networkFee: networkFee / ETH_DEDUCTED_DIGITS,
      effectiveVUnits: defaultVUnits(BigInt(cluster.cluster.validatorCount)),
    });
    expect(await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(expectedBurnRate);
  };
}

describe("Fuzz: CAT-1-3 removed-operator legacy migration lifecycle", function () {
  for (const seed of seeds) {
    it(`Validates removed-operator legacy migration skip semantics with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 2,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;
          const removedIndex = Number(ctx.rng.nextInRange(0n, 3n));

          const {
            newNetwork,
            newViews,
            ssvToken,
            operatorIds,
            cluster,
            removedOperatorIds,
          } = await setupLegacyClusterAndUpgradeWithOptions(ctx.connection, operatorOwner, clusterOwner, {
            preUpgradeBlocks: 50n,
            removedOperatorIndices: [removedIndex],
          });

          ctx.network = newNetwork;
          ctx.views = newViews;
          ctx.ssvToken = ssvToken;

          const removedOperatorId = removedOperatorIds[0];
          const activeOperatorIds = operatorIds.filter((id) => id !== removedOperatorId);
          const migrationThreshold = calcLiquidationThreshold({
            minimumBlocksBeforeLiquidation: BigInt(await ctx.views.getLiquidationThresholdPeriod()),
            numOperators: BigInt(activeOperatorIds.length),
            ethFee: DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS,
            networkFee: BigInt(await ctx.views.getNetworkFee()) / ETH_DEDUCTED_DIGITS,
            effectiveVUnits: defaultVUnits(1n),
          });
          const migrationEthDeposit = migrationThreshold + ctx.rng.nextInRange(0n, DEFAULT_ETH_REGISTER_VALUE);

          return {
            operators: activeOperatorIds.map((id) => ({
              id,
              fee: DEFAULT_OPERATOR_ETH_FEE,
              owner: operatorOwner,
            })),
            removedOperator: {
              id: removedOperatorId,
              fee: 0n,
              owner: operatorOwner,
            },
            cluster: {
              cluster,
              operatorIds,
              owner: clusterOwner,
              validatorKeys: [makePublicKey(123)],
            },
            ssvToken,
            phase: "post-upgrade-legacy-removed-op" as const,
            migrationEthDeposit,
            tracker: {
              totalDeposited: 0n,
              totalWithdrawn: 0n,
            },
          };
        },

        steps: [
          assertPreMigrationRemovedOperatorLegacyState(),
          migrateRemovedOperatorLegacyCluster(),
          assertMigratedRemovedOperatorState(),
          assertRemovedOperatorRegistrationBlockedAfterMigration,
          accrueAndWithdrawPostMigration(),
          assertPostMigrationRemovedOperatorState(),
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
