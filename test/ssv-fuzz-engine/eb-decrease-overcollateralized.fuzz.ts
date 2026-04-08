import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import { setupFuzzOracles, type OracleState } from "./core/steps.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  assertDaoVUnitsMatchCluster,
  assertOperatorEarningsWithEB,
  assertNetworkEarningsWithEB,
  assertClusterBalanceWithEB,
  assertEBTransitionSettledAtVUnits,
  type EBTransitionSnapshot,
  getContractEthBalance,
} from "./core/assertions.ts";
import { computeClusterId, computeEBRoot, commitEBRoot } from "../helpers/oracle.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import { ethers } from "ethers";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
  BPS_DENOMINATOR,
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  oracle: OracleState;
  phase: string;
  highEB: number;
  highVUnits: bigint;
  highBurnRate: bigint;
  highEBTransitionSnapshot: EBTransitionSnapshot;
  tickDepositDelta: bigint;
}

function ebToVUnits(effectiveBalance: bigint): bigint {
  const vUnits = effectiveBalance * BPS_DENOMINATOR;
  if (vUnits === 0n) return 0n;
  return (vUnits - 1n) / 32n + 1n;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: EB decrease — cluster becomes over-collateralized (CAT-3-3)", function () {
  for (const seed of seeds) {
    it(`Validates EB decrease with over-collateralization with seed=${seed}`, async function () {
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
            ctx, clusterOwner, operatorOwner, operatorIds, 4, largeDeposit,
          );

          const fuzzedHighEBPerValidator = Number(ctx.rng.nextInRange(64n, 2048n));
          const highEB = 4 * fuzzedHighEBPerValidator;
          const highVUnits = ebToVUnits(BigInt(highEB));

          const blockNum = Number(await ctx.provider.getBlockNumber());
          const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
          const root = computeEBRoot(clusterId, highEB);

          await commitEBRoot(ctx.network, root, blockNum, oracles);
          const lastCommittedBlock = BigInt(blockNum);

          const tx = await ctx.network.updateClusterBalance(
            blockNum,
            cluster.owner.address,
            cluster.operatorIds,
            cluster.cluster,
            highEB,
            [],
          );
          const receipt = await tx.wait();
          cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

          const eb = BigInt(
            await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
          );
          expect(eb).to.equal(BigInt(highEB));

          const highBurnRate = BigInt(
            await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
          );
          const operatorEarnings = new Map<number, bigint>();
          for (const op of operators) {
            operatorEarnings.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
          }
          const highEBTransitionSnapshot: EBTransitionSnapshot = {
            block: BigInt(await ctx.provider.getBlockNumber()),
            clusterBalance: BigInt(cluster.cluster.balance),
            networkEarnings: BigInt(await ctx.views.getNetworkEarnings()),
            operatorEarnings,
          };

          return {
            operators,
            cluster,
            oracle: { oracles, lastCommittedBlock },
            phase: "setup",
            highEB,
            highVUnits,
            highBurnRate,
            highEBTransitionSnapshot,
            tickDepositDelta: 0n,
          };
        },

        steps: [
          {
            name: "phase1-verify-high-eb-accrual",
            async fn(ctx) {
              const { cluster } = ctx.state;

              const preBlocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, preBlocks);

              await assertDaoVUnitsMatchCluster(ctx);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(BigInt(ctx.state.highEB));

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              const clusterBal = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              let totalOpEarnings = 0n;
              for (const op of ctx.state.operators) {
                totalOpEarnings += BigInt(await ctx.views.getOperatorEarnings(op.id));
              }
              const netEarnings = BigInt(await ctx.views.getNetworkEarnings());
              const contractBal = await getContractEthBalance(ctx);
              const dust = contractBal - (clusterBal + totalOpEarnings + netEarnings);
              const maxDust = BigInt(ctx.state.operators.length) * ETH_DEDUCTED_DIGITS;
              expect(dust).to.be.greaterThanOrEqual(0n);
              expect(dust).to.be.lessThanOrEqual(maxDust);

              ctx.state.phase = "high-eb-verified";
            },
          },

          {
            name: "phase2-eb-decrease",
            async fn(ctx) {
              const { cluster, oracle } = ctx.state;

              const fuzzedHighEBPerValidator = ctx.state.highEB / 4;
              const fuzzedLowEBPerValidator = Number(ctx.rng.nextInRange(32n, BigInt(fuzzedHighEBPerValidator - 1)));
              const lowerEB = 4 * fuzzedLowEBPerValidator;

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const root = computeEBRoot(clusterId, lowerEB);

              await commitEBRoot(ctx.network, root, blockNum, oracle.oracles);
              oracle.lastCommittedBlock = BigInt(blockNum);

              const tx = await ctx.network.updateClusterBalance(
                blockNum,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                lowerEB,
                [],
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

              await assertEBTransitionSettledAtVUnits(
                ctx,
                ctx.state.highEBTransitionSnapshot,
                ctx.state.highVUnits,
                BigInt(cluster.cluster.balance),
              );

              const newEB = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(newEB).to.equal(BigInt(lowerEB));

              const expectedLowVUnits = ebToVUnits(BigInt(lowerEB));
              expect(expectedLowVUnits).to.be.lessThan(ctx.state.highVUnits);

              const newBurnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(newBurnRate).to.be.lessThan(ctx.state.highBurnRate);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              await assertDaoVUnitsMatchCluster(ctx);
              await assertOperatorEarningsWithEB(ctx);
              await assertNetworkEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);

              ctx.state.phase = "eb-decreased";
            },
          },

          {
            name: "phase3-verify-lower-burn-accrual",
            async fn(ctx) {
              const { cluster } = ctx.state;

              const postBlocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, postBlocks);

              await assertDaoVUnitsMatchCluster(ctx);
              await assertOperatorEarningsWithEB(ctx);
              await assertNetworkEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(Number(eb)).to.be.lessThan(ctx.state.highEB);
              expect(Number(eb)).to.be.greaterThanOrEqual(128);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              const clusterBal = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              let totalOpEarnings = 0n;
              for (const op of ctx.state.operators) {
                totalOpEarnings += BigInt(await ctx.views.getOperatorEarnings(op.id));
              }
              const netEarnings = BigInt(await ctx.views.getNetworkEarnings());
              const contractBal = await getContractEthBalance(ctx);
              const dust = contractBal - (clusterBal + totalOpEarnings + netEarnings);
              const maxDust = 2n * BigInt(ctx.state.operators.length) * ETH_DEDUCTED_DIGITS;
              expect(dust).to.be.greaterThanOrEqual(0n);
              expect(dust).to.be.lessThanOrEqual(maxDust);

              ctx.state.phase = "lower-burn-verified";
            },
          },
        ],
        expectedPhase: "lower-burn-verified",
      }, seed);
    });
  }
});
