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
  assertOperatorEarningsWithEB,
  assertClusterBalanceWithEB,
  assertDaoVUnitsMatchCluster,
  assertEthConservation,
  computeEBAccrualDelta,
  getContractEthBalance,
} from "./core/assertions.ts";
import { computeClusterBalanceWithVUnits } from "./core/fuzz-helpers.ts";
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
  MINIMAL_LIQUIDATION_THRESHOLD,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  oracle: OracleState;
  phase: string;
  initialDeposit: bigint;
  implicitVUnits: bigint;
  fuzzedEB: number;
  lastEBOperatorEarnings?: EBOperatorEarningsSnapshot;
  lastEBClusterBalance?: EBClusterBalanceSnapshot;
  preUpdateSnapshot?: {
    block: bigint;
    clusterBalance: bigint;
    burnRate: bigint;
    networkEarnings: bigint;
    operatorEarnings: Map<number, bigint>;
  };
  tickDepositDelta: bigint;
}

function ebToVUnits(effectiveBalance: bigint): bigint {
  const vUnits = effectiveBalance * BPS_DENOMINATOR;
  if (vUnits === 0n) return 0n;
  return (vUnits - 1n) / 32n + 1n;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: EB increase triggers auto-liquidation (CAT-3-2)", function () {
  for (const seed of seeds) {
    it(`Validates auto-liquidation on EB increase with seed=${seed}`, async function () {
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

          const fuzzedEBPerValidator = Number(ctx.rng.nextInRange(48n, 2048n));
          const fuzzedEB = 2 * fuzzedEBPerValidator;
          const newVUnits = ebToVUnits(BigInt(fuzzedEB));
          const implicitVUnits = 2n * BPS_DENOMINATOR;

          const packedNetworkFee = BigInt(await ctx.views.getNetworkFee()) / ETH_DEDUCTED_DIGITS;
          let packedOpFeeSum = 0n;
          for (const op of operators) {
            packedOpFeeSum += op.fee / ETH_DEDUCTED_DIGITS;
          }
          const packedBurnRate = packedOpFeeSum + packedNetworkFee;

          const thresholdNew =
            ((MINIMAL_LIQUIDATION_THRESHOLD * packedBurnRate * newVUnits) /
            BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

          const thresholdOld =
            ((MINIMAL_LIQUIDATION_THRESHOLD * packedBurnRate * implicitVUnits) /
            BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

          const largeDeposit = ethers.parseEther("500");
          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds, 2, largeDeposit,
          );

          const currentBalance = BigInt(
            await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
          );
          const burnPerBlock =
            ((packedBurnRate * implicitVUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

          const fraction = ctx.rng.nextInRange(10n, 90n);
          const targetBalance = thresholdOld + ((thresholdNew - thresholdOld) * fraction) / 100n;
          const withdrawAmount = currentBalance - burnPerBlock - targetBalance;

          const wtx = await ctx.network.connect(clusterOwner).withdraw(
            cluster.operatorIds, withdrawAmount, cluster.cluster,
          );
          const wreceipt = await wtx.wait();
          cluster.cluster = parseClusterFromEvent(ctx.network, wreceipt, Events.CLUSTER_WITHDRAWN);

          return {
            operators,
            cluster,
            oracle: { oracles, lastCommittedBlock: 0n },
            phase: "setup",
            initialDeposit: largeDeposit * 2n,
            implicitVUnits,
            fuzzedEB,
            tickDepositDelta: 0n,
          };
        },

        steps: [
          {
            name: "phase1-verify-solvency",
            async fn(ctx) {
              const { cluster, operators } = ctx.state;

              const preBlocks = Number(ctx.rng.nextInRange(10n, 50n));
              await mineBlocks(ctx.provider, preBlocks);

              const isLiquidatable = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiquidatable).to.equal(false);

              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);
              await assertDaoVUnitsMatchCluster(ctx);
              await assertEthConservation(ctx);

              const implicitEB = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(implicitEB).to.equal(64n);

              const preUpdateOperatorEarnings = new Map<number, bigint>();
              for (const op of operators) {
                preUpdateOperatorEarnings.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
              }

              ctx.state.preUpdateSnapshot = {
                block: BigInt(await ctx.provider.getBlockNumber()),
                clusterBalance: BigInt(
                  await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
                ),
                burnRate: BigInt(
                  await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
                ),
                networkEarnings: BigInt(await ctx.views.getNetworkEarnings()),
                operatorEarnings: preUpdateOperatorEarnings,
              };

              ctx.state.phase = "solvency-verified";
            },
          },

          {
            name: "phase2-oracle-commit",
            async fn(ctx) {
              const { cluster, oracle } = ctx.state;

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const root = computeEBRoot(clusterId, ctx.state.fuzzedEB);

              const receipt = await commitEBRoot(ctx.network, root, blockNum, oracle.oracles);
              oracle.lastCommittedBlock = BigInt(blockNum);

              const rootCommittedEvent = receipt.logs.find(
                (log: any) => {
                  try {
                    const parsed = ctx.network.interface.parseLog(log);
                    return parsed?.name === "RootCommitted";
                  } catch { return false; }
                },
              );
              expect(rootCommittedEvent).to.not.be.undefined;

              ctx.state.phase = "root-committed";
            },
          },

          {
            name: "phase3-auto-liquidation",
            async fn(ctx) {
              const { cluster, oracle, operators } = ctx.state;
              const caller = ctx.signers[10];

              expect(cluster.cluster.active).to.equal(true, "cluster must be active before EB update");
              expect(ctx.state.preUpdateSnapshot).to.not.be.undefined;
              const preUpdateSnapshot = ctx.state.preUpdateSnapshot!;

              const contractBalBefore = await getContractEthBalance(ctx);
              const callerBalBefore = BigInt(await ctx.provider.getBalance(caller.address));

              const tx = await ctx.network.connect(caller).updateClusterBalance(
                oracle.lastCommittedBlock,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                ctx.state.fuzzedEB,
                [],
              );
              const receipt = await tx.wait();
              if (!receipt) throw new Error("Missing transaction receipt");
              const txReceipt = receipt;

              await expect(tx).to.emit(ctx.network, Events.CLUSTER_LIQUIDATED);
              await expect(tx).to.emit(ctx.network, Events.CLUSTER_BALANCE_UPDATED);

              const eventNames = txReceipt.logs
                .map((log: any) => { try { return ctx.network.interface.parseLog(log)?.name; } catch { return null; } })
                .filter((n: string | null | undefined): n is string => n === Events.CLUSTER_LIQUIDATED || n === Events.CLUSTER_BALANCE_UPDATED);
              expect(eventNames[0]).to.equal(Events.CLUSTER_LIQUIDATED);
              expect(eventNames[1]).to.equal(Events.CLUSTER_BALANCE_UPDATED);

              cluster.cluster = parseClusterFromEvent(ctx.network, txReceipt, Events.CLUSTER_LIQUIDATED);

              expect(cluster.cluster.active).to.equal(false);
              expect(BigInt(cluster.cluster.balance)).to.equal(0n);

              const expectedVUnits = ebToVUnits(BigInt(ctx.state.fuzzedEB));
              expect(expectedVUnits).to.be.greaterThan(ctx.state.implicitVUnits);

              const updateBlock = BigInt(txReceipt.blockNumber);
              const blockDiff = updateBlock - preUpdateSnapshot.block;
              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const packedNetworkFee = networkFee / ETH_DEDUCTED_DIGITS;

              const operatorFees = operators.map((op) => op.fee);
              let totalUnpackedFee = networkFee;
              for (const fee of operatorFees) {
                totalUnpackedFee += fee;
              }

              const expectedPreUpdateBurnRate = (totalUnpackedFee * ctx.state.implicitVUnits) / BPS_DENOMINATOR;
              expect(preUpdateSnapshot.burnRate).to.equal(expectedPreUpdateBurnRate);

              const expectedPostUpdateBurnRate = (totalUnpackedFee * expectedVUnits) / BPS_DENOMINATOR;
              const burnRateAfter = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(burnRateAfter).to.equal(expectedPostUpdateBurnRate);
              expect(burnRateAfter).to.not.equal(preUpdateSnapshot.burnRate);

              const expectedNetworkDelta =
                computeEBAccrualDelta(blockDiff, packedNetworkFee, ctx.state.implicitVUnits);
              const networkEarningsAfter = BigInt(await ctx.views.getNetworkEarnings());
              expect(networkEarningsAfter).to.equal(preUpdateSnapshot.networkEarnings + expectedNetworkDelta);

              for (const op of operators) {
                const packedFee = op.fee / ETH_DEDUCTED_DIGITS;
                const expectedOperatorDelta = computeEBAccrualDelta(
                  blockDiff,
                  packedFee,
                  ctx.state.implicitVUnits,
                );
                const currentOperatorEarnings = BigInt(await ctx.views.getOperatorEarnings(op.id));
                expect(currentOperatorEarnings).to.equal(
                  preUpdateSnapshot.operatorEarnings.get(op.id)! + expectedOperatorDelta,
                );
              }

              const expectedSettledBalance = computeClusterBalanceWithVUnits(
                preUpdateSnapshot.clusterBalance,
                operatorFees,
                networkFee,
                ctx.state.implicitVUnits,
                blockDiff,
              );

              const contractBalAfter = await getContractEthBalance(ctx);
              const bounty = contractBalBefore - contractBalAfter;
              expect(bounty).to.be.greaterThan(0n);
              expect(bounty).to.equal(expectedSettledBalance);

              const effectiveGasPrice = (txReceipt as any).effectiveGasPrice;
              const gasPrice = BigInt(effectiveGasPrice ?? txReceipt.gasPrice);
              const gasCost = BigInt(txReceipt.gasUsed) * gasPrice;
              const callerBalAfter = BigInt(await ctx.provider.getBalance(caller.address));
              expect(callerBalAfter - callerBalBefore + gasCost).to.equal(bounty);

              for (const op of operators) {
                const opData = await ctx.views.getOperatorById(op.id);
                expect(BigInt(opData.validatorCount)).to.equal(0n);
              }

              ctx.state.phase = "auto-liquidated";
            },
          },

          {
            name: "phase4-post-liquidation",
            async fn(ctx) {
              const { cluster, operators } = ctx.state;

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              const earningsBefore = new Map<number, bigint>();
              for (const op of operators) {
                earningsBefore.set(op.id, BigInt(await ctx.views.getOperatorEarnings(op.id)));
              }
              const networkBefore = BigInt(await ctx.views.getNetworkEarnings());

              const postBlocks = Number(ctx.rng.nextInRange(20n, 80n));
              await mineBlocks(ctx.provider, postBlocks);

              for (const op of operators) {
                const earningsAfter = BigInt(await ctx.views.getOperatorEarnings(op.id));
                expect(earningsAfter).to.equal(earningsBefore.get(op.id)!);
              }
              const networkAfter = BigInt(await ctx.views.getNetworkEarnings());
              expect(networkAfter).to.equal(networkBefore);

              await expect(
                ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              ).to.be.revertedWithCustomError(ctx.network, Errors.CLUSTER_IS_LIQUIDATED);

              await expect(
                ctx.network.connect(cluster.owner).withdraw(
                  cluster.operatorIds, 1n, cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);

              ctx.state.phase = "post-liquidation-verified";
            },
          },
        ],

        async after(ctx) {
          expect(ctx.state.phase).to.equal("post-liquidation-verified");
        },
      }, seed);
    });
  }
});
