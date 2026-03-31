import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import type { ClusterRecord, FuzzContext, OperatorRecord, StepFn } from "./core/types.ts";
import {
  calcLiquidationThreshold,
  defaultVUnits,
  extractEventArgs,
  makePublicKey,
  mineBlocks,
  parseClusterFromEvent,
  setAccountBalance,
  setupLiquidatedLegacyClusterAndUpgrade,
} from "../helpers/index.ts";
import {
  CLUSTER_VERSION_ETH,
  CLUSTER_VERSION_SSV,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";

type Phase = "post-upgrade-liquidated-legacy" | "migrated-reactivated" | "post-migration-complete";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  ssvToken: any;
  phase: Phase;
  migrationEthDeposit: bigint;
  postLiquidationBlocks: bigint;
  postMigrationBlocks: bigint;
  nextKeyOffset: number;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

function assertPreMigrationLiquidatedLegacyState<S extends State>(): StepFn<S> {
  return async function assertPreMigrationLiquidatedLegacyState(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, operators, phase } = ctx.state;
    if (phase !== "post-upgrade-liquidated-legacy") return;

    expect(await ctx.views.getClusterAssetType(cluster.owner.address, cluster.operatorIds)).to.equal(CLUSTER_VERSION_SSV);
    expect(await ctx.views.isLiquidated(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(true);
    expect(cluster.cluster.active).to.equal(false);
    expect(cluster.cluster.balance).to.equal(0n);
    expect(await ctx.views.getNetworkValidatorsCount()).to.equal(0n);

    for (const op of operators) {
      const opSSV = await ctx.views.getOperatorByIdSSV(op.id);
      const opETH = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opSSV.validatorCount)).to.equal(0n);
      expect(BigInt(opETH.validatorCount)).to.equal(0n);
    }
  };
}

function migrateLiquidatedLegacyCluster<S extends State>(): StepFn<S> {
  return async function migrateLiquidatedLegacyCluster(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, operators, ssvToken, phase, migrationEthDeposit } = ctx.state;
    if (phase !== "post-upgrade-liquidated-legacy") return;

    await setAccountBalance(ctx.provider, cluster.owner.address, migrationEthDeposit + 10n ** 18n);

    const ownerSSVBefore = await ssvToken.balanceOf(cluster.owner.address);
    const migrateTx = await ctx.network
      .connect(cluster.owner)
      .migrateClusterToETH(cluster.operatorIds, cluster.cluster, { value: migrationEthDeposit });
    const migrateReceipt = await migrateTx.wait();
    await expect(migrateTx).to.emit(ctx.network, Events.CLUSTER_MIGRATED_TO_ETH);
    await expect(migrateTx).to.emit(ctx.network, Events.CLUSTER_REACTIVATED);

    const migrateEventArgs = extractEventArgs(ctx.network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const migratedCluster = parseClusterFromEvent(ctx.network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const ownerSSVAfter = await ssvToken.balanceOf(cluster.owner.address);

    expect(ownerSSVAfter - ownerSSVBefore).to.equal(0n);
    expect(BigInt(migrateEventArgs.ssvRefunded)).to.equal(0n);
    expect(BigInt(migrateEventArgs.ethDeposited)).to.equal(migrationEthDeposit);

    expect(await ctx.views.getClusterAssetType(cluster.owner.address, cluster.operatorIds)).to.equal(CLUSTER_VERSION_ETH);
    expect(await ctx.views.isLiquidated(cluster.owner.address, cluster.operatorIds, migratedCluster)).to.equal(false);
    await expect(
      ctx.views.getBalanceSSV(cluster.owner.address, cluster.operatorIds, migratedCluster),
    ).to.be.revertedWithCustomError(ctx.views, Errors.INCORRECT_CLUSTER_VERSION);
    expect(await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, migratedCluster)).to.equal(migrationEthDeposit);
    expect(migratedCluster.active).to.equal(true);
    expect(migratedCluster.balance).to.equal(migrationEthDeposit);
    expect(migratedCluster.validatorCount).to.equal(1n);
    expect(await ctx.views.getNetworkValidatorsCount()).to.equal(1n);

    for (const op of operators) {
      const opSSV = await ctx.views.getOperatorByIdSSV(op.id);
      const opETH = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opSSV.validatorCount)).to.equal(0n);
      expect(BigInt(opETH.validatorCount)).to.equal(1n);
      expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
    }

    cluster.cluster = migratedCluster;
    ctx.state.phase = "migrated-reactivated";
  };
}

function runPostMigrationEthLifecycle<S extends State>(): StepFn<S> {
  return async function runPostMigrationEthLifecycle(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, operators, phase, postMigrationBlocks, migrationEthDeposit, nextKeyOffset } = ctx.state;
    if (phase !== "migrated-reactivated") return;

    await mineBlocks(ctx.provider, Number(postMigrationBlocks));

    const burnRate = BigInt(
      await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    const expectedLiveBalance = migrationEthDeposit - (burnRate * postMigrationBlocks);
    expect(await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster)).to.equal(expectedLiveBalance);

    const networkFee = BigInt(await ctx.views.getNetworkFee());
    expect(await ctx.views.getNetworkEarnings()).to.equal(networkFee * postMigrationBlocks);

    for (const op of operators) {
      expect(await ctx.views.getOperatorEarnings(op.id)).to.equal(DEFAULT_OPERATOR_ETH_FEE * postMigrationBlocks);
    }

    const preRegisterBlock = BigInt(await ctx.provider.getBlockNumber());
    await setAccountBalance(ctx.provider, cluster.owner.address, DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n);

    const registerTx = await ctx.network.connect(cluster.owner).registerValidator(
      makePublicKey(nextKeyOffset),
      cluster.operatorIds,
      DEFAULT_SHARES,
      cluster.cluster,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(ctx.network, registerReceipt, Events.VALIDATOR_ADDED);

    const blocksAccruedForRegister = BigInt(registerReceipt!.blockNumber) - preRegisterBlock;
    const expectedBalanceAtRegister =
      migrationEthDeposit -
      (burnRate * (postMigrationBlocks + blocksAccruedForRegister)) +
      DEFAULT_ETH_REGISTER_VALUE;

    expect(clusterAfterRegister.balance).to.equal(expectedBalanceAtRegister);
    expect(clusterAfterRegister.active).to.equal(true);
    expect(clusterAfterRegister.validatorCount).to.equal(2n);
    expect(await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, clusterAfterRegister)).to.equal(expectedBalanceAtRegister);
    expect(await ctx.views.getNetworkValidatorsCount()).to.equal(2n);
    expect(await ctx.views.getNetworkEarnings()).to.equal(
      networkFee * (postMigrationBlocks + blocksAccruedForRegister),
    );

    for (const op of operators) {
      const opSSV = await ctx.views.getOperatorByIdSSV(op.id);
      const opETH = await ctx.views.getOperatorById(op.id);
      expect(BigInt(opSSV.validatorCount)).to.equal(0n);
      expect(BigInt(opETH.validatorCount)).to.equal(2n);
      expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
      expect(await ctx.views.getOperatorEarnings(op.id)).to.equal(
        DEFAULT_OPERATOR_ETH_FEE * (postMigrationBlocks + blocksAccruedForRegister),
      );
    }

    cluster.cluster = clusterAfterRegister;
    cluster.validatorKeys.push(makePublicKey(nextKeyOffset));
    ctx.state.nextKeyOffset += 1;
    ctx.state.phase = "post-migration-complete";
  };
}

describe("Fuzz: CAT-1-2 liquidated legacy cluster migration lifecycle", function () {
  for (const seed of seeds) {
    it(`Validates liquidated legacy migration reactivation with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;
          const postLiquidationBlocks = ctx.rng.nextInRange(0n, 500n);

          const {
            newNetwork,
            newViews,
            ssvToken,
            operatorIds,
            cluster,
            validatorKey,
          } = await setupLiquidatedLegacyClusterAndUpgrade(
            ctx.connection,
            operatorOwner,
            clusterOwner,
            postLiquidationBlocks,
          );

          ctx.network = newNetwork;
          ctx.views = newViews;
          ctx.ssvToken = ssvToken;

          const feeRaw = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
          const networkFeeRaw = BigInt(await ctx.views.getNetworkFee()) / ETH_DEDUCTED_DIGITS;
          const threshold = calcLiquidationThreshold({
            minimumBlocksBeforeLiquidation: BigInt(await ctx.views.getLiquidationThresholdPeriod()),
            numOperators: 4n,
            ethFee: feeRaw,
            networkFee: networkFeeRaw,
            effectiveVUnits: defaultVUnits(1n),
          });
          const migrationEthDeposit = threshold + ctx.rng.nextInRange(0n, DEFAULT_ETH_REGISTER_VALUE);

          return {
            operators: operatorIds.map((id) => ({ id, fee: DEFAULT_OPERATOR_ETH_FEE, owner: operatorOwner })),
            cluster: {
              cluster,
              operatorIds,
              owner: clusterOwner,
              validatorKeys: [validatorKey],
            },
            ssvToken,
            phase: "post-upgrade-liquidated-legacy" as const,
            migrationEthDeposit,
            postLiquidationBlocks,
            postMigrationBlocks: 100n,
            nextKeyOffset: 124,
          };
        },

        steps: [
          assertPreMigrationLiquidatedLegacyState(),
          migrateLiquidatedLegacyCluster(),
          runPostMigrationEthLifecycle(),
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
