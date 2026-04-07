import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import { setupFuzzOracles, type OracleState } from "./core/steps.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import { assertDaoVUnitsMatchCluster, assertEthConservation } from "./core/assertions.ts";
import { computeClusterId, computeEBRoot, commitEBRoot } from "../helpers/oracle.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import { ethers } from "ethers";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  oracle: OracleState;
  phase: string;
  rootABlockNum: number;
  rootBBlockNum: number;
  rootBEB: number;
  tickDepositDelta: bigint;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: Stale root rejection — must use latest root (CAT-3-7)", function () {
  for (const seed of seeds) {
    it(`Validates stale root revert + latest root success with seed=${seed}`, async function () {
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

          const largeDeposit = ethers.parseEther("500");
          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds, 2, largeDeposit,
          );

          return {
            operators,
            cluster,
            oracle: { oracles, lastCommittedBlock: 0n },
            phase: "setup",
            rootABlockNum: 0,
            rootBBlockNum: 0,
            rootBEB: 0,
            tickDepositDelta: 0n,
          };
        },

        steps: [
          {
            name: "phase1-commit-two-roots",
            async fn(ctx) {
              const { cluster, oracle } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);

              const rootAEB = 64;
              const rootA = computeEBRoot(clusterId, rootAEB);
              const blockNum1 = Number(await ctx.provider.getBlockNumber());
              await commitEBRoot(ctx.network, rootA, blockNum1, oracle.oracles);
              ctx.state.rootABlockNum = blockNum1;

              const gap = Number(ctx.rng.nextInRange(10n, 200n));
              await mineBlocks(ctx.provider, gap);

              const rootBEB = Number(ctx.rng.nextInRange(64n, 4096n));
              const rootB = computeEBRoot(clusterId, rootBEB);
              const blockNum2 = Number(await ctx.provider.getBlockNumber());
              await commitEBRoot(ctx.network, rootB, blockNum2, oracle.oracles);
              ctx.state.rootBBlockNum = blockNum2;
              ctx.state.rootBEB = rootBEB;
              oracle.lastCommittedBlock = BigInt(blockNum2);

              const storedRootA = await ctx.views.getCommittedRoot(blockNum1);
              expect(storedRootA).to.equal(rootA);

              const storedRootB = await ctx.views.getCommittedRoot(blockNum2);
              expect(storedRootB).to.equal(rootB);

              ctx.state.phase = "two-roots-committed";
            },
          },

          {
            name: "phase2-stale-revert-then-latest-success",
            async fn(ctx) {
              const { cluster, rootABlockNum, rootBBlockNum, rootBEB } = ctx.state;

              await expect(
                ctx.network.updateClusterBalance(
                  rootABlockNum,
                  cluster.owner.address,
                  cluster.operatorIds,
                  cluster.cluster,
                  64,
                  [],
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.MUST_USE_LATEST_ROOT);

              const tx = await ctx.network.updateClusterBalance(
                rootBBlockNum,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                rootBEB,
                [],
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(BigInt(rootBEB));

              await assertDaoVUnitsMatchCluster(ctx);
              await assertEthConservation(ctx);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              ctx.state.phase = "stale-rejected-latest-accepted";
            },
          },
        ],

        async after(ctx) {
          expect(ctx.state.phase).to.equal("stale-rejected-latest-accepted");
        },
      }, seed);
    });
  }
});
