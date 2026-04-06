import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupPrivateOperatorsLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
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
  EMPTY_CLUSTER,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;

  ssvFee: bigint;
  totalSsvDeposit: bigint;
  privateCount: number;
  firstPrivateOperatorId: number;
  migrationSnapshot?: LegacyMigrationSnapshot;

  tracker: DepositWithdrawTracker;

  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: CAT-1-11 — private operators cluster, migration + whitelist enforcement", function () {
  for (const seed of seeds) {
    it(`Validates private-operators migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n),
          );
          const validatorCount = Number(ctx.rng.nextInRange(1n, 3n));
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT / 5n,
            TOKEN_REGISTER_AMOUNT,
          );
          const privateCount = Number(ctx.rng.nextInRange(1n, 4n));

          const seed = await setupPrivateOperatorsLegacyMigrationSeed(ctx, {
            ssvFee,
            validatorCount,
            ssvDepositPerValidator,
            privateCount,
          });

          return {
            cluster: {
              cluster: seed.preUpgradeCluster,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: seed.validatorKeys,
            },
            operators: seed.operators,
            phase: "post-upgrade-private-ops",
            ssvFee: seed.ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            privateCount: seed.privateCount,
            firstPrivateOperatorId: seed.firstPrivateOperatorId,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "privateOperatorsMigrationLifecycle",
            fn: async (ctx) => {
              const { cluster } = ctx.state;

              // Phase 2: post-upgrade state pin
              expect(cluster.cluster.active).to.equal(true, "Cluster must be active");
              expect(cluster.cluster.validatorCount).to.be.greaterThan(
                0n,
                "Cluster must have validators",
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

              // Phase 3: migration with fuzzed ETH deposit
              const opCount = BigInt(cluster.operatorIds.length);
              const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
              const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
              const burnRate = opCount * packedOpFee;
              const vUnits = BigInt(cluster.cluster.validatorCount) * BPS_DENOMINATOR;
              const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (burnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
              const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
              const minViable = liquidationThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
                ? liquidationThreshold
                : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

              const migrateStep = migrateLegacyCluster<State>(minViable, DEFAULT_ETH_REGISTER_VALUE * 2n);
              await migrateStep(ctx);

              // Post-migration assertions
              await assertLegacyEnsureETHDefaultsTransition(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);
              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);
              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              // Phase 4: whitelist enforcement post-migration
              const nonWhitelistedUser = ctx.signers[3];
              const regDeposit = DEFAULT_ETH_REGISTER_VALUE;
              await setAccountBalance(ctx.provider, nonWhitelistedUser.address, regDeposit + 10n ** 18n);

              const blockedKey = makePublicKey(9000);
              await expect(
                ctx.network.connect(nonWhitelistedUser).registerValidator(
                  blockedKey, cluster.operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
                  { value: regDeposit },
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.CALLER_NOT_WHITELISTED)
                .withArgs(BigInt(ctx.state.firstPrivateOperatorId));

              // Whitelisted user (clusterOwner) registers successfully
              const regDepositOwner = DEFAULT_ETH_REGISTER_VALUE;
              await setAccountBalance(ctx.provider, cluster.owner.address, regDepositOwner + 10n ** 18n);

              const newKey = makePublicKey(5000);
              const regTx = await ctx.network.connect(cluster.owner).registerValidator(
                newKey, cluster.operatorIds, DEFAULT_SHARES, cluster.cluster,
                { value: regDepositOwner },
              );
              const regReceipt = await regTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, regReceipt, Events.VALIDATOR_ADDED);
              cluster.validatorKeys.push(newKey);
              ctx.state.tracker.totalDeposited += regDepositOwner;

              // Reset phase-aware snapshots (validator count changed)
              ctx.state.lastPhaseAwareOperatorEarnings = undefined;
              ctx.state.lastPhaseAwareClusterBalance = undefined;
              ctx.state.lastPhaseAwareNetworkEarnings = undefined;
              ctx.state.lastContractBalanceWithDeltas = undefined;

              const postMigrationBlocks = Number(ctx.rng.nextInRange(30n, 100n));
              await mineBlocks(ctx.provider, postMigrationBlocks);

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
