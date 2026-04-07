import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, alignFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  assertOperatorValidatorCounts,
  assertNetworkValidatorCount,
  assertClusterBalance,
  type ClusterBalanceSnapshot,
} from "./core/assertions.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { makePublicKey } from "../helpers/keys.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { setAccountBalance } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;
  lastClusterBalance?: ClusterBalanceSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH register validator insufficient balance (CAT-2-6)", function () {
  for (const seed of seeds) {
    it(`Validates registration liquidation boundary with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const fees: bigint[] = [];
          for (let i = 0; i < 4; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE * 10n, MINIMAL_OPERATOR_ETH_FEE * 20n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees, false);
          const operatorIds = operators.map((o) => o.id);

          return {
            operators,
            cluster: {
              cluster: { ...EMPTY_CLUSTER },
              operatorIds,
              owner: clusterOwner,
              validatorKeys: [],
            },
            phase: "setup",
          };
        },

        steps: [
          {
            name: "phase1-registration-boundary",
            async fn(ctx) {
              const { cluster, operators } = ctx.state;
              const operatorIds = cluster.operatorIds;
              const key0 = makePublicKey(3000);
              const key1 = makePublicKey(3001);
              const key2 = makePublicKey(3002);

              // Sub-step 1: 0 ETH -> revert
              await expect(
                ctx.network.connect(cluster.owner).registerValidator(
                  key0, operatorIds, DEFAULT_SHARES, { ...EMPTY_CLUSTER }, { value: 0n },
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);

              // Compute threshold for 1 validator on a new cluster
              const burnRateRaw = operators.reduce((sum, op) => sum + op.fee / ETH_DEDUCTED_DIGITS, 0n);
              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const networkFeeRaw = networkFee / ETH_DEDUCTED_DIGITS;
              const rate = burnRateRaw + networkFeeRaw;
              const vUnits = BPS_DENOMINATOR;
              const minimumBlocksBeforeLiquidation = BigInt(await ctx.views.getLiquidationThresholdPeriod());
              const minimumLiquidationCollateral = BigInt(await ctx.views.getMinimumLiquidationCollateral());
              const thresholdUnits = (minimumBlocksBeforeLiquidation * rate * vUnits) / BPS_DENOMINATOR;
              const timeThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
              const threshold = timeThreshold > minimumLiquidationCollateral
                ? timeThreshold
                : minimumLiquidationCollateral;

              // Sub-step 2: below threshold -> revert
              const maxDelta = threshold / 100n;
              const belowDelta = ctx.rng.nextInRange(1n, maxDelta > 1n ? maxDelta : 1n);
              const belowAmount = threshold - belowDelta;

              await setAccountBalance(ctx.provider, cluster.owner.address, belowAmount + 10n ** 18n);

              await expect(
                ctx.network.connect(cluster.owner).registerValidator(
                  key1, operatorIds, DEFAULT_SHARES, { ...EMPTY_CLUSTER }, { value: belowAmount },
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);

              // Sub-step 3: exactly at threshold -> success
              await setAccountBalance(ctx.provider, cluster.owner.address, threshold + 10n ** 18n);

              const tx = await ctx.network.connect(cluster.owner).registerValidator(
                key2, operatorIds, DEFAULT_SHARES, { ...EMPTY_CLUSTER }, { value: threshold },
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_ADDED);
              cluster.validatorKeys.push(key2);

              expect(BigInt(cluster.cluster.validatorCount)).to.equal(1n);
              expect(cluster.cluster.active).to.equal(true);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);
              await assertClusterBalance(ctx);

              ctx.state.phase = "registered";
            },
          },
        ],

        expectedPhase: "registered",
      }, seed);
    });
  }
});
