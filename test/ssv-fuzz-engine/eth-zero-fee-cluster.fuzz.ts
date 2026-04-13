import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import type {
  OperatorEarningsSnapshot,
  ClusterBalanceSnapshot,
  NetworkEarningsSnapshot,
} from "./core/assertions.ts";
import {
  assertOperatorEarnings,
  assertClusterBalance,
  assertNetworkEarnings,
  assertEthConservation,
  assertOperatorValidatorCounts,
  assertNetworkValidatorCount,
} from "./core/assertions.ts";
import { computeBurnRate } from "./core/fuzz-helpers.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import {
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
  lastOperatorEarnings?: OperatorEarningsSnapshot;
  lastClusterBalance?: ClusterBalanceSnapshot;
  lastNetworkEarnings?: NetworkEarningsSnapshot;
}

function computeLiquidationThreshold(networkFee: bigint, validatorCount: number): bigint {
  const packedNetFee = networkFee / ETH_DEDUCTED_DIGITS;
  const rate = packedNetFee;
  const vUnits = BigInt(validatorCount) * BPS_DENOMINATOR;
  const thresholdUnits = (MINIMAL_LIQUIDATION_THRESHOLD * rate * vUnits) / BPS_DENOMINATOR;
  const threshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
  return threshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL ? threshold : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH cluster with zero-fee operators (CAT-2-9)", function () {
  for (const seed of seeds) {
    it(`Validates zero-fee operator accrual and network-fee-only liquidation with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const fees = [0n, 0n, 0n, 0n];
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees, 1000, false);
          const operatorIds = operators.map((o) => o.id);

          const depositPerValidator = ctx.rng.nextInRange(
            DEFAULT_ETH_REGISTER_VALUE / 2n,
            DEFAULT_ETH_REGISTER_VALUE * 2n,
          );

          await setAccountBalance(ctx.provider, clusterOwner.address, depositPerValidator * 3n + 10n ** 18n);

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds, 3, depositPerValidator,
          );

          return {
            operators,
            cluster,
            phase: "setup",
          };
        },

        steps: [
          {
            name: "phase1-zero-fee-accrual",
            async fn(ctx) {
              const { cluster, operators } = ctx.state;

              await assertOperatorEarnings(ctx);
              await assertClusterBalance(ctx);
              await assertNetworkEarnings(ctx);

              const fuzzedBlocks = Number(ctx.rng.nextInRange(200n, 500n));
              await mineBlocks(ctx.provider, fuzzedBlocks);

              await assertOperatorEarnings(ctx);
              await assertClusterBalance(ctx);
              await assertNetworkEarnings(ctx);
              await assertEthConservation(ctx);

              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const validatorCount = BigInt(cluster.cluster.validatorCount);
              const vUnits = validatorCount * BPS_DENOMINATOR;
              const operatorFees = operators.map((op) => op.fee);
              const expectedBurnRate = computeBurnRate(operatorFees, networkFee, vUnits);
              const contractBurnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(expectedBurnRate).to.equal(contractBurnRate);

              const networkOnlyBurnRate = ((networkFee / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS * vUnits) / BPS_DENOMINATOR;
              expect(contractBurnRate).to.equal(networkOnlyBurnRate);

              for (const op of operators) {
                const earnings = BigInt(await ctx.views.getOperatorEarnings(op.id));
                expect(earnings).to.equal(0n);
              }

              ctx.state.phase = "accrued";
            },
          },

          {
            name: "phase2-liquidation-from-network-fee",
            async fn(ctx) {
              const { cluster } = ctx.state;
              const thirdParty = ctx.signers[4];

              const balance = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const burnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );

              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const threshold = computeLiquidationThreshold(networkFee, Number(cluster.cluster.validatorCount));

              const N = (balance - threshold) / burnRate;
              const blocksToMine = Number(N) + 1;
              expect(blocksToMine).to.be.greaterThan(0, "Need blocks to reach liquidation");
              await mineBlocks(ctx.provider, blocksToMine);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(true);

              const contractAddress = await ctx.network.getAddress();
              const contractEthBefore = BigInt(await ctx.provider.getBalance(contractAddress));
              const liquidatorEthBefore = BigInt(await ctx.provider.getBalance(thirdParty.address));

              const liqTx = await ctx.network.connect(thirdParty).liquidate(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              const liqReceipt = await liqTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, liqReceipt, Events.CLUSTER_LIQUIDATED);

              expect(cluster.cluster.active).to.equal(false);
              expect(BigInt(cluster.cluster.balance)).to.equal(0n);

              const contractEthAfter = BigInt(await ctx.provider.getBalance(contractAddress));
              const liquidatorEthAfter = BigInt(await ctx.provider.getBalance(thirdParty.address));
              const gasCost = BigInt(liqReceipt!.gasUsed) * BigInt(liqReceipt!.gasPrice);
              const bounty = contractEthBefore - contractEthAfter;

              expect(bounty).to.be.greaterThan(0n, "Liquidator must receive a bounty");
              expect(liquidatorEthAfter).to.equal(liquidatorEthBefore + bounty - gasCost);

              // Post-liquidation conservation: contract holds only operator earnings + network earnings
              let totalOperatorEarnings = 0n;
              for (const op of ctx.state.operators) {
                totalOperatorEarnings += BigInt(await ctx.views.getOperatorEarnings(op.id));
              }
              const networkEarnings = BigInt(await ctx.views.getNetworkEarnings());
              expect(totalOperatorEarnings + networkEarnings).to.equal(contractEthAfter);

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
