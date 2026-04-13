import { expect } from "chai";
import { ethers } from "ethers";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { DepositWithdrawTracker } from "./core/steps.ts";
import {
  assertOperatorValidatorCounts,
  assertNetworkValidatorCount,
  assertPhaseAwareOperatorEarnings,
  assertPhaseAwareNetworkEarnings,
  assertPhaseAwareClusterBalance,
  assertInactiveClusterNoSettlement,
  resetPhaseAwareSnapshots,
  type InactiveSettlementSnapshot,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
  type ContractBalanceWithDeltasSnapshot,
} from "./core/assertions.ts";
import { computeMinViableBalanceForValidatorCount } from "./core/fuzz-helpers.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { setAccountBalance, mineBlocks } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

const SMALL_DEPOSIT = ethers.parseEther("1");

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;
  tracker: DepositWithdrawTracker;
  inactiveSettlement?: InactiveSettlementSnapshot;
  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH cluster liquidated ops (CAT-2-2)", function () {
  for (const seed of seeds) {
    it(`Validates deposit/withdraw on liquidated cluster with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const operatorCount = ctx.rng.pick([4, 7, 10, 13]);
          const fees: bigint[] = [];
          for (let i = 0; i < operatorCount; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees);
          const operatorIds = operators.map((o) => o.id);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 5n));
          const depositPerValidator = ctx.rng.nextInRange(SMALL_DEPOSIT / 2n, SMALL_DEPOSIT * 2n);
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
            cluster,
            phase: "setup",
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          // Phase 1 — Setup + Liquidate
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
              expect(isLiq).to.equal(true, "Cluster must be liquidatable after draining balance");

              const liqTx = await ctx.network.connect(liquidator).liquidate(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              const liqReceipt = await liqTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, liqReceipt, Events.CLUSTER_LIQUIDATED);

              expect(cluster.cluster.active).to.equal(false);
              expect(BigInt(cluster.cluster.balance)).to.equal(0n);
              ctx.state.inactiveSettlement = await assertInactiveClusterNoSettlement(ctx);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "liquidated";
            },
          },

          // Phase 2 — Deposit to liquidated cluster
          {
            name: "phase2-deposit-to-liquidated",
            async fn(ctx) {
              const { cluster, tracker } = ctx.state;

              const depositAmount = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE / 2n, DEFAULT_ETH_REGISTER_VALUE * 3n);
              await setAccountBalance(ctx.provider, cluster.owner.address, depositAmount + 10n ** 18n);

              const depositTx = await ctx.network.connect(cluster.owner).deposit(
                cluster.owner.address, cluster.operatorIds, cluster.cluster, { value: depositAmount },
              );
              const depositReceipt = await depositTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, depositReceipt, Events.CLUSTER_DEPOSITED);

              expect(BigInt(cluster.cluster.balance)).to.equal(depositAmount, "Deposit on inactive must increase balance exactly");
              expect(cluster.cluster.active).to.equal(false, "Cluster must stay inactive after deposit");

              tracker.totalDeposited += depositAmount;

              const phase2Blocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, phase2Blocks);

              const secondDeposit = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE / 10n, DEFAULT_ETH_REGISTER_VALUE);
              await setAccountBalance(ctx.provider, cluster.owner.address, secondDeposit + 10n ** 18n);

              const secondTx = await ctx.network.connect(cluster.owner).deposit(
                cluster.owner.address, cluster.operatorIds, cluster.cluster, { value: secondDeposit },
              );
              const secondReceipt = await secondTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, secondReceipt, Events.CLUSTER_DEPOSITED);

              expect(BigInt(cluster.cluster.balance)).to.equal(
                depositAmount + secondDeposit,
                "No fee decay while inactive: balance must equal sum of deposits",
              );
              expect(cluster.cluster.active).to.equal(false, "Cluster must stay inactive after second deposit");

              tracker.totalDeposited += secondDeposit;
              ctx.state.inactiveSettlement = await assertInactiveClusterNoSettlement(
                ctx,
                ctx.state.inactiveSettlement,
                { expectedClusterBalanceDelta: depositAmount + secondDeposit },
              );

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "deposited-inactive";
            },
          },

          // Phase 3 — Withdraw from liquidated cluster
          {
            name: "phase3-withdraw-from-liquidated",
            async fn(ctx) {
              const { cluster, tracker } = ctx.state;

              const phase3Blocks = Number(ctx.rng.nextInRange(20n, 100n));
              await mineBlocks(ctx.provider, phase3Blocks);

              const currentBalance = BigInt(cluster.cluster.balance);
              const withdrawPct = ctx.rng.nextInRange(30n, 70n);
              const partialAmount = (currentBalance * withdrawPct) / 100n;

              const withdrawTx = await ctx.network.connect(cluster.owner).withdraw(
                cluster.operatorIds, partialAmount, cluster.cluster,
              );
              const withdrawReceipt = await withdrawTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

              const expectedRemaining = currentBalance - partialAmount;
              expect(BigInt(cluster.cluster.balance)).to.equal(
                expectedRemaining,
                "Withdraw from inactive must deduct exact amount (no fee settlement)",
              );
              expect(cluster.cluster.active).to.equal(false, "Cluster must stay inactive after partial withdraw");

              tracker.totalWithdrawn += partialAmount;
              let phase3Withdrawn = partialAmount;

              const remainingBalance = BigInt(cluster.cluster.balance);
              if (remainingBalance > 0n) {
                const fullWithdrawTx = await ctx.network.connect(cluster.owner).withdraw(
                  cluster.operatorIds, remainingBalance, cluster.cluster,
                );
                const fullWithdrawReceipt = await fullWithdrawTx.wait();
                cluster.cluster = parseClusterFromEvent(ctx.network, fullWithdrawReceipt, Events.CLUSTER_WITHDRAWN);

                tracker.totalWithdrawn += remainingBalance;
                phase3Withdrawn += remainingBalance;
              }

              expect(BigInt(cluster.cluster.balance)).to.equal(0n, "Full withdrawal must leave balance == 0");
              expect(cluster.cluster.active).to.equal(false, "Cluster must stay inactive after full withdrawal");
              ctx.state.inactiveSettlement = await assertInactiveClusterNoSettlement(
                ctx,
                ctx.state.inactiveSettlement,
                { expectedClusterBalanceDelta: -phase3Withdrawn },
              );

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "drained-inactive";
            },
          },

          // Phase 4 — Deposit + Reactivate
          {
            name: "phase4-deposit-reactivate",
            async fn(ctx) {
              const { cluster, operators, tracker } = ctx.state;

              const preReactivationDeposit = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE / 2n, DEFAULT_ETH_REGISTER_VALUE * 2n);
              await setAccountBalance(ctx.provider, cluster.owner.address, preReactivationDeposit + 10n ** 18n);

              const preTx = await ctx.network.connect(cluster.owner).deposit(
                cluster.owner.address, cluster.operatorIds, cluster.cluster, { value: preReactivationDeposit },
              );
              const preReceipt = await preTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, preReceipt, Events.CLUSTER_DEPOSITED);

              expect(BigInt(cluster.cluster.balance)).to.equal(
                preReactivationDeposit,
                "Pre-reactivation deposit on inactive must set balance exactly",
              );
              expect(cluster.cluster.active).to.equal(false);

              tracker.totalDeposited += preReactivationDeposit;

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

              expect(cluster.cluster.active).to.equal(true, "Cluster must be active after reactivation");
              expect(BigInt(cluster.cluster.balance)).to.equal(
                preReactivationDeposit + reactivateDeposit,
                "Balance at reactivation must equal pre-reactivation deposit + reactivation msg.value",
              );

              ctx.state.phase = "reactivated";
              resetPhaseAwareSnapshots(ctx);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              const postReactivationBlocks = Number(ctx.rng.nextInRange(30n, 100n));
              await mineBlocks(ctx.provider, postReactivationBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
            },
          },
        ],

        expectedPhase: "reactivated",
      }, seed);
    });
  }
});
