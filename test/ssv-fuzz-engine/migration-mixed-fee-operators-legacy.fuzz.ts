import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupMixedFeeLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  migrateLegacyCluster,
  type DepositWithdrawTracker,
  type LegacyMigrationSnapshot,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
  assertMixedFeeEnsureETHDefaultsTransition,
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
import { mineBlocks } from "../helpers/blocks.ts";
import { Errors } from "../common/errors.ts";
import { expect } from "chai";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  MAXIMUM_OPERATORS_FEE,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;

  ssvFees: bigint[];
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

describe("Fuzz: CAT-1-7 — mixed-fee operators cluster, migration assigns per-operator ETH fees", function () {
  for (const seed of seeds) {
    it(`Validates mixed-fee operators legacy migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const normalFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n),
          );
          const ssvFees = [0n, normalFee, normalFee, MAXIMUM_OPERATORS_FEE];

          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT * 2n,
            TOKEN_REGISTER_AMOUNT * 5n,
          );
          const validatorCount = Number(ctx.rng.nextInRange(2n, 3n));

          const seed = await setupMixedFeeLegacyMigrationSeed(ctx, {
            ssvFees,
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
            ssvFees: seed.ssvFees,
            totalSsvDeposit: seed.totalSsvDeposit,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "mixedFeeOperatorsMigrationLifecycle",
            fn: async (ctx) => {
              // Phase 2: SSV cluster still active, ETH ops blocked
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

              // Phase 3: migrate
              const ethDepositMin = DEFAULT_ETH_REGISTER_VALUE;
              const ethDepositMax = DEFAULT_ETH_REGISTER_VALUE * 3n;
              const migrateStep = migrateLegacyCluster<State>(ethDepositMin, ethDepositMax);
              await migrateStep(ctx);

              await assertMixedFeeEnsureETHDefaultsTransition(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);
              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              // Phase 4: mixed burn rate verification — 200 blocks
              await mineBlocks(ctx.provider, 200);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              // withdrawAllOperatorEarnings per operator — verify exact amounts
              const vCount = BigInt(ctx.state.cluster.cluster.validatorCount);
              for (let i = 0; i < ctx.state.operators.length; i++) {
                const op = ctx.state.operators[i];
                if (op.fee === 0n) {
                  await expect(
                    ctx.network.connect(op.owner).withdrawAllOperatorEarnings(op.id),
                  ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);
                } else {
                  const earningsBefore = BigInt(await ctx.views.getOperatorEarnings(op.id));
                  expect(earningsBefore).to.be.greaterThan(
                    0n, `Operator ${op.id} must have accrued earnings before withdraw`,
                  );

                  const oneBlockAccrual = (op.fee / ETH_DEDUCTED_DIGITS) * vCount * ETH_DEDUCTED_DIGITS;
                  const expectedWithdrawn = earningsBefore + oneBlockAccrual;

                  const ownerBalBefore = BigInt(await ctx.provider.getBalance(op.owner.address));
                  const tx = await ctx.network.connect(op.owner).withdrawAllOperatorEarnings(op.id);
                  const receipt = await tx.wait();
                  const gasUsed = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);
                  const ownerBalAfter = BigInt(await ctx.provider.getBalance(op.owner.address));

                  const received = ownerBalAfter - ownerBalBefore + gasUsed;
                  expect(received).to.equal(
                    expectedWithdrawn,
                    `Operator ${op.id} exact withdrawn must equal earningsBefore + 1-block accrual`,
                  );

                  const earningsAfter = BigInt(await ctx.views.getOperatorEarnings(op.id));
                  expect(earningsAfter).to.equal(
                    0n, `Operator ${op.id} earnings must be zero after full withdraw`,
                  );
                }
              }

              ctx.state.lastPhaseAwareOperatorEarnings = undefined;
              ctx.state.lastContractBalanceWithDeltas = undefined;
              await assertPhaseAwareOperatorEarnings(ctx);

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
