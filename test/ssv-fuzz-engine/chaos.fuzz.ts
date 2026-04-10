import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { FuzzContext } from "./core/types.ts";
import { generateRandomFees, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  ALL_CHAOS_ACTIONS,
  checkChaosInvariants,
  type ChaosState,
} from "./core/chaos-actions.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

const WEIGHTS = ALL_CHAOS_ACTIONS.map(a => a.weight);

async function chaosStep(ctx: FuzzContext<ChaosState>): Promise<void> {
  await ALL_CHAOS_ACTIONS[ctx.rng.weightedIndex(WEIGHTS)].fn(ctx);
  await checkChaosInvariants(ctx);
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: governance + multi-cluster chaos with shared operators", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<ChaosState>({
        ticks: 100,
        blocksPerTick: { min: 10n, max: 500n },

        async setup(ctx) {
          const [, operatorOwner, ownerA, ownerB] = ctx.signers;

          const operatorCount = ctx.rng.pick([4, 7, 10, 13]);
          const fees = generateRandomFees(ctx, operatorCount);
          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees);

          const opsA = operators.slice(0, 4).map(o => o.id);
          const clusterA = await registerFuzzCluster(
            ctx, ownerA, operatorOwner, opsA, 3,
            ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE * 2n, DEFAULT_ETH_REGISTER_VALUE * 5n), 1000,
          );

          const opsB = [
            operators[0].id, operators[1].id, operators[2].id,
            operators[Math.min(4, operators.length - 1)].id,
          ];
          const clusterB = await registerFuzzCluster(
            ctx, ownerB, operatorOwner, opsB, 4,
            ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE, DEFAULT_ETH_REGISTER_VALUE * 3n), 2000,
          );

          await ctx.network.updateDeclareOperatorFeePeriod(10);
          await ctx.network.updateExecuteOperatorFeePeriod(10000);

          return { operators, clusters: [clusterA, clusterB], nextKeyOffset: 5000 };
        },

        steps: [chaosStep],
      }, seed);
    });
  }
});
