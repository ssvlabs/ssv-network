import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import { Errors } from "../common/errors.ts";
import { computeMaxAllowedFee, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  DECLARE_OPERATOR_FEE_PERIOD,
} from "../common/constants.ts";

type Phase =
  | "declare-fee"
  | "advance-to-window"
  | "lower-max-fee"
  | "execute-reverts"
  | "verified";

interface State {
  operator: OperatorRecord;
  cluster: ClusterRecord;
  phase: Phase;
  declaredFee: bigint;
  newMaxFee: bigint;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { operator } = ctx.state;

  if (ctx.state.phase === "declare-fee") {
    await ctx.network.connect(operator.owner)
      .declareOperatorFee(operator.id, ctx.state.declaredFee);

    ctx.state.phase = "advance-to-window";
    return;
  }

  if (ctx.state.phase === "advance-to-window") {
    await ctx.provider.send("evm_increaseTime", [Number(DECLARE_OPERATOR_FEE_PERIOD)]);
    await mineBlocks(ctx.provider, 1);

    ctx.state.phase = "lower-max-fee";
    return;
  }

  if (ctx.state.phase === "lower-max-fee") {
    await ctx.network.updateMaximumOperatorFee(ctx.state.newMaxFee);

    const currentMax = BigInt(await ctx.views.getMaximumOperatorFee());
    expect(currentMax).to.equal(ctx.state.newMaxFee);

    ctx.state.phase = "execute-reverts";
    return;
  }

  if (ctx.state.phase === "execute-reverts") {
    await expect(
      ctx.network.connect(operator.owner).executeOperatorFee(operator.id),
    ).to.be.revertedWithCustomError(ctx.network, Errors.FEE_TOO_HIGH);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: governance max fee lowered blocks pending declaration (CAT-6-4)", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 8,
        blocksPerTick: { min: 1n, max: 10n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const fee = alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE * 2n, MINIMAL_OPERATOR_ETH_FEE * 5n));
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, [fee, fee, fee, fee]);
          const operator = operators[0];

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operators.map(o => o.id),
            3, DEFAULT_ETH_REGISTER_VALUE * 3n,
          );

          const declaredFee = computeMaxAllowedFee(fee);

          const newMaxFee = alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, fee));

          return {
            operator,
            cluster,
            phase: "declare-fee" as Phase,
            declaredFee,
            newMaxFee,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
