import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import { setupFuzzOracles, type OracleState } from "./core/steps.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  assertOperatorValidatorCounts,
  assertNetworkValidatorCount,
} from "./core/assertions.ts";
import {
  computeMinViableBalanceFromFees,
  ebToVUnits,
} from "./core/fuzz-helpers.ts";
import { computeClusterId, computeEBRoot, commitEBRoot } from "../helpers/oracle.ts";
import { parseClusterFromEvent, extractEventArgs } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import { ethers } from "ethers";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
  BPS_DENOMINATOR,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_LIQUIDATION_THRESHOLD,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  oracle: OracleState;
  phase: string;
  initialEB: number;
  postLiqEB: number;
  preUpdateOperatorEarnings: Map<number, bigint>;
}

function computeOperatorEarningsDelta(
  packedFee: bigint,
  blocks: bigint,
  effectiveVUnits: bigint,
): bigint {
  const deltaPacked = (blocks * packedFee * effectiveVUnits) / BPS_DENOMINATOR;
  return deltaPacked * ETH_DEDUCTED_DIGITS;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: EB update on liquidated cluster — snapshot stored, no accounting (CAT-3-9)", function () {
  for (const seed of seeds) {
    it(`Validates post-liquidation EB update with seed=${seed}`, async function () {
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

          const initialEBPerValidator = Number(ctx.rng.nextInRange(33n, 256n));
          const initialEB = 2 * initialEBPerValidator;
          const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
          const initRoot = computeEBRoot(clusterId, initialEB);
          const initBlockNum = Number(await ctx.provider.getBlockNumber());
          await commitEBRoot(ctx.network, initRoot, initBlockNum, oracles);

          const initTx = await ctx.network.connect(clusterOwner).updateClusterBalance(
            initBlockNum, clusterOwner.address, operatorIds, cluster.cluster, initialEB, [],
          );
          const initReceipt = await initTx.wait();
          cluster.cluster = parseClusterFromEvent(ctx.network, initReceipt, Events.CLUSTER_BALANCE_UPDATED);

          const burnRate = BigInt(
            await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
          );
          const balance = BigInt(
            await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
          );

          const packedNetworkFee = BigInt(await ctx.views.getNetworkFee()) / ETH_DEDUCTED_DIGITS;
          let packedOpFeeSum = 0n;
          for (const op of operators) {
            packedOpFeeSum += op.fee / ETH_DEDUCTED_DIGITS;
          }
          const packedBurnRate = packedOpFeeSum + packedNetworkFee;
          const vUnits = ebToVUnits(BigInt(initialEB));
          const threshold =
            ((MINIMAL_LIQUIDATION_THRESHOLD * packedBurnRate * vUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

          const blocksToLiquidation = Number((balance - threshold) / burnRate) + 1;
          await mineBlocks(ctx.provider, blocksToLiquidation);

          const isLiq = await ctx.views.isLiquidatable(
            cluster.owner.address, cluster.operatorIds, cluster.cluster,
          );
          expect(isLiq).to.equal(true, "Cluster must be liquidatable after mining blocks");

          const thirdParty = ctx.signers[10];
          const liqTx = await ctx.network.connect(thirdParty).liquidate(
            cluster.owner.address, operatorIds, cluster.cluster,
          );
          const liqReceipt = await liqTx.wait();
          cluster.cluster = parseClusterFromEvent(ctx.network, liqReceipt, Events.CLUSTER_LIQUIDATED);

          expect(cluster.cluster.active).to.equal(false);
          expect(BigInt(cluster.cluster.balance)).to.equal(0n);

          const postLiqEBPerValidator = Number(ctx.rng.nextInRange(32n, 2048n));
          const postLiqEB = 2 * postLiqEBPerValidator;

          return {
            operators,
            cluster,
            oracle: { oracles, lastCommittedBlock: BigInt(initBlockNum) },
            phase: "liquidated",
            initialEB,
            postLiqEB,
            preUpdateOperatorEarnings: new Map(),
          };
        },

        steps: [
          {
            name: "phase1-post-liquidation-eb-update",
            async fn(ctx) {
              const { cluster, oracle, operators } = ctx.state;

              const earningsBefore = new Map<number, bigint>();
              for (const op of operators) {
                earningsBefore.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
              }
              ctx.state.preUpdateOperatorEarnings = earningsBefore;

              const daoEarningsBefore = BigInt(await ctx.views.getNetworkEarnings());

              const burnRateBefore = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );

              await mineBlocks(ctx.provider, 1);

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const root = computeEBRoot(clusterId, ctx.state.postLiqEB);
              await commitEBRoot(ctx.network, root, blockNum, oracle.oracles);

              const tx = await ctx.network.connect(ctx.signers[10]).updateClusterBalance(
                blockNum,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                ctx.state.postLiqEB,
                [],
              );
              const receipt = await tx.wait();

              await expect(tx).to.emit(ctx.network, Events.CLUSTER_BALANCE_UPDATED);
              await expect(tx).to.not.emit(ctx.network, Events.CLUSTER_LIQUIDATED);

              const updatedCluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);
              expect(updatedCluster.active).to.equal(false);
              expect(BigInt(updatedCluster.balance)).to.equal(0n);
              cluster.cluster = updatedCluster;

              const eventArgs = extractEventArgs(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);
              expect(eventArgs.effectiveBalance).to.equal(ctx.state.postLiqEB);

              const burnRateAfter = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const networkFee = BigInt(await ctx.views.getNetworkFee());
              let opFeeSum = 0n;
              for (const op of operators) {
                opFeeSum += op.fee;
              }
              const expectedVUnits = ebToVUnits(BigInt(ctx.state.postLiqEB));
              const expectedBurnRate = ((networkFee + opFeeSum) * expectedVUnits) / BPS_DENOMINATOR;
              expect(burnRateAfter).to.equal(
                expectedBurnRate,
                "getBurnRate must reflect new clusterEB.vUnits from post-liquidation EB update",
              );

              if (ctx.state.postLiqEB !== ctx.state.initialEB) {
                expect(burnRateAfter).to.not.equal(
                  burnRateBefore,
                  "getBurnRate must change when EB changes (proves storage write)",
                );
              }

              for (const op of operators) {
                const earningsAfter = BigInt(await ctx.views.getOperatorEarnings(op.id));
                expect(earningsAfter).to.equal(
                  earningsBefore.get(op.id)!,
                  `Operator ${op.id} earnings must be unchanged after EB update on liquidated cluster`,
                );
              }

              await mineBlocks(ctx.provider, 20);
              const daoEarningsAfter = BigInt(await ctx.views.getNetworkEarnings());
              expect(daoEarningsAfter).to.equal(
                daoEarningsBefore,
                "DAO network earnings must be unchanged — daoTotalEthVUnits == 0 after single-cluster liquidation",
              );

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              await expect(
                ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              ).to.be.revertedWithCustomError(ctx.network, Errors.CLUSTER_IS_LIQUIDATED);

              await expect(
                ctx.network.connect(ctx.signers[10]).updateClusterBalance(
                  blockNum, cluster.owner.address, cluster.operatorIds,
                  cluster.cluster, ctx.state.postLiqEB, [],
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.STALE_UPDATE);

              ctx.state.phase = "post-liq-eb-updated";
            },
          },

          {
            name: "phase2-reactivation-with-updated-eb",
            async fn(ctx) {
              const { cluster, operators } = ctx.state;

              const postLiqVUnits = ebToVUnits(BigInt(ctx.state.postLiqEB));
              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const operatorFees = operators.map((op) => op.fee);
              let opFeeSum = 0n;
              for (const fee of operatorFees) {
                opFeeSum += fee;
              }
              const minViable = computeMinViableBalanceFromFees(
                operatorFees,
                networkFee,
                postLiqVUnits,
                BigInt(MINIMUM_BLOCKS_BEFORE_LIQUIDATION),
                BigInt(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL),
              );

              const reactivateDeposit = ctx.rng.nextInRange(minViable, minViable + DEFAULT_ETH_REGISTER_VALUE);
              await setAccountBalance(ctx.provider, cluster.owner.address, reactivateDeposit + 10n ** 18n);

              const reactivateTx = await ctx.network.connect(cluster.owner).reactivate(
                cluster.operatorIds, cluster.cluster, { value: reactivateDeposit },
              );
              const reactivateReceipt = await reactivateTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, reactivateReceipt, Events.CLUSTER_REACTIVATED);

              expect(cluster.cluster.active).to.equal(true);

              const burnRateAfterReactivation = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const expectedBurnRate = ((networkFee + opFeeSum) * postLiqVUnits) / BPS_DENOMINATOR;
              expect(burnRateAfterReactivation).to.equal(
                expectedBurnRate,
                "Post-reactivation burn rate must use post-liquidation EB vUnits (not initial EB)",
              );

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              const earningsBeforeProbe = new Map<number, bigint>();
              for (const op of operators) {
                earningsBeforeProbe.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
              }

              const probeBlocks = 20n;
              await mineBlocks(ctx.provider, Number(probeBlocks));

              for (const op of operators) {
                const earningsAfterProbe = BigInt(await ctx.views.getOperatorEarnings(op.id));
                const actualDelta = earningsAfterProbe - earningsBeforeProbe.get(op.id)!;
                const packedFee = op.fee / ETH_DEDUCTED_DIGITS;
                const expectedDelta = computeOperatorEarningsDelta(packedFee, probeBlocks, postLiqVUnits);
                expect(actualDelta).to.equal(
                  expectedDelta,
                  `Operator ${op.id} post-reactivation earnings must accrue at post-liq EB vUnits`,
                );
              }

              ctx.state.phase = "reactivated";
            },
          },
        ],

        expectedPhase: "reactivated",

        async after(ctx) {
          await assertOperatorValidatorCounts(ctx);
          await assertNetworkValidatorCount(ctx);
        },
      }, seed);
    });
  }
});
