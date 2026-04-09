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
  getContractEthBalance,
  resetEBSnapshots,
} from "./core/assertions.ts";
import { ebToVUnits } from "./core/fuzz-helpers.ts";
import { computeClusterId, computeEBRoot, commitEBRoot } from "../helpers/oracle.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  STAKE_AMOUNT,
  BPS_DENOMINATOR,
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  oracle: OracleState;
  phase: string;
  lastEBOperatorEarnings?: EBOperatorEarningsSnapshot;
  lastEBClusterBalance?: EBClusterBalanceSnapshot;
  tickDepositDelta: bigint;
  sameEBBurnRate: bigint;
}

async function backComputeStoredVUnits(
  ctx: { views: any; state: { cluster: ClusterRecord; operators: OperatorRecord[] } },
): Promise<bigint> {
  const { cluster, operators } = ctx.state;
  const networkFee = BigInt(await ctx.views.getNetworkFee());
  let packedTotal = networkFee / ETH_DEDUCTED_DIGITS;
  for (const op of operators) {
    packedTotal += op.fee / ETH_DEDUCTED_DIGITS;
  }
  const burnRate = BigInt(
    await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
  );
  return (burnRate * BPS_DENOMINATOR) / (packedTotal * ETH_DEDUCTED_DIGITS);
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: Implicit EB to explicit EB via oracle update (CAT-3-1)", function () {
  for (const seed of seeds) {
    it(`Validates implicit-to-explicit EB transition with seed=${seed}`, async function () {
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

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds, 3, DEFAULT_ETH_REGISTER_VALUE,
          );

          return {
            operators,
            cluster,
            oracle: { oracles, lastCommittedBlock: 0n },
            phase: "setup",
            tickDepositDelta: 0n,
            sameEBBurnRate: 0n,
          };
        },

        steps: [
          {
            name: "phase1-implicit-eb",
            async fn(ctx) {
              const { cluster } = ctx.state;

              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);
              await assertDaoVUnitsMatchCluster(ctx);

              await mineBlocks(ctx.provider, 100);

              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);
              await assertDaoVUnitsMatchCluster(ctx);
              await assertEthConservation(ctx);

              const implicitEB = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(implicitEB).to.equal(96n);

              ctx.state.phase = "implicit-verified";
            },
          },

          {
            name: "phase2-oracle-commit",
            async fn(ctx) {
              const { cluster, oracle } = ctx.state;

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const root = computeEBRoot(clusterId, 96);

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
            name: "phase3-same-eb-update",
            async fn(ctx) {
              const { cluster, oracle } = ctx.state;

              const tx = await ctx.network.updateClusterBalance(
                oracle.lastCommittedBlock,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                96,
                [],
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(96n);

              const sameEBVUnits = ebToVUnits(eb);
              expect(sameEBVUnits).to.equal(3n * BPS_DENOMINATOR);

              const storedVUnitsPhase3 = await backComputeStoredVUnits(ctx);
              expect(storedVUnitsPhase3).to.equal(
                3n * BPS_DENOMINATOR,
                "clusterEB.vUnits must be 30000 after same-EB update (no deviation)",
              );

              ctx.state.sameEBBurnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );

              await assertDaoVUnitsMatchCluster(ctx);
              await assertEthConservation(ctx);

              resetEBSnapshots(ctx);
              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);

              ctx.state.phase = "explicit-same";
            },
          },

          {
            name: "phase4-higher-eb-update",
            async fn(ctx) {
              const { cluster, oracle } = ctx.state;

              const preBlocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, preBlocks);

              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);

              const blockNum = Number(await ctx.provider.getBlockNumber());
              const fuzzedEBPerValidator = Number(ctx.rng.nextInRange(33n, 2048n));
              const higherEB = 3 * fuzzedEBPerValidator;

              const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
              const root = computeEBRoot(clusterId, higherEB);

              await commitEBRoot(ctx.network, root, blockNum, oracle.oracles);
              oracle.lastCommittedBlock = BigInt(blockNum);

              const tx = await ctx.network.updateClusterBalance(
                blockNum,
                cluster.owner.address,
                cluster.operatorIds,
                cluster.cluster,
                higherEB,
                [],
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

              const newEB = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(newEB).to.equal(BigInt(higherEB));

              const expectedVUnits = ebToVUnits(BigInt(higherEB));
              expect(expectedVUnits).to.be.greaterThan(3n * BPS_DENOMINATOR);

              const storedVUnitsPhase4 = await backComputeStoredVUnits(ctx);
              expect(storedVUnitsPhase4).to.equal(
                expectedVUnits,
                `clusterEB.vUnits must be ${expectedVUnits} after higher-EB update`,
              );

              const deviation = storedVUnitsPhase4 - 3n * BPS_DENOMINATOR;
              expect(deviation).to.be.greaterThan(0n);

              const postBurnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(postBurnRate).to.be.greaterThan(ctx.state.sameEBBurnRate);

              await assertDaoVUnitsMatchCluster(ctx);

              const postBlocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, postBlocks);

              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);

              // Exact conservation may drift by up to (N-1) * ETH_DEDUCTED_DIGITS due to
              // per-operator floor division when vUnits/BPS is non-integer after EB increase.
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
              const maxDust = BigInt(ctx.state.operators.length - 1) * ETH_DEDUCTED_DIGITS;
              expect(dust).to.be.greaterThanOrEqual(0n);
              expect(dust).to.be.lessThanOrEqual(maxDust);

              ctx.state.phase = "explicit-higher";
            },
          },
        ],

        expectedPhase: "explicit-higher",
      }, seed);
    });
  }
});
