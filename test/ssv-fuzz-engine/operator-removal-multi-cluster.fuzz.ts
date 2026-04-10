import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { setAccountBalance } from "../helpers/blocks.ts";
import { makePublicKey } from "../helpers/keys.ts";
import { computeBurnRate, generateRandomFees, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  BPS_DENOMINATOR,
  DEFAULT_SHARES,
} from "../common/constants.ts";

type Phase =
  | "pre-removal"
  | "remove-shared-op"
  | "verify-post-removal"
  | "operate-both-clusters"
  | "verified";

interface State {
  operators: OperatorRecord[];
  clusterA: ClusterRecord;
  clusterB: ClusterRecord;
  operatorOwner: HardhatEthersSigner;
  removedOpId: number;
  phase: Phase;
  nextKeyOffset: number;
  valCountA: number;
  valCountB: number;
}

async function assertClusterBurnRates(ctx: FuzzContext<State>, clusters: ClusterRecord[], skipEmpty: boolean = false): Promise<void> {
  const networkFee = BigInt(await ctx.views.getNetworkFee());
  for (const c of clusters) {
    if (skipEmpty && BigInt(c.cluster.validatorCount) === 0n) continue;
    const opFees: bigint[] = [];
    for (const opId of c.operatorIds) {
      opFees.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
    }
    const vUnits = BigInt(c.cluster.validatorCount) * BPS_DENOMINATOR;
    const expectedBurnRate = computeBurnRate(opFees, networkFee, vUnits);
    const contractBurnRate = BigInt(
      await ctx.views.getBurnRate(c.owner.address, c.operatorIds, c.cluster),
    );
    expect(contractBurnRate).to.equal(expectedBurnRate);
  }
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { clusterA, clusterB, operators, removedOpId } = ctx.state;

  if (ctx.state.phase === "pre-removal") {
    for (const op of operators) {
      const opData = await ctx.views.getOperatorById(op.id);
      const isShared = clusterA.operatorIds.includes(op.id) && clusterB.operatorIds.includes(op.id);
      const expectedCount = isShared
        ? BigInt(ctx.state.valCountA + ctx.state.valCountB)
        : op.id === operators[3].id
          ? BigInt(ctx.state.valCountA)
          : BigInt(ctx.state.valCountB);
      expect(BigInt(opData.validatorCount)).to.equal(expectedCount);
    }

    ctx.state.phase = "remove-shared-op";
    return;
  }

  if (ctx.state.phase === "remove-shared-op") {
    await ctx.network.connect(ctx.state.operatorOwner).removeOperator(removedOpId);

    const opData = await ctx.views.getOperatorById(removedOpId);
    expect(BigInt(opData.validatorCount)).to.equal(0n);
    expect(BigInt(opData.fee)).to.equal(0n);

    ctx.state.phase = "verify-post-removal";
    return;
  }

  if (ctx.state.phase === "verify-post-removal") {
    await assertClusterBurnRates(ctx, [clusterA, clusterB]);

    const removedEarnings = BigInt(await ctx.views.getOperatorEarnings(removedOpId));
    expect(removedEarnings).to.equal(0n);

    ctx.state.phase = "operate-both-clusters";
    return;
  }

  if (ctx.state.phase === "operate-both-clusters") {
    const removedEarnings = BigInt(await ctx.views.getOperatorEarnings(removedOpId));
    expect(removedEarnings).to.equal(0n);

    const keyA = makePublicKey(ctx.state.nextKeyOffset++);
    await setAccountBalance(ctx.provider, clusterA.owner.address, DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n);
    await expect(
      ctx.network.connect(clusterA.owner).bulkRegisterValidator(
        [keyA], clusterA.operatorIds, [DEFAULT_SHARES], clusterA.cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      ),
    ).to.be.revertedWithCustomError(ctx.network, Errors.OPERATOR_DOES_NOT_EXIST);

    const keyB = makePublicKey(ctx.state.nextKeyOffset++);
    await setAccountBalance(ctx.provider, clusterB.owner.address, DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n);
    await expect(
      ctx.network.connect(clusterB.owner).bulkRegisterValidator(
        [keyB], clusterB.operatorIds, [DEFAULT_SHARES], clusterB.cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      ),
    ).to.be.revertedWithCustomError(ctx.network, Errors.OPERATOR_DOES_NOT_EXIST);

    if (clusterA.validatorKeys.length > 0) {
      const removeKey = clusterA.validatorKeys.splice(0, 1)[0];
      const tx = await ctx.network.connect(clusterA.owner)
        .bulkRemoveValidator([removeKey], clusterA.operatorIds, clusterA.cluster);
      clusterA.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.VALIDATOR_REMOVED);
    }

    if (clusterB.validatorKeys.length > 0) {
      const removeKey = clusterB.validatorKeys.splice(0, 1)[0];
      const tx = await ctx.network.connect(clusterB.owner)
        .bulkRemoveValidator([removeKey], clusterB.operatorIds, clusterB.cluster);
      clusterB.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.VALIDATOR_REMOVED);
    }

    await assertClusterBurnRates(ctx, [clusterA, clusterB], true);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: Operator removal while multiple clusters use it (CAT-4-5)", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 10,
        blocksPerTick: { min: 10n, max: 200n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwnerA, , clusterOwnerB] = ctx.signers;

          const fees = generateRandomFees(ctx, 5);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 5, fees);

          const idsA = [operators[0].id, operators[1].id, operators[2].id, operators[3].id];
          const idsB = [operators[0].id, operators[1].id, operators[2].id, operators[4].id];

          const valCountA = Number(ctx.rng.nextInRange(2n, 5n));
          const valCountB = Number(ctx.rng.nextInRange(2n, 5n));

          const clusterA = await registerFuzzCluster(
            ctx, clusterOwnerA, operatorOwner, idsA,
            valCountA, DEFAULT_ETH_REGISTER_VALUE, 2000,
          );
          const clusterB = await registerFuzzCluster(
            ctx, clusterOwnerB, operatorOwner, idsB,
            valCountB, DEFAULT_ETH_REGISTER_VALUE, 3000,
          );

          const sharedIdx = Number(ctx.rng.nextInRange(0n, 2n));
          const removedOpId = operators[sharedIdx].id;

          return {
            operators, clusterA, clusterB,
            operatorOwner,
            removedOpId,
            phase: "pre-removal" as Phase,
            nextKeyOffset: 5000,
            valCountA, valCountB,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
