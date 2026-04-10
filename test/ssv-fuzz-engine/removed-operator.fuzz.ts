import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import { generateRandomFees } from "./core/fuzz-helpers.ts";
import {
  assertOperatorEarnings,
  assertRemovedOperatorEarningsFrozen,
  assertClusterBalance,
  assertNetworkEarnings,
  type OperatorEarningsSnapshot,
  type ClusterBalanceSnapshot,
  type NetworkEarningsSnapshot,
} from "./core/assertions.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

interface State {
  operators: OperatorRecord[];
  removedOperator: OperatorRecord | null;
  cluster: ClusterRecord;
  lastOperatorEarnings?: OperatorEarningsSnapshot;
  lastRemovedOperatorEarnings?: bigint;
  lastClusterBalance?: ClusterBalanceSnapshot;
  lastNetworkEarnings?: NetworkEarningsSnapshot;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

describe("Fuzz: removed operator — cluster continues", function () {
  for (const seed of seeds) {
    it(`Validates removed operator earnings frozen and active operators unaffected with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 100,
        blocksPerTick: { min: 10n, max: 500n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const operatorCount = ctx.rng.pick([4, 7, 10, 13]);

          const fees = generateRandomFees(ctx, operatorCount);

          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees);
          const operatorIds = operators.map((o) => o.id);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 50n));
          const cluster = await registerFuzzCluster(
            ctx,
            clusterOwner,
            operatorOwner,
            operatorIds,
            validatorCount,
            DEFAULT_ETH_REGISTER_VALUE,
          );

          const removedIdx = Number(ctx.rng.nextInRange(0n, BigInt(operators.length - 1)));
          const removedOperator = operators[removedIdx];
          await ctx.network.connect(operatorOwner).removeOperator(removedOperator.id);
          operators.splice(removedIdx, 1);

          return { operators, removedOperator, cluster };
        },

        steps: [
          assertOperatorEarnings,
          assertRemovedOperatorEarningsFrozen,
          assertClusterBalance,
          assertNetworkEarnings,
        ],
      }, seed);
    });
  }
});
