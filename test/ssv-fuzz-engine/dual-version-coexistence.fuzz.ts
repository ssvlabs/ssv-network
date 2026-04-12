import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed, registerFuzzCluster, alignSSVFee } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import { assertSSVConservation, assertVersionExclusivity } from "./core/assertions.ts";
import { DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import { parseClusterFromEvent, extractEventArgs } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { setAccountBalance } from "../helpers/blocks.ts";
import { makePublicKey } from "../helpers/keys.ts";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  DEFAULT_SHARES,
  CLUSTER_VERSION_SSV,
  CLUSTER_VERSION_ETH,
} from "../common/constants.ts";

type Phase = "add-eth-cluster" | "interleave-ops" | "migrate" | "verified";

interface State {
  operators: OperatorRecord[];
  ssvCluster: ClusterRecord;
  ethCluster: ClusterRecord;
  phase: Phase;
  nextKeyOffset: number;
}

async function checkDualTracking(ctx: FuzzContext<State>): Promise<void> {
  const ssvValCount = ctx.state.ssvCluster.cluster.active ? BigInt(ctx.state.ssvCluster.cluster.validatorCount) : 0n;
  const ethValCount = ctx.state.ethCluster.cluster.active ? BigInt(ctx.state.ethCluster.cluster.validatorCount) : 0n;

  for (const op of ctx.state.operators) {
    expect(BigInt((await ctx.views.getOperatorByIdSSV(op.id)).validatorCount)).to.equal(ssvValCount);
    expect(BigInt((await ctx.views.getOperatorById(op.id)).validatorCount)).to.equal(ethValCount);
  }

  if (ctx.state.ssvCluster.cluster.active) {
    await assertSSVConservation(ctx, [ctx.state.ssvCluster], ctx.state.operators.map(o => o.id));
    await assertVersionExclusivity(ctx, [ctx.state.ssvCluster], CLUSTER_VERSION_SSV);
  }
  if (ctx.state.ethCluster.operatorIds.length > 0) {
    await assertVersionExclusivity(ctx, [ctx.state.ethCluster], CLUSTER_VERSION_ETH);
  }
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { ssvCluster, ethCluster } = ctx.state;
  const operatorIds = ctx.state.operators.map(o => o.id);
  const ethOwner = ctx.signers[3];

  if (ctx.state.phase === "add-eth-cluster") {
    const valCount = Number(ctx.rng.nextInRange(2n, 6n));
    const deposit = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE * 3n, DEFAULT_ETH_REGISTER_VALUE * 5n);
    Object.assign(ethCluster, await registerFuzzCluster(
      ctx, ethOwner, ctx.state.operators[0].owner, operatorIds, valCount, deposit, ctx.state.nextKeyOffset,
    ));
    ctx.state.nextKeyOffset += valCount;
    await checkDualTracking(ctx);
    ctx.state.phase = "interleave-ops";
    return;
  }

  if (ctx.state.phase === "interleave-ops") {
    if (ssvCluster.validatorKeys.length > 0) {
      const key = ssvCluster.validatorKeys.splice(0, 1)[0];
      const tx = await ctx.network.connect(ssvCluster.owner).removeValidator(
        key, ssvCluster.operatorIds, ssvCluster.cluster,
      );
      ssvCluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.VALIDATOR_REMOVED);
    }

    const key = makePublicKey(ctx.state.nextKeyOffset++);
    await setAccountBalance(ctx.provider, ethOwner.address, DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n);
    const tx = await ctx.network.connect(ethOwner).bulkRegisterValidator(
      [key], ethCluster.operatorIds, [DEFAULT_SHARES], ethCluster.cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    ethCluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.VALIDATOR_ADDED);
    ethCluster.validatorKeys.push(key);
    await checkDualTracking(ctx);
    ctx.state.phase = "migrate";
    return;
  }

  if (ctx.state.phase === "migrate") {
    const ssvValCount = BigInt(ssvCluster.cluster.validatorCount);
    const ethValCountBefore = BigInt(ethCluster.cluster.validatorCount);
    const ssvBalanceBefore = BigInt(
      await ctx.views.getBalanceSSV(ssvCluster.owner.address, operatorIds, ssvCluster.cluster),
    );
    const ssvBurnRate = BigInt(
      await ctx.views.getBurnRateSSV(ssvCluster.owner.address, operatorIds, ssvCluster.cluster),
    );
    const ownerSSVBefore = BigInt(await ctx.ssvToken.balanceOf(ssvCluster.owner.address));

    const ethDeposit = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE * 3n, DEFAULT_ETH_REGISTER_VALUE * 10n);
    await setAccountBalance(ctx.provider, ssvCluster.owner.address, ethDeposit + 10n ** 18n);

    const tx = await ctx.network.connect(ssvCluster.owner).migrateClusterToETH(
      operatorIds, ssvCluster.cluster, { value: ethDeposit },
    );
    const receipt = await tx.wait();

    const ssvRefund = BigInt(extractEventArgs(ctx.network, receipt, Events.CLUSTER_MIGRATED_TO_ETH).ssvRefunded);
    expect(ssvRefund).to.equal(ssvBalanceBefore - ssvBurnRate);
    expect(BigInt(await ctx.ssvToken.balanceOf(ssvCluster.owner.address)) - ownerSSVBefore).to.equal(ssvRefund);

    ssvCluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

    for (const op of ctx.state.operators) {
      expect(BigInt((await ctx.views.getOperatorByIdSSV(op.id)).validatorCount)).to.equal(0n);
      expect(BigInt((await ctx.views.getOperatorById(op.id)).validatorCount)).to.equal(ethValCountBefore + ssvValCount);
      expect(BigInt((await ctx.views.getOperatorById(op.id)).fee)).to.equal(BigInt(DEFAULT_OPERATOR_ETH_FEE));
    }

    await assertVersionExclusivity(ctx, [ssvCluster], CLUSTER_VERSION_ETH);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: dual-version coexistence — SSV and ETH clusters on shared operators", function () {
  for (const seed of seeds) {
    it(`Validates SSV + ETH cluster dual tracking and version exclusivity on shared operators with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 10,
        blocksPerTick: { min: 20n, max: 200n },

        async setup(ctx) {
          const legacy = await setupLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee: alignSSVFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n)),
            validatorCount: Number(ctx.rng.nextInRange(3n, 6n)),
            ssvDepositPerValidator: ctx.rng.nextInRange(TOKEN_REGISTER_AMOUNT, TOKEN_REGISTER_AMOUNT * 3n),
            preUpgradeBlocks: Number(ctx.rng.nextInRange(50n, 200n)),
          });

          return {
            operators: legacy.operators,
            ssvCluster: {
              cluster: legacy.preUpgradeCluster,
              operatorIds: legacy.operatorIds,
              owner: legacy.clusterOwner,
              validatorKeys: [...legacy.validatorKeys],
            },
            ethCluster: {
              cluster: { validatorCount: 0n, networkFeeIndex: 0n, index: 0n, balance: 0n, active: false },
              operatorIds: [], owner: ctx.signers[3], validatorKeys: [],
            },
            phase: "add-eth-cluster" as Phase,
            nextKeyOffset: 3000,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
