import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed, alignSSVFee, registerFuzzCluster, alignFee, registerFuzzOperators } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { setAccountBalance } from "../helpers/blocks.ts";
import { computeClusterBalance, computeSSVClusterBalance, computeBurnRate, generateRandomFees } from "./core/fuzz-helpers.ts";
import { assertSSVConservation } from "./core/assertions.ts";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  MINIMAL_OPERATOR_ETH_FEE,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  ETH_DEDUCTED_DIGITS,
  DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
} from "../common/constants.ts";


interface FeeSnapshot { block: bigint; balance: bigint; networkFee: bigint }

interface State {
  ssvCluster: ClusterRecord;
  ssvOperators: OperatorRecord[];
  ssvFee: bigint;
  ethCluster: ClusterRecord;
  ethOperators: OperatorRecord[];
  lastEthSnapshot?: FeeSnapshot;
  lastSSVSnapshot?: FeeSnapshot;
}

async function changeETHNetworkFee(ctx: FuzzContext<State>): Promise<void> {
  await ctx.network.updateNetworkFee(
    alignFee(ctx.rng.nextInRange(ETH_DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS * 100n)),
  );
  ctx.state.lastEthSnapshot = undefined;
}

async function changeSSVNetworkFee(ctx: FuzzContext<State>): Promise<void> {
  await ctx.network.updateNetworkFeeSSV(
    alignSSVFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n)),
  );
  ctx.state.lastSSVSnapshot = undefined;
}

async function depositToETHCluster(ctx: FuzzContext<State>): Promise<void> {
  const { ethCluster } = ctx.state;
  const amount = ctx.rng.nextInRange(ETH_DEDUCTED_DIGITS, DEFAULT_ETH_REGISTER_VALUE);
  await setAccountBalance(ctx.provider, ethCluster.owner.address, amount + 10n ** 18n);

  const tx = await ctx.network
    .connect(ethCluster.owner)
    .deposit(ethCluster.owner.address, ethCluster.operatorIds, ethCluster.cluster, { value: amount });
  ethCluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_DEPOSITED);
  ctx.state.lastEthSnapshot = undefined;
}

async function snapshotAndVerifySSV(ctx: FuzzContext<State>): Promise<void> {
  const { ssvCluster, ssvOperators, ssvFee } = ctx.state;
  const block = BigInt(await ctx.provider.getBlockNumber());
  const balance = BigInt(
    await ctx.views.getBalanceSSV(ssvCluster.owner.address, ssvCluster.operatorIds, ssvCluster.cluster),
  );

  if (ctx.state.lastSSVSnapshot) {
    const prev = ctx.state.lastSSVSnapshot;
    expect(balance).to.equal(computeSSVClusterBalance(
      prev.balance, ssvOperators.map(() => ssvFee), prev.networkFee,
      BigInt(ssvCluster.cluster.validatorCount), block - prev.block,
    ));
  }

  ctx.state.lastSSVSnapshot = { block, balance, networkFee: BigInt(await ctx.views.getNetworkFeeSSV()) };
}

async function snapshotAndVerifyETH(ctx: FuzzContext<State>): Promise<void> {
  const { ethCluster, ethOperators } = ctx.state;
  const block = BigInt(await ctx.provider.getBlockNumber());
  const balance = BigInt(
    await ctx.views.getBalance(ethCluster.owner.address, ethCluster.operatorIds, ethCluster.cluster),
  );

  if (ctx.state.lastEthSnapshot) {
    const prev = ctx.state.lastEthSnapshot;
    const vUnits = BigInt(ethCluster.cluster.validatorCount) * BPS_DENOMINATOR;
    expect(balance).to.equal(computeClusterBalance(
      prev.balance, ethOperators.map(op => op.fee), prev.networkFee, vUnits, block - prev.block,
    ));
  }

  ctx.state.lastEthSnapshot = { block, balance, networkFee: BigInt(await ctx.views.getNetworkFee()) };
}

async function checkFeeIndependence(ctx: FuzzContext<State>): Promise<void> {
  const ethFee = BigInt(await ctx.views.getNetworkFee());
  const ssvFee = BigInt(await ctx.views.getNetworkFeeSSV());
  expect(ethFee % ETH_DEDUCTED_DIGITS).to.equal(0n);
  expect(ssvFee % DEDUCTED_DIGITS).to.equal(0n);

  const { ethCluster, ethOperators } = ctx.state;
  const valCount = BigInt(ethCluster.cluster.validatorCount);
  if (valCount > 0n) {
    const vUnits = valCount * BPS_DENOMINATOR;
    expect(BigInt(await ctx.views.getBurnRate(ethCluster.owner.address, ethCluster.operatorIds, ethCluster.cluster)))
      .to.equal(computeBurnRate(ethOperators.map(op => op.fee), ethFee, vUnits));
  }
}

async function checkSSVConservation(ctx: FuzzContext<State>): Promise<void> {
  const { ssvCluster, ssvOperators } = ctx.state;
  await assertSSVConservation(ctx, [ssvCluster], ssvOperators.map(o => o.id));
}

const ACTIONS = [
  { fn: changeETHNetworkFee, weight: 10 },
  { fn: changeSSVNetworkFee, weight: 10 },
  { fn: depositToETHCluster, weight: 5 },
  { fn: snapshotAndVerifySSV, weight: 8 },
  { fn: snapshotAndVerifyETH, weight: 8 },
  { fn: checkFeeIndependence, weight: 10 },
  { fn: checkSSVConservation, weight: 8 },
];
const WEIGHTS = ACTIONS.map(a => a.weight);

const seeds = generateSeeds(10);

describe("Fuzz: dual-cluster — SSV and ETH fee independence", function () {
  for (const seed of seeds) {
    it(`Validates SSV and ETH network fee independence across dual clusters with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 50,
        blocksPerTick: { min: 10n, max: 200n },

        async setup(ctx) {
          const legacy = await setupLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee: alignSSVFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n)),
            validatorCount: 3,
            ssvDepositPerValidator: ctx.rng.nextInRange(TOKEN_REGISTER_AMOUNT, TOKEN_REGISTER_AMOUNT * 3n),
            preUpgradeBlocks: Number(ctx.rng.nextInRange(50n, 200n)),
          });

          const ssvCluster: ClusterRecord = {
            cluster: legacy.preUpgradeCluster,
            operatorIds: legacy.operatorIds,
            owner: legacy.clusterOwner,
            validatorKeys: [...legacy.validatorKeys],
          };

          const ethOpOwner = ctx.signers[3];
          const ethClusterOwner = ctx.signers[4];

          const ethFees = generateRandomFees(ctx, 4);
          const ethOperators = await registerFuzzOperators(ctx, ethOpOwner, 4, ethFees, 3000);

          const ethCluster = await registerFuzzCluster(
            ctx, ethClusterOwner, ethOpOwner, ethOperators.map(o => o.id), 3, DEFAULT_ETH_REGISTER_VALUE, 5000,
          );

          return { ssvCluster, ssvOperators: legacy.operators, ssvFee: legacy.ssvFee, ethCluster, ethOperators };
        },

        steps: [async (ctx) => { await ACTIONS[ctx.rng.weightedIndex(WEIGHTS)].fn(ctx); }],
      }, seed);
    });
  }
});
