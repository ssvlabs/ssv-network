import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  migrateLegacyCluster,
  type DepositWithdrawTracker,
  type LegacyMigrationSnapshot,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
  assertZeroFeeOperatorsPostMigration,
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
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
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

describe("Fuzz: CAT-1-5 — zero-fee operators cluster, migration preserves zero fee", function () {
  for (const seed of seeds) {
    it(`Validates zero-fee operators legacy migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT / 2n,
            TOKEN_REGISTER_AMOUNT,
          );
          const validatorCount = Number(ctx.rng.nextInRange(2n, 3n));

          const seed = await setupLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee: 0n,
            validatorCount,
            ssvDepositPerValidator,
            preUpgradeBlocks: 0,
          });

          const zeroFeeOperators = seed.operators.map(op => ({
            ...op,
            fee: 0n,
          }));

          return {
            cluster: {
              cluster: seed.preUpgradeCluster,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: [...seed.validatorKeys],
            },
            operators: zeroFeeOperators,
            phase: "post-upgrade-legacy",
            ssvFee: 0n,
            totalSsvDeposit: seed.totalSsvDeposit,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "zeroFeeOperatorsMigrationLifecycle",
            fn: async (ctx) => {
              expect(ctx.state.cluster.cluster.active).to.equal(true);
              await expect(
                ctx.network.connect(ctx.state.cluster.owner).deposit(
                  ctx.state.cluster.owner.address, ctx.state.cluster.operatorIds, ctx.state.cluster.cluster, { value: 1n },
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INCORRECT_CLUSTER_VERSION);
              await expect(
                ctx.network.connect(ctx.state.cluster.owner).withdraw(
                  ctx.state.cluster.operatorIds, 1n, ctx.state.cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INCORRECT_CLUSTER_VERSION);

              const valCount = BigInt(ctx.state.cluster.cluster.validatorCount);
              const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
              const vUnits = valCount * BPS_DENOMINATOR;
              const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * packedNetFee * vUnits) / BPS_DENOMINATOR;
              const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
              const minViable = liquidationThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
                ? liquidationThreshold
                : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

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

              await assertZeroFeeOperatorsPostMigration(ctx);
              await assertLegacyMigrationRefund(ctx as any);
              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              // Phase 4: verify zero operator fees persist
              await mineBlocks(ctx.provider, 500);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              for (const op of ctx.state.operators) {
                await expect(
                  ctx.network.connect(op.owner).withdrawAllOperatorEarnings(op.id),
                ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);
              }

              const newKey = makePublicKey(5000);
              const regTx = await ctx.network.connect(ctx.state.cluster.owner).registerValidator(
                newKey, ctx.state.cluster.operatorIds, DEFAULT_SHARES, ctx.state.cluster.cluster,
                { value: 0n },
              );
              const regReceipt = await regTx.wait();
              ctx.state.cluster.cluster = parseClusterFromEvent(ctx.network, regReceipt, Events.VALIDATOR_ADDED);
              ctx.state.cluster.validatorKeys.push(newKey);

              ctx.state.lastPhaseAwareOperatorEarnings = undefined;
              ctx.state.lastPhaseAwareClusterBalance = undefined;
              ctx.state.lastPhaseAwareNetworkEarnings = undefined;
              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

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

              ctx.state.lastPhaseAwareOperatorEarnings = undefined;
              ctx.state.lastPhaseAwareClusterBalance = undefined;
              ctx.state.lastPhaseAwareNetworkEarnings = undefined;
              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              for (const op of ctx.state.operators) {
                const earnings = BigInt(await ctx.views.getOperatorEarnings(op.id));
                expect(earnings).to.equal(0n, `Zero-fee operator ${op.id} must have zero ETH earnings`);
              }

              ctx.state.phase = "post-migration-complete";

              await assertContractBalanceWithDeltas(ctx);
              await assertEthConservation(ctx);
            },
          },
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
