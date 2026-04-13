import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  assertOperatorValidatorCounts,
  assertNetworkValidatorCount,
} from "./core/assertions.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;
  threshold: bigint;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH withdraw boundary (CAT-2-7)", function () {
  for (const seed of seeds) {
    it(`Validates post-withdrawal liquidation check boundary with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const fees: bigint[] = [];
          for (let i = 0; i < 4; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees);
          const operatorIds = operators.map((o) => o.id);

          const cluster = await registerFuzzCluster(
            ctx,
            clusterOwner,
            operatorOwner,
            operatorIds,
            3,
            DEFAULT_ETH_REGISTER_VALUE,
          );

          return {
            operators,
            cluster,
            phase: "setup",
            threshold: 0n,
          };
        },

        steps: [
          {
            name: "phase1-withdraw-boundary",
            async fn(ctx) {
              const { cluster } = ctx.state;

              await mineBlocks(ctx.provider, 50);

              const balance = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const perBlockBurn = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const minBlocks = BigInt(await ctx.views.getLiquidationThresholdPeriod());

              const timeThreshold = minBlocks * perBlockBurn;
              const threshold = timeThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
                ? timeThreshold
                : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

              const maxSafe = balance - perBlockBurn - threshold;
              expect(maxSafe).to.be.greaterThan(0n, "maxSafe must be positive — cluster needs more initial funding");

              const withdrawTx = await ctx.network.connect(cluster.owner).withdraw(
                cluster.operatorIds, maxSafe, cluster.cluster,
              );
              const withdrawReceipt = await withdrawTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

              expect(cluster.cluster.active).to.equal(true);
              expect(BigInt(cluster.cluster.balance)).to.equal(threshold);

              const isLiquidatable = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiquidatable).to.equal(false);

              await expect(
                ctx.network.connect(cluster.owner).withdraw(
                  cluster.operatorIds, 1n, cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);

              ctx.state.threshold = threshold;
              ctx.state.phase = "boundary-probed";
            },
          },

          {
            name: "phase2-zero-validator-withdrawal",
            async fn(ctx) {
              const { cluster } = ctx.state;

              const bulkTx = await ctx.network.connect(cluster.owner).bulkRemoveValidator(
                cluster.validatorKeys, cluster.operatorIds, cluster.cluster,
              );
              const bulkReceipt = await bulkTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, bulkReceipt, Events.VALIDATOR_REMOVED);

              expect(BigInt(cluster.cluster.validatorCount)).to.equal(0n);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              const remainingBalance = BigInt(cluster.cluster.balance);
              expect(remainingBalance).to.be.greaterThan(0n, "Must have remaining balance to withdraw");
              // Fix #3: remaining balance must be ≤ threshold (fees accrued during bulkRemoveValidator settle against it)
              expect(remainingBalance).to.be.lessThanOrEqual(ctx.state.threshold, "Remaining balance must not exceed the phase-1 liquidation threshold");

              const fullWithdrawTx = await ctx.network.connect(cluster.owner).withdraw(
                cluster.operatorIds, remainingBalance, cluster.cluster,
              );
              const fullWithdrawReceipt = await fullWithdrawTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, fullWithdrawReceipt, Events.CLUSTER_WITHDRAWN);

              expect(BigInt(cluster.cluster.balance)).to.equal(0n);
              // Fix #1: liquidation check is skipped for zero-validator clusters, cluster stays active
              expect(cluster.cluster.active).to.equal(true);
              // Fix #2: explicitly confirm not liquidatable (zero-validator path skips liquidation check)
              const isLiquidatableAfterFull = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiquidatableAfterFull).to.equal(false);

              ctx.state.phase = "fully-withdrawn";
            },
          },
        ],

        expectedPhase: "fully-withdrawn",
      }, seed);
    });
  }
});
