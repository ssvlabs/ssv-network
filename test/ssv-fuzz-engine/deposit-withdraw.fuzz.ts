import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import { generateRandomFees } from "./core/fuzz-helpers.ts";
import { depositOrWithdraw, type DepositWithdrawTracker } from "./core/steps.ts";
import {
  assertClusterBalanceWithDeltas,
  assertContractBalanceWithDeltas,
  type ClusterBalanceWithDeltasSnapshot,
  type ContractBalanceWithDeltasSnapshot,
} from "./core/assertions.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  tracker: DepositWithdrawTracker;
  lastClusterBalanceWithDeltas?: ClusterBalanceWithDeltasSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

describe("Fuzz: deposit and withdraw", function () {
  for (const seed of seeds) {
    it(`Validates cluster balance, contract balance and burn rate through random deposits and withdrawals with seed=${seed}`, async function () {
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
          );

          return { operators, cluster, tracker: { totalDeposited: 0n, totalWithdrawn: 0n } };
        },

        steps: [
          depositOrWithdraw(
            DEFAULT_ETH_REGISTER_VALUE / 10n,
            DEFAULT_ETH_REGISTER_VALUE,
          ),
          assertContractBalanceWithDeltas,
          assertClusterBalanceWithDeltas,
        ],
      }, seed);
    });
  }
});
