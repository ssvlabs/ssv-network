import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed } from "./core/setup.ts";
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
  collectParsedEventsByName,
  resetPhaseAwareSnapshots,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type ContractBalanceWithDeltasSnapshot,
} from "./core/assertions.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import { Events } from "../common/events.ts";
import { expect } from "chai";
import {
  MAXIMUM_OPERATORS_FEE,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  DEFAULT_SHARES,
  DECLARE_OPERATOR_FEE_PERIOD,
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

describe("Fuzz: CAT-1-6 — max-fee operators cluster, migration assigns default ETH fee", function () {
  for (const seed of seeds) {
    it(`Validates max-fee operators legacy migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT * 2n,
            TOKEN_REGISTER_AMOUNT * 5n,
          );
          const validatorCount = Number(ctx.rng.nextInRange(2n, 3n));

          const seed = await setupLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee: MAXIMUM_OPERATORS_FEE,
            validatorCount,
            ssvDepositPerValidator,
            preUpgradeBlocks: 0,
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
            ssvFee: MAXIMUM_OPERATORS_FEE,
            totalSsvDeposit: seed.totalSsvDeposit,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "maxFeeOperatorsMigrationLifecycle",
            fn: async (ctx) => {
              expect(ctx.state.cluster.cluster.active).to.equal(true);
              await assertLegacyEthOpsBlocked(ctx);

              const ethDepositMin = DEFAULT_ETH_REGISTER_VALUE;
              const ethDepositMax = DEFAULT_ETH_REGISTER_VALUE * 3n;
              const migrateStep = migrateLegacyCluster<State>(ethDepositMin, ethDepositMax);
              await migrateStep(ctx);

              await assertLegacyEnsureETHDefaultsTransition(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);
              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              const phase4Blocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, phase4Blocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);
              await assertEthConservation(ctx);

              const targetOp = ctx.state.operators[0];
              const newFee = DEFAULT_OPERATOR_ETH_FEE * 2n;

              await ctx.network.connect(targetOp.owner).declareOperatorFee(
                targetOp.id, newFee,
              );

              await ctx.provider.send("evm_increaseTime", [Number(DECLARE_OPERATOR_FEE_PERIOD)]);
              await mineBlocks(ctx.provider, 1);

              const execTx = await ctx.network.connect(targetOp.owner).executeOperatorFee(targetOp.id);
              const execReceipt = await execTx.wait();

              const feeExecEvents = collectParsedEventsByName(ctx, execReceipt, Events.OPERATOR_FEE_EXECUTED);
              let foundFeeExec = false;
              for (const event of feeExecEvents) {
                expect(BigInt(event.args.operatorId)).to.equal(BigInt(targetOp.id));
                expect(BigInt(event.args.fee)).to.equal(newFee);
                foundFeeExec = true;
              }
              expect(foundFeeExec, "OperatorFeeExecuted event must be emitted for fee increase").to.equal(true);

              // Update state to reflect the new fee and reset snapshots
              targetOp.fee = newFee;
              resetPhaseAwareSnapshots(ctx, { resetContractBalanceWithDeltas: true });

              // Baseline snapshots at the new fee rate
              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              // Mine blocks and verify burn rate reflects the increased fee
              const postFeeBlocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, postFeeBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);
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
