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
import { assertEthConservation } from "./core/assertions.ts";
import { computeBurnRate, generateRandomFees, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  BPS_DENOMINATOR,
  DEFAULT_SHARES,
} from "../common/constants.ts";

type OpName = "withdraw" | "removeOperator" | "registerValidator";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  operatorOwner: HardhatEthersSigner;
  nextKeyOffset: number;
  removedOpIdx: number;
  operatorRemoved: boolean;
  opOrder: OpName[];
  opsCompleted: number;
  phase: string;
}

const OP_FNS: Record<OpName, (ctx: FuzzContext<State>) => Promise<void>> = {
  async withdraw(ctx) {
    const { cluster } = ctx.state;
    const balance = BigInt(
      await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    if (balance === 0n) return;

    const amount = (balance * ctx.rng.nextInRange(5n, 15n)) / 100n;
    if (amount === 0n) return;

    try {
      const tx = await ctx.network.connect(cluster.owner)
        .withdraw(cluster.operatorIds, amount, cluster.cluster);
      cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_WITHDRAWN);
    } catch {}
  },

  async removeOperator(ctx) {
    if (ctx.state.operatorRemoved) return;

    const op = ctx.state.operators[ctx.state.removedOpIdx];
    await ctx.network.connect(ctx.state.operatorOwner).removeOperator(op.id);
    ctx.state.operatorRemoved = true;

    const opData = await ctx.views.getOperatorById(op.id);
    expect(BigInt(opData.fee)).to.equal(0n);
    expect(BigInt(opData.validatorCount)).to.equal(0n);
    expect(BigInt(await ctx.views.getOperatorEarnings(op.id))).to.equal(0n);
  },

  async registerValidator(ctx) {
    const { cluster } = ctx.state;
    const key = makePublicKey(ctx.state.nextKeyOffset++);
    await setAccountBalance(ctx.provider, cluster.owner.address, DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n);

    if (ctx.state.operatorRemoved) {
      await expect(
        ctx.network.connect(cluster.owner)
          .bulkRegisterValidator([key], cluster.operatorIds, [DEFAULT_SHARES], cluster.cluster, {
            value: DEFAULT_ETH_REGISTER_VALUE,
          }),
      ).to.be.revertedWithCustomError(ctx.network, Errors.OPERATOR_DOES_NOT_EXIST);
    } else {
      const tx = await ctx.network.connect(cluster.owner)
        .bulkRegisterValidator([key], cluster.operatorIds, [DEFAULT_SHARES], cluster.cluster, {
          value: DEFAULT_ETH_REGISTER_VALUE,
        });
      cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.VALIDATOR_ADDED);
      cluster.validatorKeys.push(key);
    }
  },
};

async function executionStep(ctx: FuzzContext<State>): Promise<void> {
  if (ctx.state.opsCompleted >= ctx.state.opOrder.length) {
    ctx.state.phase = "verified";
    return;
  }

  await OP_FNS[ctx.state.opOrder[ctx.state.opsCompleted]](ctx);
  ctx.state.opsCompleted++;

  const { cluster, operators, removedOpIdx, operatorRemoved } = ctx.state;
  const valCount = BigInt(cluster.cluster.validatorCount);

  if (cluster.cluster.active && valCount > 0n) {
    const opFees: bigint[] = [];
    for (const opId of cluster.operatorIds) {
      opFees.push(BigInt((await ctx.views.getOperatorById(opId)).fee));
    }
    const networkFee = BigInt(await ctx.views.getNetworkFee());
    const vUnits = valCount * BPS_DENOMINATOR;
    expect(BigInt(await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster)))
      .to.equal(computeBurnRate(opFees, networkFee, vUnits));

    for (let i = 0; i < operators.length; i++) {
      const opData = await ctx.views.getOperatorById(operators[i].id);
      if (i === removedOpIdx && operatorRemoved) {
        expect(BigInt(opData.validatorCount)).to.equal(0n);
      } else {
        expect(BigInt(opData.validatorCount)).to.equal(valCount);
      }
    }

    await assertEthConservation(ctx);
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: operator removal interleaved with cluster operations", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 5,
        blocksPerTick: { min: 10n, max: 100n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const fees = generateRandomFees(ctx, 4);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees);

          return {
            operators,
            cluster: await registerFuzzCluster(
              ctx, clusterOwner, operatorOwner, operators.map(o => o.id),
              5, DEFAULT_ETH_REGISTER_VALUE * 5n,
            ),
            operatorOwner,
            nextKeyOffset: 5000,
            removedOpIdx: Number(ctx.rng.nextInRange(0n, 3n)),
            operatorRemoved: false,
            opOrder: ctx.rng.shuffle(["withdraw", "removeOperator", "registerValidator"] as OpName[]),
            opsCompleted: 0,
            phase: "executing",
          };
        },

        steps: [executionStep],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
