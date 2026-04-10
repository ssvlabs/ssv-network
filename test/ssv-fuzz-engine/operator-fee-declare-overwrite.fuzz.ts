import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import { parseFeeExecutedEvents, computeMaxAllowedFee, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  ETH_DEDUCTED_DIGITS,
  DECLARE_OPERATOR_FEE_PERIOD,
} from "../common/constants.ts";

type Phase =
  | "declare-first"
  | "declare-second"
  | "advance-to-window"
  | "execute"
  | "verify-fee"
  | "verified";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  phase: Phase;
  feeA: bigint;
  feeB: bigint;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const op = ctx.state.operators[0];

  if (ctx.state.phase === "declare-first") {
    await ctx.network.connect(op.owner)
      .declareOperatorFee(op.id, ctx.state.feeA);

    ctx.state.phase = "declare-second";
    return;
  }

  if (ctx.state.phase === "declare-second") {
    await ctx.network.connect(op.owner)
      .declareOperatorFee(op.id, ctx.state.feeB);

    ctx.state.phase = "advance-to-window";
    return;
  }

  if (ctx.state.phase === "advance-to-window") {
    await ctx.provider.send("evm_increaseTime", [Number(DECLARE_OPERATOR_FEE_PERIOD)]);
    await mineBlocks(ctx.provider, 1);

    ctx.state.phase = "execute";
    return;
  }

  if (ctx.state.phase === "execute") {
    const tx = await ctx.network.connect(op.owner).executeOperatorFee(op.id);
    const receipt = await tx.wait();

    const feeEvents = parseFeeExecutedEvents(ctx.network, receipt);
    const executedFee = feeEvents.length > 0 ? feeEvents[0].fee : null;

    expect(executedFee).to.equal(ctx.state.feeB);

    ctx.state.phase = "verify-fee";
    return;
  }

  if (ctx.state.phase === "verify-fee") {
    const opData = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opData.fee)).to.equal(ctx.state.feeB);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: operator fee declare overwrite — second declaration replaces first (CAT-4-7)", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 8,
        blocksPerTick: { min: 1n, max: 10n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const initialFee = alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE * 2n, MINIMAL_OPERATOR_ETH_FEE * 5n));
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, [initialFee, initialFee, initialFee, initialFee]);

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operators.map(o => o.id),
            3, DEFAULT_ETH_REGISTER_VALUE * 3n,
          );

          const maxAllowed = computeMaxAllowedFee(initialFee);

          const feeA = alignFee(ctx.rng.nextInRange(initialFee + ETH_DEDUCTED_DIGITS, maxAllowed));
          const feeB = alignFee(ctx.rng.nextInRange(initialFee + ETH_DEDUCTED_DIGITS, maxAllowed));

          return {
            operators,
            cluster,
            phase: "declare-first" as Phase,
            feeA,
            feeB,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
