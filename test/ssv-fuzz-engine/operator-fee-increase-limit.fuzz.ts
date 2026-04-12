import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, alignFee } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord } from "./core/types.ts";
import { Errors } from "../common/errors.ts";
import { computeMaxAllowedFee, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";

type Phase = "declare-at-max" | "declare-above-max" | "verified";

interface State {
  operator: OperatorRecord;
  phase: Phase;
  maxAllowedFee: bigint;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { operator } = ctx.state;

  if (ctx.state.phase === "declare-at-max") {
    await ctx.network.connect(operator.owner)
      .declareOperatorFee(operator.id, ctx.state.maxAllowedFee);

    await ctx.network.connect(operator.owner)
      .cancelDeclaredOperatorFee(operator.id);

    ctx.state.phase = "declare-above-max";
    return;
  }

  if (ctx.state.phase === "declare-above-max") {
    const aboveMax = ctx.state.maxAllowedFee + ETH_DEDUCTED_DIGITS;

    await expect(
      ctx.network.connect(operator.owner)
        .declareOperatorFee(operator.id, aboveMax),
    ).to.be.revertedWithCustomError(ctx.network, Errors.FEE_EXCEEDS_INCREASE_LIMIT);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: Operator fee increase limit enforcement (CAT-4-8)", function () {
  for (const seed of seeds) {
    it(`Validates operator fee increase limit enforcement (declare-at-max, cancel, above-max revert) with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 5,
        blocksPerTick: { min: 1n, max: 10n },

        async setup(ctx) {
          const [, operatorOwner] = ctx.signers;

          const fee = alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 10n));
          const operators = await registerFuzzOperators(ctx, operatorOwner, 1, [fee]);
          const operator = operators[0];

          const maxAllowedFee = computeMaxAllowedFee(fee);

          return {
            operator,
            phase: "declare-at-max" as Phase,
            maxAllowedFee,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
