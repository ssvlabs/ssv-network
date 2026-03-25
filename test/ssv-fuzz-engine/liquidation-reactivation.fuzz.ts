import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import { liquidateOrReactivate } from "./core/steps.ts";
import {
  assertOperatorValidatorCounts,
  assertNetworkValidatorCount,
  assertPhaseAwareOperatorEarnings,
  assertPhaseAwareNetworkEarnings,
  assertPhaseAwareClusterBalance,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
} from "./core/assertions.ts";
import { ethers } from "ethers";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

const SMALL_DEPOSIT = ethers.parseEther("1");
const HIGH_FEE_MIN = MINIMAL_OPERATOR_ETH_FEE * 3n;
const HIGH_FEE_MAX = MINIMAL_OPERATOR_ETH_FEE * 10n;

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  phase: "pre-liquidation" | "liquidated" | "reactivated";
  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

describe("Fuzz: liquidation and reactivation", function () {
  for (const seed of seeds) {
    it(`Validates earnings freeze on liquidation and resume on reactivation with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 100,
        blocksPerTick: { min: 5000n, max: 50000n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const operatorCount = ctx.rng.pick([4, 7, 10, 13]);

          const fees: bigint[] = [];
          for (let i = 0; i < operatorCount; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(HIGH_FEE_MIN, HIGH_FEE_MAX)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees);
          const operatorIds = operators.map((o) => o.id);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 10n));
          const cluster = await registerFuzzCluster(
            ctx,
            clusterOwner,
            operatorOwner,
            operatorIds,
            validatorCount,
            SMALL_DEPOSIT,
          );

          return { operators, cluster, phase: "pre-liquidation" as const };
        },

        steps: [
          liquidateOrReactivate(DEFAULT_ETH_REGISTER_VALUE),
          assertPhaseAwareOperatorEarnings,
          assertPhaseAwareNetworkEarnings,
          assertPhaseAwareClusterBalance,
          assertOperatorValidatorCounts,
          assertNetworkValidatorCount,
        ],

        expectedPhase: "reactivated",
      }, seed);
    });
  }
});
