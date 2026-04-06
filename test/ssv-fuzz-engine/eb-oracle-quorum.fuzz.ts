import { expect } from "chai";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import { setupFuzzOracles } from "./core/steps.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import { assertDaoVUnitsMatchCluster } from "./core/assertions.ts";
import { computeClusterId, computeEBRoot } from "../helpers/oracle.ts";
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
  allOracles: HardhatEthersSigner[];
  phase: string;
  rootABlockNum: number;
  rootBBlockNum: number;
  rootAEB: number;
  rootBEB: number;
  rootCEB: number;
  shuffledIndices: number[];
  tickDepositDelta: bigint;
}

function hasEvent(network: any, receipt: any, eventName: string): boolean {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = network.interface.parseLog(log);
      if (parsed?.name === eventName) return true;
    } catch { /* skip */ }
  }
  return false;
}

function shuffleArray(arr: number[], rng: any): number[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Number(rng.nextInRange(0n, BigInt(i)));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: Oracle quorum — partial votes, failed quorum, re-voting (CAT-3-8)", function () {
  for (const seed of seeds) {
    it(`Validates oracle quorum mechanism with seed=${seed}`, async function () {
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

          const allOracles = [ctx.signers[16], ctx.signers[17], ctx.signers[18], ctx.signers[19]];
          await setupFuzzOracles(ctx, allOracles);

          const largeDeposit = ethers.parseEther("500");
          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds, 2, largeDeposit,
          );

          const shuffledIndices = shuffleArray([0, 1, 2, 3], ctx.rng);

          const rootAEB = Number(ctx.rng.nextInRange(64n, 4096n));
          const rootBEB = Number(ctx.rng.nextInRange(64n, 2048n));
          const rootCEB = Number(ctx.rng.nextInRange(2049n, 4096n));

          return {
            operators,
            cluster,
            allOracles,
            phase: "setup",
            rootABlockNum: 0,
            rootBBlockNum: 0,
            rootAEB,
            rootBEB,
            rootCEB,
            shuffledIndices,
            tickDepositDelta: 0n,
          };
        },

        steps: [
          {
            name: "phase1-partial-vote-no-commit",
            async fn(ctx) {
              const { cluster, allOracles, shuffledIndices, rootAEB } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const rootA = computeEBRoot(clusterId, rootAEB);

              const blockNum1 = Number(await ctx.provider.getBlockNumber());
              ctx.state.rootABlockNum = blockNum1;

              const tx1 = await ctx.network.connect(allOracles[shuffledIndices[0]]).commitRoot(rootA, blockNum1);
              const receipt1 = await tx1.wait();
              expect(hasEvent(ctx.network, receipt1, Events.WEIGHTED_ROOT_PROPOSED)).to.equal(true);
              expect(hasEvent(ctx.network, receipt1, Events.ROOT_COMMITTED)).to.equal(false);

              const tx2 = await ctx.network.connect(allOracles[shuffledIndices[1]]).commitRoot(rootA, blockNum1);
              const receipt2 = await tx2.wait();
              expect(hasEvent(ctx.network, receipt2, Events.WEIGHTED_ROOT_PROPOSED)).to.equal(true);
              expect(hasEvent(ctx.network, receipt2, Events.ROOT_COMMITTED)).to.equal(false);

              ctx.state.phase = "partial-voted";
            },
          },

          {
            name: "phase2-revote-prevention",
            async fn(ctx) {
              const { allOracles, shuffledIndices, rootAEB, rootABlockNum, cluster } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const rootA = computeEBRoot(clusterId, rootAEB);

              await expect(
                ctx.network.connect(allOracles[shuffledIndices[0]]).commitRoot(rootA, rootABlockNum),
              ).to.be.revertedWithCustomError(ctx.network, Errors.ALREADY_VOTED);

              ctx.state.phase = "revote-blocked";
            },
          },

          {
            name: "phase3-quorum-reached",
            async fn(ctx) {
              const { cluster, allOracles, shuffledIndices, rootAEB, rootABlockNum } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const rootA = computeEBRoot(clusterId, rootAEB);

              const tx3 = await ctx.network.connect(allOracles[shuffledIndices[2]]).commitRoot(rootA, rootABlockNum);
              const receipt3 = await tx3.wait();
              expect(hasEvent(ctx.network, receipt3, Events.WEIGHTED_ROOT_PROPOSED)).to.equal(true);
              expect(hasEvent(ctx.network, receipt3, Events.ROOT_COMMITTED)).to.equal(true);

              const tx = await ctx.network.updateClusterBalance(
                rootABlockNum,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                rootAEB,
                [],
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(BigInt(rootAEB));

              await assertDaoVUnitsMatchCluster(ctx);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              ctx.state.phase = "quorum-reached";
            },
          },

          {
            name: "phase4-competing-roots",
            async fn(ctx) {
              const { cluster, allOracles, shuffledIndices, rootBEB, rootCEB } = ctx.state;
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const rootB = computeEBRoot(clusterId, rootBEB);
              const rootC = computeEBRoot(clusterId, rootCEB);

              const gap = Number(ctx.rng.nextInRange(10n, 200n));
              await mineBlocks(ctx.provider, gap);

              const blockNum2 = Number(await ctx.provider.getBlockNumber());
              ctx.state.rootBBlockNum = blockNum2;

              const txB1 = await ctx.network.connect(allOracles[shuffledIndices[0]]).commitRoot(rootB, blockNum2);
              const rB1 = await txB1.wait();
              expect(hasEvent(ctx.network, rB1, Events.WEIGHTED_ROOT_PROPOSED)).to.equal(true);
              expect(hasEvent(ctx.network, rB1, Events.ROOT_COMMITTED)).to.equal(false);

              const txC1 = await ctx.network.connect(allOracles[shuffledIndices[1]]).commitRoot(rootC, blockNum2);
              const rC1 = await txC1.wait();
              expect(hasEvent(ctx.network, rC1, Events.WEIGHTED_ROOT_PROPOSED)).to.equal(true);
              expect(hasEvent(ctx.network, rC1, Events.ROOT_COMMITTED)).to.equal(false);

              const txB2 = await ctx.network.connect(allOracles[shuffledIndices[2]]).commitRoot(rootB, blockNum2);
              const rB2 = await txB2.wait();
              expect(hasEvent(ctx.network, rB2, Events.WEIGHTED_ROOT_PROPOSED)).to.equal(true);
              expect(hasEvent(ctx.network, rB2, Events.ROOT_COMMITTED)).to.equal(false);

              const txB3 = await ctx.network.connect(allOracles[shuffledIndices[3]]).commitRoot(rootB, blockNum2);
              const rB3 = await txB3.wait();
              expect(hasEvent(ctx.network, rB3, Events.WEIGHTED_ROOT_PROPOSED)).to.equal(true);
              expect(hasEvent(ctx.network, rB3, Events.ROOT_COMMITTED)).to.equal(true);

              const tx = await ctx.network.updateClusterBalance(
                blockNum2,
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

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              ctx.state.phase = "competing-roots-resolved";
            },
          },
        ],

        async after(ctx) {
          expect(ctx.state.phase).to.equal("competing-roots-resolved");
        },
      }, seed);
    });
  }
});
