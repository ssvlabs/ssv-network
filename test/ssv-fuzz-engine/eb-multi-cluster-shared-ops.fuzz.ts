import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import { setupFuzzOracles, type OracleState } from "./core/steps.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
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
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";

interface State {
  clusterA: ClusterRecord;
  clusterB: ClusterRecord;
  operators: OperatorRecord[];
  oracle: OracleState;
  phase: string;
  ebA: number;
  ebB: number;
  validatorCountA: number;
  validatorCountB: number;
  burnRateAAfterEB: bigint;
  burnRateBBeforeEB: bigint;
}

function ebToVUnits(effectiveBalance: bigint): bigint {
  const vUnits = effectiveBalance * BPS_DENOMINATOR;
  if (vUnits === 0n) return 0n;
  return (vUnits - 1n) / 32n + 1n;
}

function computeExpectedBurnRate(
  clusterOps: OperatorRecord[],
  networkFee: bigint,
  vUnits: bigint,
): bigint {
  let opFeeSum = 0n;
  for (const op of clusterOps) {
    opFeeSum += op.fee;
  }
  return ((networkFee + opFeeSum) * vUnits) / BPS_DENOMINATOR;
}

function computeOperatorEarningsDelta(
  packedFee: bigint,
  blocks: bigint,
  effectiveVUnits: bigint,
): bigint {
  const blockDiffEthFee = blocks * packedFee;
  const deltaPacked = (blockDiffEthFee * effectiveVUnits) / BPS_DENOMINATOR;
  return deltaPacked * ETH_DEDUCTED_DIGITS;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: Multiple clusters with different EBs sharing operators (CAT-3-10)", function () {
  for (const seed of seeds) {
    it(`Validates multi-cluster EB isolation with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwnerA, clusterOwnerB, oracleSigner] = ctx.signers;

          const fees: bigint[] = [];
          for (let i = 0; i < 5; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, 5, fees, false);

          const opsA = [operators[0].id, operators[1].id, operators[2].id, operators[3].id];
          const opsB = [operators[0].id, operators[1].id, operators[2].id, operators[4].id];

          const validatorCountA = Number(ctx.rng.nextInRange(2n, 5n));
          const validatorCountB = Number(ctx.rng.nextInRange(1n, 4n));

          const largeDeposit = ethers.parseEther("500");
          const clusterA = await registerFuzzCluster(
            ctx, clusterOwnerA, operatorOwner, opsA, validatorCountA, largeDeposit, 2000,
          );
          const clusterB = await registerFuzzCluster(
            ctx, clusterOwnerB, operatorOwner, opsB, validatorCountB, largeDeposit, 3000,
          );

          await ctx.ssvToken.mint(oracleSigner.address, STAKE_AMOUNT);
          await ctx.ssvToken.connect(oracleSigner).approve(await ctx.network.getAddress(), STAKE_AMOUNT);
          await ctx.network.connect(oracleSigner).stake(STAKE_AMOUNT);

          const oracles = [ctx.signers[17], ctx.signers[18], ctx.signers[19]];
          await setupFuzzOracles(ctx, oracles);

          const burnRateBBeforeEB = BigInt(
            await ctx.views.getBurnRate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
          );

          const ebAPerValidator = Number(ctx.rng.nextInRange(33n, 256n));
          const ebA = validatorCountA * ebAPerValidator;

          return {
            clusterA,
            clusterB,
            operators,
            oracle: { oracles, lastCommittedBlock: 0n },
            phase: "setup",
            ebA,
            ebB: 32 * validatorCountB,
            validatorCountA,
            validatorCountB,
            burnRateAAfterEB: 0n,
            burnRateBBeforeEB,
          };
        },

        steps: [
          {
            name: "phase1-update-A-high-eb",
            async fn(ctx) {
              const { clusterA, clusterB, operators, oracle } = ctx.state;

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const clusterIdA = computeClusterId(clusterA.owner.address, clusterA.operatorIds);
              const rootA = computeEBRoot(clusterIdA, ctx.state.ebA);
              await commitEBRoot(ctx.network, rootA, blockNum, oracle.oracles);

              const tx = await ctx.network.connect(clusterA.owner).updateClusterBalance(
                blockNum, clusterA.owner.address, clusterA.operatorIds, clusterA.cluster, ctx.state.ebA, [],
              );
              const receipt = await tx.wait();
              clusterA.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);
              oracle.lastCommittedBlock = BigInt(blockNum);

              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const opsARecords = [operators[0], operators[1], operators[2], operators[3]];
              const expectedVUnitsA = ebToVUnits(BigInt(ctx.state.ebA));
              const expectedBurnRateA = computeExpectedBurnRate(opsARecords, networkFee, expectedVUnitsA);
              const actualBurnRateA = BigInt(
                await ctx.views.getBurnRate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
              );
              expect(actualBurnRateA).to.equal(expectedBurnRateA, "Cluster A burn rate must match ebToVUnits(ebA)");
              ctx.state.burnRateAAfterEB = actualBurnRateA;

              const actualBurnRateB = BigInt(
                await ctx.views.getBurnRate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
              );
              expect(actualBurnRateB).to.equal(
                ctx.state.burnRateBBeforeEB,
                "Cluster B burn rate must be unchanged after A's EB update",
              );

              const op5Data = await ctx.views.getOperatorById(operators[4].id);
              expect(BigInt(op5Data.validatorCount)).to.equal(
                BigInt(ctx.state.validatorCountB),
                "Op5 (exclusive to B) validator count must be unchanged",
              );

              const expectedShared = BigInt(ctx.state.validatorCountA + ctx.state.validatorCountB);
              for (let i = 0; i < 3; i++) {
                const opData = await ctx.views.getOperatorById(operators[i].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  expectedShared,
                  `Shared op[${i}] validator count must be sum of both clusters`,
                );
              }

              ctx.state.phase = "A-eb-updated";
            },
          },

          {
            name: "phase1b-deviation-earnings-proof",
            async fn(ctx) {
              const { operators } = ctx.state;

              const earningsBefore = new Map<number, bigint>();
              for (let i = 0; i < 5; i++) {
                earningsBefore.set(i, BigInt(await ctx.views.getOperatorEarnings(operators[i].id)));
              }

              const probeBlocks = 20n;
              await mineBlocks(ctx.provider, Number(probeBlocks));

              const deviationA = ebToVUnits(BigInt(ctx.state.ebA)) - BigInt(ctx.state.validatorCountA) * BPS_DENOMINATOR;
              const sharedEffective = deviationA + BigInt(ctx.state.validatorCountA + ctx.state.validatorCountB) * BPS_DENOMINATOR;
              const op4Effective = deviationA + BigInt(ctx.state.validatorCountA) * BPS_DENOMINATOR;
              const op5Effective = BigInt(ctx.state.validatorCountB) * BPS_DENOMINATOR;

              const expectedEffective = [sharedEffective, sharedEffective, sharedEffective, op4Effective, op5Effective];

              for (let i = 0; i < 5; i++) {
                const earningsAfter = BigInt(await ctx.views.getOperatorEarnings(operators[i].id));
                const actualDelta = earningsAfter - earningsBefore.get(i)!;
                const packedFee = operators[i].fee / ETH_DEDUCTED_DIGITS;
                const expectedDelta = computeOperatorEarningsDelta(packedFee, probeBlocks, expectedEffective[i]);
                expect(actualDelta).to.equal(
                  expectedDelta,
                  `Op[${i}] earnings delta must match effectiveVUnits=${expectedEffective[i]} (proves operatorEthVUnits deviation)`,
                );
              }

              ctx.state.phase = "deviation-earnings-proved";
            },
          },

          {
            name: "phase2-update-B-baseline-eb",
            async fn(ctx) {
              const { clusterA, clusterB, operators, oracle } = ctx.state;

              await mineBlocks(ctx.provider, 1);

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const clusterIdB = computeClusterId(clusterB.owner.address, clusterB.operatorIds);
              const rootB = computeEBRoot(clusterIdB, ctx.state.ebB);
              await commitEBRoot(ctx.network, rootB, blockNum, oracle.oracles);

              const tx = await ctx.network.connect(clusterB.owner).updateClusterBalance(
                blockNum, clusterB.owner.address, clusterB.operatorIds, clusterB.cluster, ctx.state.ebB, [],
              );
              const receipt = await tx.wait();
              clusterB.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);
              oracle.lastCommittedBlock = BigInt(blockNum);

              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const opsBRecords = [operators[0], operators[1], operators[2], operators[4]];
              const expectedVUnitsB = ebToVUnits(BigInt(ctx.state.ebB));
              const expectedBurnRateB = computeExpectedBurnRate(opsBRecords, networkFee, expectedVUnitsB);
              const actualBurnRateB = BigInt(
                await ctx.views.getBurnRate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
              );
              expect(actualBurnRateB).to.equal(expectedBurnRateB, "Cluster B burn rate must match ebToVUnits(ebB)");

              const actualBurnRateA = BigInt(
                await ctx.views.getBurnRate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
              );
              expect(actualBurnRateA).to.equal(
                ctx.state.burnRateAAfterEB,
                "Cluster A burn rate must be unchanged after B's EB update",
              );

              ctx.state.phase = "B-eb-updated";
            },
          },

          {
            name: "phase3-liquidate-A-verify-B",
            async fn(ctx) {
              const { clusterA, clusterB, operators } = ctx.state;
              const thirdParty = ctx.signers[10];

              const burnRateBBeforeLiq = BigInt(
                await ctx.views.getBurnRate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
              );

              const burnRateA = BigInt(
                await ctx.views.getBurnRate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
              );
              const balanceA = BigInt(
                await ctx.views.getBalance(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
              );
              const blocksToLiq = Number(balanceA / burnRateA) + 1;
              await mineBlocks(ctx.provider, blocksToLiq);

              const isLiq = await ctx.views.isLiquidatable(
                clusterA.owner.address, clusterA.operatorIds, clusterA.cluster,
              );
              expect(isLiq).to.equal(true, "Cluster A must be liquidatable");

              const liqTx = await ctx.network.connect(thirdParty).liquidate(
                clusterA.owner.address, clusterA.operatorIds, clusterA.cluster,
              );
              const liqReceipt = await liqTx.wait();
              clusterA.cluster = parseClusterFromEvent(ctx.network, liqReceipt, Events.CLUSTER_LIQUIDATED);

              expect(clusterA.cluster.active).to.equal(false);
              expect(BigInt(clusterA.cluster.balance)).to.equal(0n);

              await expect(
                ctx.views.getBalance(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
              ).to.be.revertedWithCustomError(ctx.network, Errors.CLUSTER_IS_LIQUIDATED);

              const burnRateBAfterLiq = BigInt(
                await ctx.views.getBurnRate(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
              );
              expect(burnRateBAfterLiq).to.equal(
                burnRateBBeforeLiq,
                "Cluster B burn rate must be unchanged after A's liquidation",
              );

              const balanceB = BigInt(
                await ctx.views.getBalance(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
              );
              expect(balanceB).to.be.greaterThan(0n, "Cluster B must still have balance");

              const isLiqB = await ctx.views.isLiquidatable(
                clusterB.owner.address, clusterB.operatorIds, clusterB.cluster,
              );
              expect(isLiqB).to.equal(false, "Cluster B must not be liquidatable");

              for (let i = 0; i < 3; i++) {
                const opData = await ctx.views.getOperatorById(operators[i].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  BigInt(ctx.state.validatorCountB),
                  `Shared op[${i}] count must equal B's validator count after A liquidated`,
                );
              }

              const op4Data = await ctx.views.getOperatorById(operators[3].id);
              expect(BigInt(op4Data.validatorCount)).to.equal(
                0n,
                "Op4 (exclusive to A) must have 0 validators after A liquidated",
              );

              const op5Data = await ctx.views.getOperatorById(operators[4].id);
              expect(BigInt(op5Data.validatorCount)).to.equal(
                BigInt(ctx.state.validatorCountB),
                "Op5 (exclusive to B) must be unchanged after A liquidated",
              );

              ctx.state.phase = "A-liquidated-B-verified";
            },
          },

          {
            name: "phase4-post-liquidation-deviation-proof",
            async fn(ctx) {
              const { operators } = ctx.state;

              const earningsBefore = new Map<number, bigint>();
              for (let i = 0; i < 5; i++) {
                earningsBefore.set(i, BigInt(await ctx.views.getOperatorEarnings(operators[i].id)));
              }

              const probeBlocks = 20n;
              await mineBlocks(ctx.provider, Number(probeBlocks));

              const sharedPostLiq = BigInt(ctx.state.validatorCountB) * BPS_DENOMINATOR;
              const op4PostLiq = 0n;
              const op5PostLiq = BigInt(ctx.state.validatorCountB) * BPS_DENOMINATOR;

              const expectedEffective = [sharedPostLiq, sharedPostLiq, sharedPostLiq, op4PostLiq, op5PostLiq];

              for (let i = 0; i < 5; i++) {
                const earningsAfter = BigInt(await ctx.views.getOperatorEarnings(operators[i].id));
                const actualDelta = earningsAfter - earningsBefore.get(i)!;
                const packedFee = operators[i].fee / ETH_DEDUCTED_DIGITS;
                const expectedDelta = computeOperatorEarningsDelta(packedFee, probeBlocks, expectedEffective[i]);
                expect(actualDelta).to.equal(
                  expectedDelta,
                  `Op[${i}] post-liquidation earnings must match effectiveVUnits=${expectedEffective[i]} (proves deviation reversed)`,
                );
              }

              ctx.state.phase = "post-liq-deviation-proved";
            },
          },
        ],

        async after(ctx) {
          expect(ctx.state.phase).to.equal("post-liq-deviation-proved");
        },
      }, seed);
    });
  }
});
