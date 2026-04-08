import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupNearLiquidationLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  assertLegacyEthOpsBlocked,
  migrateLegacyCluster,
  type DepositWithdrawTracker,
  type LegacyMigrationSnapshot,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
  assertLegacyEnsureETHDefaultsTransition,
  assertLegacyOperatorDualTracking,
  assertEthConservation,
  assertNetworkValidatorCount,
  assertPhaseAwareOperatorEarnings,
  assertPhaseAwareClusterBalance,
  assertPhaseAwareNetworkEarnings,
  assertContractBalanceWithDeltas,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type ContractBalanceWithDeltasSnapshot,
} from "./core/assertions.ts";
import { computeMinViableBalanceForValidatorCount } from "./core/fuzz-helpers.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import { Errors } from "../common/errors.ts";
import { expect } from "chai";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;

  ssvFee: bigint;
  totalSsvDeposit: bigint;
  ssvBalanceAtMigration: bigint;
  migrationSnapshot?: LegacyMigrationSnapshot;

  tracker: DepositWithdrawTracker;

  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: CAT-1-8 — near-liquidation cluster, migration with minimum ETH", function () {
  for (const seed of seeds) {
    it(`Validates near-liquidation legacy migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n),
          );
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT / 10n,
            TOKEN_REGISTER_AMOUNT / 5n,
          );
          const remainingRunway = Number(ctx.rng.nextInRange(60n, 100n));
          const postThresholdBlocks = Number(ctx.rng.nextInRange(0n, 10n));
          const validatorCount = Number(ctx.rng.nextInRange(1n, 3n));

          const seed = await setupNearLiquidationLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee,
            validatorCount,
            ssvDepositPerValidator,
            remainingRunway,
            postThresholdBlocks,
          });

          return {
            cluster: {
              cluster: seed.preUpgradeCluster,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: [...seed.validatorKeys],
            },
            operators: seed.operators,
            phase: "post-upgrade-near-liq",
            ssvFee: seed.ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            ssvBalanceAtMigration: seed.ssvBalanceAtMigration,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "nearLiquidationMigrationLifecycle",
            fn: async (ctx) => {
              const { cluster } = ctx.state;

              // Phase 2: verify active cluster
              expect(cluster.cluster.active).to.equal(true, "Near-liq cluster must still be active");

              const isLiq = await ctx.views.isLiquidatableSSV(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(
                false,
                "Near-liq cluster must NOT be liquidatable on SSV side after upgrade",
              );

              const ssvBalance = BigInt(
                await ctx.views.getBalanceSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(ssvBalance).to.be.greaterThan(0n, "SSV balance must be positive (not yet depleted)");
              expect(ssvBalance).to.be.lessThan(
                ctx.state.totalSsvDeposit / 5n,
                `SSV balance (${ssvBalance}) must be < 20% of initial deposit (${ctx.state.totalSsvDeposit}) — barely funded`,
              );

              // Phase 2: ETH ops blocked on legacy version
              await assertLegacyEthOpsBlocked(ctx);

              // Compute minViable ETH deposit
              const valCount = BigInt(cluster.cluster.validatorCount);
              const minViable = computeMinViableBalanceForValidatorCount(
                cluster.operatorIds.map(() => BigInt(DEFAULT_OPERATOR_ETH_FEE)),
                BigInt(NETWORK_FEE_ETH),
                valCount,
                BigInt(MINIMUM_BLOCKS_BEFORE_LIQUIDATION),
                BigInt(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL),
              );

              // Phase 3 boundary: minViable - 1 must revert
              if (minViable > 0n) {
                const underfunded = minViable - 1n;
                await setAccountBalance(ctx.provider, cluster.owner.address, underfunded + 10n ** 18n);
                await expect(
                  ctx.network.connect(cluster.owner).migrateClusterToETH(
                    cluster.operatorIds, cluster.cluster,
                    { value: underfunded },
                  ),
                ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);
              }

              // Phase 3: migrate with ETH in [minViable, 2×minViable] to cover both exact-minimum
              // and moderately-above-minimum deposits (spec: fuzz "around the minimum threshold")
              const migrateStep = migrateLegacyCluster<State>(minViable, minViable * 2n);
              await migrateStep(ctx);

              // Verify ETH cluster is solvent immediately post-migration
              const isLiqPostMigration = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, ctx.state.cluster.cluster,
              );
              expect(isLiqPostMigration).to.equal(
                false,
                "Cluster must NOT be ETH-liquidatable immediately after migration with minViable deposit",
              );

              // Post-migration assertions
              await assertLegacyEnsureETHDefaultsTransition(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);

              // Small SSV refund: most SSV consumed by fees during near-threshold run
              const ssvRefund = ctx.state.migrationSnapshot!.ssvRefund;
              expect(ssvRefund).to.be.lessThan(
                ctx.state.totalSsvDeposit * 20n / 100n,
                `SSV refund (${ssvRefund}) must be < 20% of total deposit (${ctx.state.totalSsvDeposit})`,
              );

              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              // Phase 4: post-migration lifecycle at near-liquidation ETH level
              const postMigrationBlocks = Number(ctx.rng.nextInRange(10n, 50n));
              await mineBlocks(ctx.provider, postMigrationBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertEthConservation(ctx);

              ctx.state.phase = "post-migration-complete";
            },
          },
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
