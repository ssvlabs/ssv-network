import { expect } from "chai";
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
  resetPhaseAwareSnapshots,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
} from "./core/assertions.ts";
import { computeMinViableBalanceForValidatorCount } from "./core/fuzz-helpers.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { setAccountBalance, mineBlocks } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;
  tracker: DepositWithdrawTracker;
  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH self-liquidation (CAT-2-3)", function () {
  for (const seed of seeds) {
    it(`Validates owner self-liquidation while solvent + reactivation with seed=${seed}`, async function () {
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

          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees, false);
          const operatorIds = operators.map((o) => o.id);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 5n));
          const depositPerValidator = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE, DEFAULT_ETH_REGISTER_VALUE * 3n);
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
          // Phase 1 — Self-liquidate while solvent
          {
            name: "phase1-self-liquidate",
            async fn(ctx) {
              const { cluster } = ctx.state;
              const thirdParty = ctx.signers[4];

              const blocksBefore = Number(ctx.rng.nextInRange(10n, 500n));
              await mineBlocks(ctx.provider, blocksBefore);

              await expect(
                ctx.network.connect(thirdParty).liquidate(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.CLUSTER_NOT_LIQUIDATABLE);

              const ownerEthBefore = BigInt(await ctx.provider.getBalance(cluster.owner.address));

              const liqTx = await ctx.network.connect(cluster.owner).liquidate(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              const liqReceipt = await liqTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, liqReceipt!, Events.CLUSTER_LIQUIDATED);

              const ownerEthAfter = BigInt(await ctx.provider.getBalance(cluster.owner.address));
              const gasCost = BigInt(liqReceipt!.gasUsed) * BigInt(liqReceipt!.gasPrice);

              expect(ownerEthAfter).to.be.greaterThan(ownerEthBefore - gasCost, "Bounty must be positive (cluster was solvent)");
              expect(cluster.cluster.active).to.equal(false);
              expect(BigInt(cluster.cluster.balance)).to.equal(0n);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "self-liquidated";
            },
          },

          // Phase 2 — Reactivate
          {
            name: "phase2-reactivate",
            async fn(ctx) {
              const { cluster, operators, tracker } = ctx.state;
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
              cluster.cluster = parseClusterFromEvent(ctx.network, reactivateReceipt!, Events.CLUSTER_REACTIVATED);
              tracker.totalDeposited += reactivateDeposit;

              expect(cluster.cluster.active).to.equal(true);

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
