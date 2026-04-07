import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupZeroValidatorLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
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
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import { makePublicKey } from "../helpers/keys.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { expect } from "chai";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;

  ssvFee: bigint;
  totalSsvDeposit: bigint;
  residualSsvBalance: bigint;
  migrationSnapshot?: LegacyMigrationSnapshot;

  tracker: DepositWithdrawTracker;

  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: CAT-1-9 — zero-validator cluster, migration + post-migration register", function () {
  for (const seed of seeds) {
    it(`Validates zero-validator legacy migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n),
          );
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT / 5n,
            TOKEN_REGISTER_AMOUNT,
          );
          const initialValidatorCount = Number(ctx.rng.nextInRange(1n, 3n));
          const preRemovalBlocks = Number(ctx.rng.nextInRange(10n, 100n));

          const seed = await setupZeroValidatorLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee,
            initialValidatorCount,
            ssvDepositPerValidator,
            preRemovalBlocks,
          });

          return {
            cluster: {
              cluster: seed.preUpgradeCluster,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: [],
            },
            operators: seed.operators,
            phase: "post-upgrade-zero-val",
            ssvFee: seed.ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            residualSsvBalance: seed.residualSsvBalance,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "zeroValidatorMigrationLifecycle",
            fn: async (ctx) => {
              const { cluster } = ctx.state;

              // Phase 2: pin zero-validator dangerous state
              expect(cluster.cluster.validatorCount).to.equal(
                0n,
                "Cluster must have 0 validators after pre-upgrade removal",
              );
              expect(cluster.cluster.active).to.equal(true, "Zero-val cluster must still be active");

              expect(ctx.state.residualSsvBalance).to.not.equal(
                0n,
                "Seed must produce positive residual SSV balance (non-trivial scenario)",
              );

              const postUpgradeSsvBalance = BigInt(
                await ctx.views.getBalanceSSV(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                ),
              );
              expect(postUpgradeSsvBalance).to.equal(
                ctx.state.residualSsvBalance,
                "Post-upgrade SSV balance must equal residual balance (0 validators → no decay)",
              );

              await expect(
                ctx.network.connect(cluster.owner).deposit(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                  { value: 1n },
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INCORRECT_CLUSTER_VERSION);

              await expect(
                ctx.network.connect(cluster.owner).withdraw(
                  cluster.operatorIds, 1n, cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INCORRECT_CLUSTER_VERSION);

              // Phase 3: migrate with fuzzed ETH deposit (min..3× minimum)
              const ethDepositAmount = ctx.rng.nextInRange(
                MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
                MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 3n,
              );
              const migrateStep = migrateLegacyCluster<State>(ethDepositAmount, ethDepositAmount);
              await migrateStep(ctx);

              // Post-migration assertions
              await assertLegacyEnsureETHDefaultsTransition(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);

              // Full SSV refund: burn rate was 0 (no validators), so full residual balance refunded
              const ssvRefund = ctx.state.migrationSnapshot!.ssvRefund;
              expect(ssvRefund).to.equal(
                ctx.state.migrationSnapshot!.ssvBalanceBefore,
                "Zero-validator cluster refund must equal full SSV balance (burn rate 0)",
              );

              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              // Phase 4: register validator on migrated ETH cluster
              const opCount = BigInt(cluster.operatorIds.length);
              const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
              const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
              const burnRate = opCount * packedOpFee;
              const vUnits = 1n * BPS_DENOMINATOR;
              const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (burnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
              const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
              const minViable = liquidationThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
                ? liquidationThreshold
                : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

              const currentBalance = ethDepositAmount;
              const minRegDeposit = minViable > currentBalance ? minViable - currentBalance : 0n;
              const regDeposit = minRegDeposit + ctx.rng.nextInRange(0n, DEFAULT_ETH_REGISTER_VALUE / 2n);

              await setAccountBalance(ctx.provider, cluster.owner.address, regDeposit + 10n ** 18n);

              const newKey = makePublicKey(5000);
              const regTx = await ctx.network.connect(cluster.owner).registerValidator(
                newKey, cluster.operatorIds, DEFAULT_SHARES, cluster.cluster,
                { value: regDeposit },
              );
              const regReceipt = await regTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, regReceipt, Events.VALIDATOR_ADDED);
              cluster.validatorKeys.push(newKey);
              ctx.state.tracker.totalDeposited += regDeposit;

              expect(cluster.cluster.validatorCount).to.equal(
                1n,
                "Cluster must have 1 validator after registration",
              );

              // Reset phase-aware snapshots (validator count changed 0->1)
              ctx.state.lastPhaseAwareOperatorEarnings = undefined;
              ctx.state.lastPhaseAwareClusterBalance = undefined;
              ctx.state.lastPhaseAwareNetworkEarnings = undefined;
              ctx.state.lastContractBalanceWithDeltas = undefined;

              const postRegistrationBlocks = Number(ctx.rng.nextInRange(30n, 100n));
              await mineBlocks(ctx.provider, postRegistrationBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

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
