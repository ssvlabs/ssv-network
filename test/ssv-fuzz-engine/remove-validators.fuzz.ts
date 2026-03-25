import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import {
  assertContractBalanceUnchanged,
  assertOperatorEarnings,
  assertClusterBalance,
  assertNetworkEarnings,
  assertNetworkValidatorCount,
  assertOperatorValidatorCounts,
  type Snapshot,
  type OperatorEarningsSnapshot,
  type ClusterBalanceSnapshot,
  type NetworkEarningsSnapshot,
} from './core/assertions.ts';
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import { removeValidators } from "./core/steps.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  prev: Snapshot | null;
  lastContractBalance?: bigint;
  lastOperatorEarnings?: OperatorEarningsSnapshot;
  lastClusterBalance?: ClusterBalanceSnapshot;
  lastNetworkEarnings?: NetworkEarningsSnapshot;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

describe("Fuzz: remove validators from cluster", function () {
  for (const seed of seeds) {
    it(`Validates contract balance, cluster balance, DAO and operator earnings are correct with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 100,
        blocksPerTick: { min: 10n, max: 500n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const operatorCount = ctx.rng.pick([4, 7, 10, 13]);

          const fees: bigint[] = [];
          for (let i = 0; i < operatorCount; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees);
          const operatorIds = operators.map((o) => o.id);

          const validatorCount = Number(ctx.rng.nextInRange(100n, 2000n));
          const cluster = await registerFuzzCluster(
            ctx,
            clusterOwner,
            operatorOwner,
            operatorIds,
            validatorCount,
            DEFAULT_ETH_REGISTER_VALUE,
          );

          return { operators, cluster, prev: null };
        },

        steps: [
          removeValidators(1, 10),
          assertContractBalanceUnchanged,
          assertOperatorEarnings,
          assertClusterBalance,
          assertNetworkEarnings,
          assertNetworkValidatorCount,
          assertOperatorValidatorCounts,
        ],
      }, seed);
    });
  }
});
