import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import { computeBurnRate, parseFeeExecutedEvents, computeMaxAllowedFee, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import { Errors } from "../common/errors.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
} from "../common/constants.ts";

type Phase =
  | "accrue-at-old-fee"
  | "declare"
  | "verify-old-fee-still-active"
  | "execute-too-early"
  | "advance-to-window"
  | "execute"
  | "accrue-at-new-fee"
  | "verify-new-burn-rate"
  | "verified";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  phase: Phase;
  newFee: bigint;
  oldFee: bigint;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { operators, cluster } = ctx.state;
  const op = operators[0];

  if (ctx.state.phase === "accrue-at-old-fee") {
    ctx.state.phase = "declare";
    return;
  }

  if (ctx.state.phase === "declare") {
    await ctx.network.connect(op.owner)
      .declareOperatorFee(op.id, ctx.state.newFee);

    ctx.state.phase = "verify-old-fee-still-active";
    return;
  }

  if (ctx.state.phase === "verify-old-fee-still-active") {
    const opData = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opData.fee)).to.equal(ctx.state.oldFee);

    const opFees = operators.map(o => o.fee);
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const vUnits = BigInt(cluster.cluster.validatorCount) * BPS_DENOMINATOR;
    const contractBurnRate = BigInt(
      await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(contractBurnRate).to.equal(computeBurnRate(opFees, networkFee, vUnits));

    ctx.state.phase = "execute-too-early";
    return;
  }

  if (ctx.state.phase === "execute-too-early") {
    await expect(
      ctx.network.connect(op.owner).executeOperatorFee(op.id),
    ).to.be.revertedWithCustomError(ctx.network, Errors.APPROVAL_NOT_WITHIN_TIMEFRAME);

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
    expect(feeEvents.length).to.equal(1);
    expect(feeEvents[0].fee).to.equal(ctx.state.newFee);

    op.fee = ctx.state.newFee;

    ctx.state.phase = "accrue-at-new-fee";
    return;
  }

  if (ctx.state.phase === "accrue-at-new-fee") {
    ctx.state.phase = "verify-new-burn-rate";
    return;
  }

  if (ctx.state.phase === "verify-new-burn-rate") {
    const opFees = operators.map(o => o.fee);
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const vUnits = BigInt(cluster.cluster.validatorCount) * BPS_DENOMINATOR;

    const contractBurnRate = BigInt(
      await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    const expectedBurnRate = computeBurnRate(opFees, networkFee, vUnits);
    expect(contractBurnRate).to.equal(expectedBurnRate);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: operator fee declare → execute → cluster impact (CAT-4-2)", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 12,
        blocksPerTick: { min: 5n, max: 50n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const initialFee = alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE * 2n, MINIMAL_OPERATOR_ETH_FEE * 5n));
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, [initialFee, initialFee, initialFee, initialFee]);

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operators.map(o => o.id),
            3, DEFAULT_ETH_REGISTER_VALUE * 5n,
          );

          const maxAllowed = computeMaxAllowedFee(initialFee);

          const newFee = alignFee(ctx.rng.nextInRange(initialFee + ETH_DEDUCTED_DIGITS, maxAllowed));

          return {
            operators,
            cluster,
            phase: "accrue-at-old-fee" as Phase,
            newFee,
            oldFee: initialFee,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
