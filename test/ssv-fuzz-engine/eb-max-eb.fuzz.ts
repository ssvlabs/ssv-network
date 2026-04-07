import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import { setupFuzzOracles, type OracleState } from "./core/steps.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  assertDaoVUnitsMatchCluster,
  assertOperatorValidatorCounts,
  assertOperatorEarningsWithEB,
  assertNetworkEarningsWithEB,
  assertClusterBalanceWithEB,
  assertEthConservation,
  type EBNetworkEarningsSnapshot,
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
  maxEB: number;
  maxVUnits: bigint;
  maxBurnRate: bigint;
  lastEBNetworkEarnings?: EBNetworkEarningsSnapshot;
  tickDepositDelta: bigint;
}

function ebToVUnits(effectiveBalance: bigint): bigint {
  const vUnits = effectiveBalance * BPS_DENOMINATOR;
  if (vUnits === 0n) return 0n;
  return (vUnits - 1n) / 32n + 1n;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: Max EB (2048 ETH/validator) — high burn rate accrual (CAT-3-4)", function () {
  for (const seed of seeds) {
    it(`Validates max EB with fuzzed validator count with seed=${seed}`, async function () {
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

          const maxEB = validatorCount * 2048;
          const maxVUnits = ebToVUnits(BigInt(maxEB));

          const blockNum = Number(await ctx.provider.getBlockNumber());
          const clusterId = computeClusterId(cluster.owner.address, cluster.operatorIds);
          const root = computeEBRoot(clusterId, maxEB);

          await commitEBRoot(ctx.network, root, blockNum, oracles);
          const lastCommittedBlock = BigInt(blockNum);

          const tx = await ctx.network.updateClusterBalance(
            blockNum,
            cluster.owner.address,
            cluster.operatorIds,
            cluster.cluster,
            maxEB,
            [],
          );
          const receipt = await tx.wait();
          cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

          const eb = BigInt(
            await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
          );
          expect(eb).to.equal(BigInt(maxEB));

          expect(maxVUnits).to.equal(BigInt(validatorCount) * 640000n);

          const maxBurnRate = BigInt(
            await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
          );

          return {
            operators,
            cluster,
            oracle: { oracles, lastCommittedBlock },
            phase: "setup",
            maxEB,
            maxVUnits,
            maxBurnRate,
            tickDepositDelta: 0n,
          };
        },

        steps: [
          {
            name: "phase1-set-max-eb",
            async fn(ctx) {
              const { cluster } = ctx.state;

              await assertDaoVUnitsMatchCluster(ctx);
              await assertOperatorValidatorCounts(ctx);

              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);
              await assertNetworkEarningsWithEB(ctx);
              await assertEthConservation(ctx);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              ctx.state.phase = "max-eb-set";
            },
          },

          {
            name: "phase2-verify-high-burn-accrual",
            async fn(ctx) {
              const { cluster } = ctx.state;

              await mineBlocks(ctx.provider, 50);

              await assertDaoVUnitsMatchCluster(ctx);
              await assertOperatorValidatorCounts(ctx);
              await assertOperatorEarningsWithEB(ctx);
              await assertClusterBalanceWithEB(ctx);
              await assertNetworkEarningsWithEB(ctx);
              await assertEthConservation(ctx);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(BigInt(ctx.state.maxEB));

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              ctx.state.phase = "high-burn-verified";
            },
          },
        ],
        expectedPhase: "high-burn-verified",
      }, seed);
    });
  }
});
