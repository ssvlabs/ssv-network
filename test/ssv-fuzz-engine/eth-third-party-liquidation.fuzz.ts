import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { DepositWithdrawTracker } from "./core/steps.ts";
import {
  assertOperatorValidatorCounts,
  assertNetworkValidatorCount,
} from "./core/assertions.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  MINIMAL_LIQUIDATION_THRESHOLD,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;
  tracker: DepositWithdrawTracker;
}

function computeLiquidationThreshold(operators: OperatorRecord[], networkFee: bigint, validatorCount: number): bigint {
  let packedOpTotal = 0n;
  for (const op of operators) {
    packedOpTotal += op.fee / ETH_DEDUCTED_DIGITS;
  }
  const packedNetFee = networkFee / ETH_DEDUCTED_DIGITS;
  const rate = packedOpTotal + packedNetFee;
  const vUnits = BigInt(validatorCount) * BPS_DENOMINATOR;
  const thresholdUnits = (MINIMAL_LIQUIDATION_THRESHOLD * rate * vUnits) / BPS_DENOMINATOR;
  const threshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
  return threshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL ? threshold : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH third-party liquidation boundary (CAT-2-4)", function () {
  for (const seed of seeds) {
    it(`Validates third-party liquidation threshold boundary with seed=${seed}`, async function () {
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

          const validatorCount = Number(ctx.rng.nextInRange(3n, 5n));
          const networkFee = BigInt(await ctx.views.getNetworkFee());
          const threshold = computeLiquidationThreshold(operators, networkFee, validatorCount);

          const margin = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE, DEFAULT_ETH_REGISTER_VALUE * 3n);
          const totalDeposit = threshold + margin;
          const depositPerValidator = totalDeposit / BigInt(validatorCount);

          await setAccountBalance(ctx.provider, clusterOwner.address, totalDeposit + 10n ** 18n);
          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds, validatorCount, depositPerValidator,
          );

          return {
            operators,
            cluster,
            phase: "setup",
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          // Phase 1 — Not liquidatable
          {
            name: "phase1-not-liquidatable",
            async fn(ctx) {
              const { cluster } = ctx.state;
              const thirdParty = ctx.signers[4];

              const phase1Blocks = Number(ctx.rng.nextInRange(10n, 50n));
              await mineBlocks(ctx.provider, phase1Blocks);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false, "Cluster must NOT be liquidatable after setup");

              await expect(
                ctx.network.connect(thirdParty).liquidate(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.CLUSTER_NOT_LIQUIDATABLE);

              ctx.state.phase = "not-liquidatable";
            },
          },

          // Phase 2 — Threshold boundary probe
          {
            name: "phase2-threshold-boundary",
            async fn(ctx) {
              const { cluster, operators } = ctx.state;
              const thirdParty = ctx.signers[4];

              const balance = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const burnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );

              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const threshold = computeLiquidationThreshold(
                operators, networkFee, Number(cluster.cluster.validatorCount),
              );

              const N = (balance - threshold) / burnRate;

              const blocksToMine = Number(N) - 1;
              expect(blocksToMine).to.be.greaterThan(0, "Need at least 1 block margin for boundary test");
              await mineBlocks(ctx.provider, blocksToMine);

              const isLiqBefore = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiqBefore).to.equal(false, "Cluster must NOT be liquidatable before threshold");

              await expect(
                ctx.network.connect(thirdParty).liquidate(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.CLUSTER_NOT_LIQUIDATABLE);

              // Reverted tx does not mine a block in this test harness.
              // Mine 2 more blocks: N total from getBalance puts balance at threshold + remainder,
              // then +1 crosses below threshold.
              await mineBlocks(ctx.provider, 2);

              const isLiqAfter = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiqAfter).to.equal(true, "Cluster must be liquidatable after threshold crossing");

              ctx.state.phase = "at-threshold";
            },
          },

          // Phase 3 — Third-party liquidation success + bounty
          {
            name: "phase3-liquidation-bounty",
            async fn(ctx) {
              const { cluster } = ctx.state;
              const thirdParty = ctx.signers[4];

              const thirdPartyEthBefore = BigInt(await ctx.provider.getBalance(thirdParty.address));
              const contractEthBefore = BigInt(await ctx.provider.getBalance(await ctx.network.getAddress()));

              const liqTx = await ctx.network.connect(thirdParty).liquidate(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              const liqReceipt = await liqTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, liqReceipt!, Events.CLUSTER_LIQUIDATED);

              const thirdPartyEthAfter = BigInt(await ctx.provider.getBalance(thirdParty.address));
              const contractEthAfter = BigInt(await ctx.provider.getBalance(await ctx.network.getAddress()));
              const gasCost = BigInt(liqReceipt!.gasUsed) * BigInt(liqReceipt!.gasPrice);
              const bounty = thirdPartyEthAfter - thirdPartyEthBefore + gasCost;

              expect(bounty).to.be.greaterThan(0n, "Bounty must be positive (transferred to third-party)");
              expect(contractEthBefore - contractEthAfter).to.equal(bounty, "Contract ETH balance must decrease by exactly the bounty");
              expect(cluster.cluster.active).to.equal(false);
              expect(BigInt(cluster.cluster.balance)).to.equal(0n);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "liquidated";
            },
          },
        ],

        expectedPhase: "liquidated",
      }, seed);
    });
  }
});
