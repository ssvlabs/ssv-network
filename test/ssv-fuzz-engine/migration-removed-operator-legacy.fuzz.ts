import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupRemovedOperatorLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  assertLegacyEthOpsBlocked,
  migrateLegacyCluster,
  type DepositWithdrawTracker,
  type LegacyMigrationSnapshot,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
  assertLegacyOperatorDualTracking,
  assertRemovedOperatorMigrationSkip,
  assertEthConservation,
  assertNetworkValidatorCount,
  assertPhaseAwareOperatorEarnings,
  assertPhaseAwareClusterBalance,
  assertPhaseAwareNetworkEarnings,
  assertContractBalanceWithDeltas,
  resetPhaseAwareSnapshots,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type ContractBalanceWithDeltasSnapshot,
} from "./core/assertions.ts";
import { computeMinViableBalanceForValidatorCount } from "./core/fuzz-helpers.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import { makePublicKey } from "../helpers/keys.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { expect } from "chai";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  DEFAULT_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  removedOperator: OperatorRecord;
  phase: string;

  ssvFee: bigint;
  totalSsvDeposit: bigint;
  migrationSnapshot?: LegacyMigrationSnapshot;

  tracker: DepositWithdrawTracker;

  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: CAT-1-3 — removed operator cluster, migration skips removed op", function () {
  for (const seed of seeds) {
    it(`Validates removed operator legacy migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n),
          );
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT / 2n,
            TOKEN_REGISTER_AMOUNT,
          );
          const removedIndex = Number(ctx.rng.nextInRange(0n, 3n));

          const validatorCount = Number(ctx.rng.nextInRange(2n, 3n));

          const seed = await setupRemovedOperatorLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee,
            validatorCount,
            ssvDepositPerValidator,
            removedOperatorIndex: removedIndex,
          });

          return {
            cluster: {
              cluster: seed.preUpgradeCluster,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: [...seed.validatorKeys],
            },
            operators: seed.operators,
            removedOperator: seed.removedOperator,
            phase: "post-upgrade-with-removed-op",
            ssvFee: seed.ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "removedOperatorMigrationLifecycle",
            fn: async (ctx) => {
              expect(ctx.state.cluster.cluster.active).to.equal(true);
              await assertLegacyEthOpsBlocked(ctx);

              const minViable = computeMinViableBalanceForValidatorCount(
                ctx.state.operators.map(() => BigInt(DEFAULT_OPERATOR_ETH_FEE)),
                BigInt(NETWORK_FEE_ETH),
                BigInt(ctx.state.cluster.cluster.validatorCount),
                BigInt(MINIMUM_BLOCKS_BEFORE_LIQUIDATION),
                BigInt(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL),
              );

              if (minViable > 0n) {
                const underfunded = minViable - 1n;
                await setAccountBalance(ctx.provider, ctx.state.cluster.owner.address, underfunded + 10n ** 18n);
                await expect(
                  ctx.network.connect(ctx.state.cluster.owner).migrateClusterToETH(
                    ctx.state.cluster.operatorIds, ctx.state.cluster.cluster,
                    { value: underfunded },
                  ),
                ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);
              }

              const ethDepositMax = DEFAULT_ETH_REGISTER_VALUE * 2n;
              const migrateStep = migrateLegacyCluster<State>(minViable, ethDepositMax);
              await migrateStep(ctx);

              await assertRemovedOperatorMigrationSkip(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);
              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              const postMigrationBlocks = Number(ctx.rng.nextInRange(30n, 200n));
              await mineBlocks(ctx.provider, postMigrationBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              await expect(
                ctx.network.connect(ctx.state.cluster.owner).registerValidator(
                  makePublicKey(5000), ctx.state.cluster.operatorIds, DEFAULT_SHARES, ctx.state.cluster.cluster,
                  { value: 0n },
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.OPERATOR_DOES_NOT_EXIST);

              const clusterBalance = BigInt(
                await ctx.views.getBalance(
                  ctx.state.cluster.owner.address,
                  ctx.state.cluster.operatorIds,
                  ctx.state.cluster.cluster,
                ),
              );
              const withdrawPct = ctx.rng.nextInRange(10n, 50n);
              const withdrawAmount = (clusterBalance * withdrawPct) / 100n;
              if (withdrawAmount > 0n) {
                const wTx = await ctx.network.connect(ctx.state.cluster.owner).withdraw(
                  ctx.state.cluster.operatorIds, withdrawAmount, ctx.state.cluster.cluster,
                );
                const wReceipt = await wTx.wait();
                ctx.state.cluster.cluster = parseClusterFromEvent(ctx.network, wReceipt, Events.CLUSTER_WITHDRAWN);
                ctx.state.tracker.totalWithdrawn += withdrawAmount;
              }

              const depositAmount = ctx.rng.nextInRange(10n ** 17n, DEFAULT_ETH_REGISTER_VALUE);
              await setAccountBalance(ctx.provider, ctx.state.cluster.owner.address, depositAmount + 10n ** 18n);
              const depTx = await ctx.network.connect(ctx.state.cluster.owner).deposit(
                ctx.state.cluster.owner.address, ctx.state.cluster.operatorIds, ctx.state.cluster.cluster,
                { value: depositAmount },
              );
              const depReceipt = await depTx.wait();
              ctx.state.cluster.cluster = parseClusterFromEvent(ctx.network, depReceipt, Events.CLUSTER_DEPOSITED);
              ctx.state.tracker.totalDeposited += depositAmount;

              resetPhaseAwareSnapshots(ctx);
              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              const removedEarnings = BigInt(await ctx.views.getOperatorEarnings(ctx.state.removedOperator.id));
              expect(removedEarnings).to.equal(0n, "Removed operator must have zero ETH earnings");

              ctx.state.phase = "post-migration-complete";

              await assertEthConservation(ctx);
            },
          },
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
