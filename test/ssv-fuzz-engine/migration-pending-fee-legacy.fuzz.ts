import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupPendingFeeLegacyMigrationSeed, alignFee, alignSSVFee } from "./core/setup.ts";
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
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type ContractBalanceWithDeltasSnapshot,
} from "./core/assertions.ts";
import { computeMinViableBalanceForValidatorCount } from "./core/fuzz-helpers.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { expect } from "chai";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  DECLARE_OPERATOR_FEE_PERIOD,
  ETH_DEDUCTED_DIGITS,
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
  declaredSsvFee: bigint;
  pendingOperatorIds: number[];
  migrationSnapshot?: LegacyMigrationSnapshot;

  tracker: DepositWithdrawTracker;

  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: CAT-1-12 — pending fee declaration, migration + post-upgrade fee lifecycle", function () {
  for (const seed of seeds) {
    it(`Validates pending-fee migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvFee = alignSSVFee(ctx.rng.nextInRange(
            MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n,
          ));
          const declaredSsvFee = alignSSVFee(ctx.rng.nextInRange(
            ssvFee + 10_000_000n,
            ssvFee * 2n,
          ));
          const validatorCount = Number(ctx.rng.nextInRange(1n, 3n));
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT / 5n,
            TOKEN_REGISTER_AMOUNT,
          );

          const seed = await setupPendingFeeLegacyMigrationSeed(ctx, {
            ssvFee,
            declaredSsvFee,
            validatorCount,
            ssvDepositPerValidator,
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
            ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            declaredSsvFee: seed.declaredSsvFee,
            pendingOperatorIds: seed.pendingOperatorIds,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "pendingFeeMigrationLifecycle",
            fn: async (ctx) => {
              const { cluster, operators, pendingOperatorIds } = ctx.state;

              expect(cluster.cluster.active).to.equal(true);
              expect(BigInt(cluster.cluster.validatorCount)).to.be.greaterThan(0n);

              await assertLegacyEthOpsBlocked(ctx);

              const operatorOwner = operators[0].owner;
              for (const opId of pendingOperatorIds) {
                await expect(
                  ctx.network.connect(operatorOwner).executeOperatorFee(opId),
                ).to.be.revertedWithCustomError(ctx.network, Errors.LEGACY_OPERATOR_FEE_DECLARATION_INVALID);
              }

              const minViable = computeMinViableBalanceForValidatorCount(
                cluster.operatorIds.map(() => BigInt(DEFAULT_OPERATOR_ETH_FEE)),
                BigInt(NETWORK_FEE_ETH),
                BigInt(cluster.cluster.validatorCount),
                BigInt(MINIMUM_BLOCKS_BEFORE_LIQUIDATION),
                BigInt(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL),
              );

              const migrateStep = migrateLegacyCluster<State>(minViable, DEFAULT_ETH_REGISTER_VALUE * 2n);
              await migrateStep(ctx);

              await assertLegacyEnsureETHDefaultsTransition(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);
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
              await assertContractBalanceWithDeltas(ctx);
              await assertEthConservation(ctx);

              const targetOp = operators[0];
              const newEthFee = alignFee(ctx.rng.nextInRange(
                DEFAULT_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS,
                DEFAULT_OPERATOR_ETH_FEE * 2n,
              ));

              const declareTx = await ctx.network.connect(targetOp.owner).declareOperatorFee(
                targetOp.id, newEthFee,
              );
              const declareReceipt = await declareTx.wait();

              const declaredEvents = collectParsedEventsByName(ctx, declareReceipt, Events.OPERATOR_FEE_DECLARED);
              let foundDeclare = false;
              for (const event of declaredEvents) {
                expect(BigInt(event.args.operatorId)).to.equal(BigInt(targetOp.id));
                expect(BigInt(event.args.fee)).to.equal(newEthFee);
                foundDeclare = true;
              }
              expect(foundDeclare, "OperatorFeeDeclared event must be emitted").to.equal(true);

              await ctx.provider.send("evm_increaseTime", [Number(DECLARE_OPERATOR_FEE_PERIOD)]);
              await mineBlocks(ctx.provider, 1);

              const execTx = await ctx.network.connect(targetOp.owner).executeOperatorFee(targetOp.id);
              const execReceipt = await execTx.wait();

              const feeExecEvents = collectParsedEventsByName(ctx, execReceipt, Events.OPERATOR_FEE_EXECUTED);
              let foundFeeExec = false;
              for (const event of feeExecEvents) {
                expect(BigInt(event.args.operatorId)).to.equal(BigInt(targetOp.id));
                expect(BigInt(event.args.fee)).to.equal(newEthFee);
                foundFeeExec = true;
              }
              expect(foundFeeExec, "OperatorFeeExecuted event must be emitted for new fee").to.equal(true);

              targetOp.fee = newEthFee;
              ctx.state.phase = "post-fee-change";

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              const postFeeBlocks = Number(ctx.rng.nextInRange(30n, 100n));
              await mineBlocks(ctx.provider, postFeeBlocks);

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
