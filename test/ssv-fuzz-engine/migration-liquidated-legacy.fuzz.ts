import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLiquidatedLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  migrateLegacyCluster,
  assertPostUpgradeLiquidatedState,
  type DepositWithdrawTracker,
  type LegacyMigrationSnapshot,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
  assertLegacyEnsureETHDefaultsTransition,
  assertLegacyOperatorDualTracking,
  assertLegacyReactivationOnMigration,
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
  DEFAULT_SHARES,
  DEFAULT_OPERATOR_ETH_FEE,
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

describe("Fuzz: CAT-1-2 — liquidated cluster, migration reactivates", function () {
  for (const seed of seeds) {
    it(`Validates liquidated legacy migration lifecycle with seed=${seed}`, async function () {
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
          const postLiquidationBlocks = Number(ctx.rng.nextInRange(0n, 200n));
          const validatorCount = Number(ctx.rng.nextInRange(1n, 3n));

          const seed = await setupLiquidatedLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee,
            validatorCount,
            ssvDepositPerValidator,
            postLiquidationBlocks,
          });

          return {
            cluster: {
              cluster: seed.preUpgradeCluster,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: [...seed.validatorKeys],
            },
            operators: seed.operators,
            phase: "post-upgrade-liquidated",
            ssvFee: seed.ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "liquidatedMigrationLifecycle",
            fn: async (ctx) => {
              await assertPostUpgradeLiquidatedState(ctx);

              const valCount = BigInt(ctx.state.cluster.cluster.validatorCount);
              const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
              const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
              const burnRate = BigInt(ctx.state.cluster.operatorIds.length) * packedOpFee;
              const vUnits = valCount * BPS_DENOMINATOR;
              const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (burnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
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

              await assertLegacyReactivationOnMigration(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);
              expect(ctx.state.migrationSnapshot!.ssvRefund).to.equal(
                0n,
                "Liquidated cluster must have zero SSV refund on migration",
              );
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
