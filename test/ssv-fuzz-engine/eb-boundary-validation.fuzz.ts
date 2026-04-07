import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import { setupFuzzOracles, type OracleState } from "./core/steps.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import type {
  EBOperatorEarningsSnapshot,
  EBClusterBalanceSnapshot,
} from "./core/assertions.ts";
import {
  assertDaoVUnitsMatchCluster,
  assertOperatorEarningsWithEB,
  assertClusterBalanceWithEB,
} from "./core/assertions.ts";
import { computeClusterId, computeEBRoot, commitEBRoot } from "../helpers/oracle.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { setupTestContext } from "../helpers/context.ts";
import { ssvNetworkFullFixture } from "../setup/fixtures.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import { ethers } from "ethers";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
  BPS_DENOMINATOR,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  oracle: OracleState;
  phase: string;
  validatorCount: bigint;
  exactMin: bigint;
  exactMax: bigint;
  lastEBOperatorEarnings?: EBOperatorEarningsSnapshot;
  lastEBClusterBalance?: EBClusterBalanceSnapshot;
  tickDepositDelta: bigint;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: EB boundary validation — revert at limits, succeed at exact boundaries (CAT-3-6)", function () {
  it("deterministic 3-validator anchor (exact catalog boundaries 95/96/6144/6145)", async function () {
    const { connection, networkHelpers, signers } = await setupTestContext();
    const anchorFixture = async () => ssvNetworkFullFixture(connection);
    const { network, views, ssvToken } = await networkHelpers.loadFixture(anchorFixture);

    const [, operatorOwner, clusterOwner, oracleSigner] = signers;
    const provider = connection.ethers.provider;

    const dummyCtx: any = {
      connection,
      networkHelpers,
      provider,
      network,
      views,
      ssvToken,
      signers,
      state: { cluster: undefined as any, operators: [] as OperatorRecord[] },
    };

    const fees = [
      MINIMAL_OPERATOR_ETH_FEE,
      MINIMAL_OPERATOR_ETH_FEE * 2n,
      MINIMAL_OPERATOR_ETH_FEE * 3n,
      MINIMAL_OPERATOR_ETH_FEE * 4n,
    ].map(alignFee);

    const operators = await registerFuzzOperators(dummyCtx, operatorOwner, 4, fees, false);
    const operatorIds = operators.map((o) => o.id);

    await ssvToken.mint(oracleSigner.address, STAKE_AMOUNT);
    await ssvToken.connect(oracleSigner).approve(await network.getAddress(), STAKE_AMOUNT);
    await network.connect(oracleSigner).stake(STAKE_AMOUNT);

    const oracles = [signers[17], signers[18], signers[19]];
    await setupFuzzOracles(dummyCtx, oracles);

    const validatorCount = 3;
    const largeDeposit = ethers.parseEther("500");
    const cluster = await registerFuzzCluster(
      dummyCtx, clusterOwner, operatorOwner, operatorIds, validatorCount, largeDeposit,
    );
    dummyCtx.state.cluster = cluster;
    dummyCtx.state.operators = operators;

    const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);

    // Phase 1: below minimum -> revert (95 < 3*32 = 96)
    let blockNum = Number(await provider.getBlockNumber());
    let root = computeEBRoot(clusterId, 95);
    await commitEBRoot(network, root, blockNum, oracles);
    await expect(
      network.updateClusterBalance(blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, 95, []),
    ).to.be.revertedWithCustomError(network, Errors.EB_BELOW_MINIMUM);

    // Phase 2: above maximum -> revert (6145 > 3*2048 = 6144)
    await mineBlocks(provider, 1);
    blockNum = Number(await provider.getBlockNumber());
    root = computeEBRoot(clusterId, 6145);
    await commitEBRoot(network, root, blockNum, oracles);
    await expect(
      network.updateClusterBalance(blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, 6145, []),
    ).to.be.revertedWithCustomError(network, Errors.EB_EXCEEDS_MAXIMUM);

    // Phase 3a: exact minimum -> success (96 == 3*32)
    await mineBlocks(provider, 1);
    blockNum = Number(await provider.getBlockNumber());
    root = computeEBRoot(clusterId, 96);
    await commitEBRoot(network, root, blockNum, oracles);
    let tx = await network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, 96, [],
    );
    let receipt = await tx.wait();
    cluster.cluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
    let eb = BigInt(await views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));
    expect(eb).to.equal(96n);
    await assertDaoVUnitsMatchCluster(dummyCtx);

    // Phase 3b: exact maximum -> success (6144 == 3*2048)
    await mineBlocks(provider, 1);
    blockNum = Number(await provider.getBlockNumber());
    root = computeEBRoot(clusterId, 6144);
    await commitEBRoot(network, root, blockNum, oracles);
    tx = await network.updateClusterBalance(
      blockNum, cluster.owner.address, cluster.operatorIds, cluster.cluster, 6144, [],
    );
    receipt = await tx.wait();
    cluster.cluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
    eb = BigInt(await views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster));
    expect(eb).to.equal(6144n);
    await assertDaoVUnitsMatchCluster(dummyCtx);

    const isLiq = await views.isLiquidatable(cluster.owner.address, cluster.operatorIds, cluster.cluster);
    expect(isLiq).to.equal(false);
  });

  for (const seed of seeds) {
    it(`Validates EB boundary enforcement with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner, oracleSigner] = ctx.signers;

          const fees: bigint[] = [];
          for (let i = 0; i < 4; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees, false);
          const operatorIds = operators.map((o) => o.id);

          await ctx.ssvToken.mint(oracleSigner.address, STAKE_AMOUNT);
          await ctx.ssvToken.connect(oracleSigner).approve(await ctx.network.getAddress(), STAKE_AMOUNT);
          await ctx.network.connect(oracleSigner).stake(STAKE_AMOUNT);

          const oracles = [ctx.signers[17], ctx.signers[18], ctx.signers[19]];
          await setupFuzzOracles(ctx, oracles);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 10n));
          const largeDeposit = ethers.parseEther("500");
          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds, validatorCount, largeDeposit,
          );

          const exactMin = BigInt(validatorCount) * 32n;
          const exactMax = BigInt(validatorCount) * 2048n;

          return {
            operators,
            cluster,
            oracle: { oracles, lastCommittedBlock: 0n },
            phase: "setup",
            validatorCount: BigInt(validatorCount),
            exactMin,
            exactMax,
            tickDepositDelta: 0n,
          };
        },

        steps: [
          {
            name: "phase1-below-minimum-revert",
            async fn(ctx) {
              const { cluster, oracle, exactMin } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);

              const maxOffset = exactMin - 1n < 31n ? exactMin - 1n : 31n;
              const belowOffset = ctx.rng.nextInRange(1n, maxOffset);
              const belowEB = Number(exactMin - belowOffset);

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const root = computeEBRoot(clusterId, belowEB);
              await commitEBRoot(ctx.network, root, blockNum, oracle.oracles);
              oracle.lastCommittedBlock = BigInt(blockNum);

              await expect(
                ctx.network.updateClusterBalance(
                  blockNum,
                  cluster.owner.address,
                  cluster.operatorIds,
                  cluster.cluster,
                  belowEB,
                  [],
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.EB_BELOW_MINIMUM);

              ctx.state.phase = "below-min-reverted";
            },
          },

          {
            name: "phase2-above-maximum-revert",
            async fn(ctx) {
              const { cluster, oracle, exactMax } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);

              await mineBlocks(ctx.provider, 1);

              const aboveOffset = ctx.rng.nextInRange(1n, 1000n);
              const aboveEB = Number(exactMax + aboveOffset);

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const root = computeEBRoot(clusterId, aboveEB);
              await commitEBRoot(ctx.network, root, blockNum, oracle.oracles);
              oracle.lastCommittedBlock = BigInt(blockNum);

              await expect(
                ctx.network.updateClusterBalance(
                  blockNum,
                  cluster.owner.address,
                  cluster.operatorIds,
                  cluster.cluster,
                  aboveEB,
                  [],
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.EB_EXCEEDS_MAXIMUM);

              ctx.state.phase = "above-max-reverted";
            },
          },

          {
            name: "phase3a-exact-minimum-success",
            async fn(ctx) {
              const { cluster, oracle, exactMin } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);

              await mineBlocks(ctx.provider, 1);

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const root = computeEBRoot(clusterId, Number(exactMin));
              await commitEBRoot(ctx.network, root, blockNum, oracle.oracles);
              oracle.lastCommittedBlock = BigInt(blockNum);

              const tx = await ctx.network.updateClusterBalance(
                blockNum,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                Number(exactMin),
                [],
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(exactMin);

              await assertDaoVUnitsMatchCluster(ctx);

              ctx.state.phase = "exact-min-verified";
            },
          },

          {
            name: "phase3b-exact-maximum-success",
            async fn(ctx) {
              const { cluster, oracle, exactMax } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);

              await mineBlocks(ctx.provider, 1);

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const root = computeEBRoot(clusterId, Number(exactMax));
              await commitEBRoot(ctx.network, root, blockNum, oracle.oracles);
              oracle.lastCommittedBlock = BigInt(blockNum);

              const tx = await ctx.network.updateClusterBalance(
                blockNum,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                Number(exactMax),
                [],
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(exactMax);

              await assertDaoVUnitsMatchCluster(ctx);
              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              ctx.state.phase = "exact-max-verified";
            },
          },
        ],

        async after(ctx) {
          expect(ctx.state.phase).to.equal("exact-max-verified");
        },
      }, seed);
    });
  }
});
