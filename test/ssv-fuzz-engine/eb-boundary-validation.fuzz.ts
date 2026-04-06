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
