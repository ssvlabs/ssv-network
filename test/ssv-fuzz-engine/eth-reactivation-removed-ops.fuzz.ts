import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { DepositWithdrawTracker } from "./core/steps.ts";
import {
  assertOperatorValidatorCounts,
  assertValidatorCounts,
  assertNetworkValidatorCount,
  assertPhaseAwareOperatorEarnings,
  assertPhaseAwareNetworkEarnings,
  assertPhaseAwareClusterBalance,
  resetPhaseAwareSnapshots,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
} from "./core/assertions.ts";
import {
  computeBurnRate,
  computeMinViableBalanceForValidatorCount,
} from "./core/fuzz-helpers.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { setAccountBalance, mineBlocks } from "../helpers/blocks.ts";
import { makePublicKey } from "../helpers/keys.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  BPS_DENOMINATOR,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  removedOperators: OperatorRecord[];
  phase: string;
  tracker: DepositWithdrawTracker;
  removedEarningsBaseline?: Map<number, bigint>;
  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH reactivation with removed operators (CAT-2-5)", function () {
  for (const seed of seeds) {
    it(`Validates reactivation skips removed operators and reduced-set accrual with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const fees: bigint[] = [];
          for (let i = 0; i < 4; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees, 1000, false);
          const operatorIds = operators.map((o) => o.id);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 5n));
          const networkFee = BigInt(await ctx.views.getNetworkFee());
          const minViable = computeMinViableBalanceForValidatorCount(
            operators.map((op) => op.fee),
            networkFee,
            BigInt(validatorCount),
            MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
            MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
          );

          const depositPerValidator = ctx.rng.nextInRange(
            minViable / BigInt(validatorCount) + DEFAULT_ETH_REGISTER_VALUE / 10n,
            minViable / BigInt(validatorCount) + DEFAULT_ETH_REGISTER_VALUE,
          );
          const cluster = await registerFuzzCluster(
            ctx,
            clusterOwner,
            operatorOwner,
            operatorIds,
            validatorCount,
            depositPerValidator,
          );

          return {
            operators,
            removedOperators: [],
            cluster,
            phase: "setup",
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "phase1-liquidate",
            async fn(ctx) {
              const { cluster } = ctx.state;
              const liquidator = ctx.signers[4];

              const balance = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const burnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );

              if (burnRate > 0n) {
                const blocksUntilDrained = balance / burnRate;
                await mineBlocks(ctx.provider, Number(blocksUntilDrained) + 1);
              }

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(true, "Cluster must be liquidatable after draining");

              const liqTx = await ctx.network.connect(liquidator).liquidate(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              const liqReceipt = await liqTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, liqReceipt, Events.CLUSTER_LIQUIDATED);

              expect(cluster.cluster.active).to.equal(false);
              expect(BigInt(cluster.cluster.balance)).to.equal(0n);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "liquidated";
            },
          },

          {
            name: "phase2-remove-operators",
            async fn(ctx) {
              const { cluster, operators } = ctx.state;
              const operatorOwner = ctx.signers[1];

              const removeCount = Number(ctx.rng.nextInRange(1n, 3n));
              const indicesToRemove: number[] = [];
              const available = [...Array(operators.length).keys()];
              for (let i = 0; i < removeCount; i++) {
                const pick = Number(ctx.rng.nextInRange(0n, BigInt(available.length - 1)));
                indicesToRemove.push(available[pick]);
                available.splice(pick, 1);
              }
              indicesToRemove.sort((a, b) => b - a);

              const removed: OperatorRecord[] = [];
              for (const idx of indicesToRemove) {
                const op = operators[idx];
                await ctx.network.connect(operatorOwner).removeOperator(op.id);
                removed.push(op);
                operators.splice(idx, 1);
              }

              for (const op of removed) {
                const opData = await ctx.views.getOperatorById(op.id);
                expect(opData.isActive).to.equal(false, `Removed operator ${op.id} must be inactive`);
                expect(BigInt(opData.fee)).to.equal(0n, `Removed operator ${op.id} fee must be 0`);
                expect(BigInt(opData.validatorCount)).to.equal(0n, `Removed operator ${op.id} validatorCount must be 0`);
              }

              expect(cluster.cluster.active).to.equal(false, "Cluster must still be liquidated");

              ctx.state.removedOperators = removed;

              const earningsBaseline = new Map<number, bigint>();
              for (const op of removed) {
                earningsBaseline.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
              }
              ctx.state.removedEarningsBaseline = earningsBaseline;

              ctx.state.phase = "operators-removed";
            },
          },

          {
            name: "phase3-reactivate",
            async fn(ctx) {
              const { cluster, operators, removedOperators, tracker } = ctx.state;
              const validatorCount = BigInt(cluster.cluster.validatorCount);
              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const minViable = computeMinViableBalanceForValidatorCount(
                operators.map((op) => op.fee),
                networkFee,
                validatorCount,
                MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
                MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
              );

              const reactivateDeposit = ctx.rng.nextInRange(minViable, minViable + DEFAULT_ETH_REGISTER_VALUE);
              await setAccountBalance(ctx.provider, cluster.owner.address, reactivateDeposit + 10n ** 18n);

              const reactivateTx = await ctx.network.connect(cluster.owner).reactivate(
                cluster.operatorIds, cluster.cluster, { value: reactivateDeposit },
              );
              const reactivateReceipt = await reactivateTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, reactivateReceipt, Events.CLUSTER_REACTIVATED);
              tracker.totalDeposited += reactivateDeposit;

              expect(cluster.cluster.active).to.equal(true);
              const expectedCounts = new Map<number, bigint>();
              for (const op of operators) {
                expectedCounts.set(op.id, validatorCount);
              }
              for (const op of removedOperators) {
                expectedCounts.set(op.id, 0n);
              }
              await assertValidatorCounts(ctx, expectedCounts);

              for (const op of removedOperators) {
                const opData = await ctx.views.getOperatorById(op.id);
                expect(opData.isActive).to.equal(false, `Removed operator ${op.id} must remain inactive`);
              }

              const contractBurnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const expectedBurnRate = computeBurnRate(
                operators.map((op) => op.fee),
                networkFee,
                BigInt(validatorCount) * BPS_DENOMINATOR,
              );
              expect(contractBurnRate).to.equal(expectedBurnRate);

              ctx.state.phase = "reactivated";
              resetPhaseAwareSnapshots(ctx);

              await assertNetworkValidatorCount(ctx);

              const postReactivationBlocks = Number(ctx.rng.nextInRange(30n, 100n));
              await mineBlocks(ctx.provider, postReactivationBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
            },
          },

          {
            name: "phase4-operate-reduced",
            async fn(ctx) {
              const { cluster, removedOperators, removedEarningsBaseline, tracker } = ctx.state;

              const operateBlocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, operateBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              for (const op of removedOperators) {
                const currentEarnings = BigInt(await ctx.views.getOperatorEarnings(op.id));
                expect(currentEarnings).to.equal(
                  removedEarningsBaseline!.get(op.id)!,
                  `Removed operator ${op.id} earnings must be frozen`,
                );
              }

              const keyFail = makePublicKey(9000);
              await expect(
                ctx.network.connect(cluster.owner).registerValidator(
                  keyFail, cluster.operatorIds, DEFAULT_SHARES, cluster.cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.OPERATOR_DOES_NOT_EXIST);

              // Positive path: deposit confirms the cluster is still operational with reduced operator set.
              // registerValidator with the full operator set (including removed IDs) is not possible because
              // the contract reverts with OperatorDoesNotExist, and a subset of < 4 operators is invalid.
              const depositAmount = DEFAULT_ETH_REGISTER_VALUE / 2n;
              await setAccountBalance(ctx.provider, cluster.owner.address, depositAmount + 10n ** 18n);
              const depositTx = await ctx.network.connect(cluster.owner).deposit(
                cluster.owner.address, cluster.operatorIds, cluster.cluster, { value: depositAmount },
              );
              const depositReceipt = await depositTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, depositReceipt, Events.CLUSTER_DEPOSITED);
              tracker.totalDeposited += depositAmount;

              expect(cluster.cluster.active).to.equal(true);

              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "operated";
            },
          },
        ],

        expectedPhase: "operated",
      }, seed);
    });
  }
});
