import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  assertBlockedEthOpsOnLegacyCluster,
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
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  DEFAULT_SHARES,
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

describe("Fuzz: CAT-1-1 — healthy cluster, normal operators — full migration", function () {
  for (const seed of seeds) {
    it(`Validates full legacy migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n),
          );
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT,
            TOKEN_REGISTER_AMOUNT * 3n,
          );
          const preUpgradeBlocks = Number(ctx.rng.nextInRange(50n, 200n));

          const seed = await setupLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee,
            validatorCount: 3,
            ssvDepositPerValidator,
            preUpgradeBlocks,
          });

          return {
            cluster: {
              cluster: seed.preUpgradeCluster,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: [...seed.validatorKeys],
            },
            operators: seed.operators,
            phase: "post-upgrade-legacy",
            ssvFee: seed.ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "fullMigrationLifecycle",
            fn: async (ctx) => {
              await assertBlockedEthOpsOnLegacyCluster(ctx);

              // After assertBlockedEthOpsOnLegacyCluster removes one validator, validatorCount is 2.
              const valCount = BigInt(ctx.state.cluster.cluster.validatorCount);
              const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
              const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
              const packedOpBurnRate = BigInt(ctx.state.cluster.operatorIds.length) * packedOpFee;
              const vUnits = valCount * BPS_DENOMINATOR;
              const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (packedOpBurnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
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

              await assertLegacyMigrationRefund(ctx as any);
              await assertLegacyEnsureETHDefaultsTransition(ctx as any);
              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              const postMigrationBlocks = Number(ctx.rng.nextInRange(30n, 100n));
              await mineBlocks(ctx.provider, postMigrationBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

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

              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              const depositAmount = ctx.rng.nextInRange(
                DEFAULT_ETH_REGISTER_VALUE / 10n,
                DEFAULT_ETH_REGISTER_VALUE,
              );
              await setAccountBalance(ctx.provider, ctx.state.cluster.owner.address, depositAmount + 10n ** 18n);
              const depositTx = await ctx.network.connect(ctx.state.cluster.owner).deposit(
                ctx.state.cluster.owner.address,
                ctx.state.cluster.operatorIds,
                ctx.state.cluster.cluster,
                { value: depositAmount },
              );
              const depositReceipt = await depositTx.wait();
              ctx.state.cluster.cluster = parseClusterFromEvent(ctx.network, depositReceipt, Events.CLUSTER_DEPOSITED);
              ctx.state.tracker.totalDeposited += depositAmount;

              ctx.state.lastPhaseAwareClusterBalance = undefined;
              await assertPhaseAwareClusterBalance(ctx);
              await assertContractBalanceWithDeltas(ctx);

              const currentBalance = BigInt(
                await ctx.views.getBalance(
                  ctx.state.cluster.owner.address,
                  ctx.state.cluster.operatorIds,
                  ctx.state.cluster.cluster,
                ),
              );
              const burnRate = BigInt(
                await ctx.views.getBurnRate(
                  ctx.state.cluster.owner.address,
                  ctx.state.cluster.operatorIds,
                  ctx.state.cluster.cluster,
                ),
              );
              const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());
              const safeThreshold = burnRate * minBlocks;
              const maxWithdraw = currentBalance > safeThreshold + burnRate
                ? currentBalance - safeThreshold - burnRate
                : 0n;

              if (maxWithdraw > 0n) {
                const withdrawPct = ctx.rng.nextInRange(1n, 50n);
                const withdrawAmount = (maxWithdraw * withdrawPct) / 100n;
                if (withdrawAmount > 0n) {
                  const withdrawTx = await ctx.network.connect(ctx.state.cluster.owner).withdraw(
                    ctx.state.cluster.operatorIds, withdrawAmount, ctx.state.cluster.cluster,
                  );
                  const withdrawReceipt = await withdrawTx.wait();
                  ctx.state.cluster.cluster = parseClusterFromEvent(ctx.network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);
                  ctx.state.tracker.totalWithdrawn += withdrawAmount;
                }
              }

              ctx.state.phase = "post-migration-complete";

              ctx.state.lastPhaseAwareClusterBalance = undefined;
              await assertPhaseAwareClusterBalance(ctx);
              await assertContractBalanceWithDeltas(ctx);
              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);
              await assertEthConservation(ctx);
            },
          },
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
