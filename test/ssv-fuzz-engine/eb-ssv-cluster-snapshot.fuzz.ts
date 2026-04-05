import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  migrateLegacyCluster,
  setupFuzzOracles,
  type DepositWithdrawTracker,
  type LegacyMigrationSnapshot,
  type OracleState,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
  assertLegacyEnsureETHDefaultsTransition,
  assertDaoVUnitsMatchCluster,
  getContractEthBalance,
} from "./core/assertions.ts";
import { computeClusterId, computeEBRoot, commitEBRoot } from "../helpers/oracle.ts";
import { parseClusterFromEvent, extractEventArgs } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { mineBlocks } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
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
  storedEB: number;
  expectedVUnits: bigint;
  ssvFee: bigint;
  totalSsvDeposit: bigint;
  migrationSnapshot?: LegacyMigrationSnapshot;
  tracker: DepositWithdrawTracker;
  tickDepositDelta: bigint;
}

function ebToVUnits(effectiveBalance: bigint): bigint {
  const vUnits = effectiveBalance * BPS_DENOMINATOR;
  if (vUnits === 0n) return 0n;
  return (vUnits - 1n) / 32n + 1n;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: EB update on SSV cluster — stores snapshot only (CAT-3-5)", function () {
  for (const seed of seeds) {
    it(`Validates SSV cluster EB snapshot + migration deviation with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n),
          );
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT,
            TOKEN_REGISTER_AMOUNT * 3n,
          );
          const preUpgradeBlocks = Number(ctx.rng.nextInRange(50n, 200n));

          const seed = await setupLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee,
            validatorCount: 3,
            ssvDepositPerValidator,
            preUpgradeBlocks,
          });

          const [, , , oracleSigner] = ctx.signers;
          await ctx.ssvToken.mint(oracleSigner.address, STAKE_AMOUNT);
          await ctx.ssvToken.connect(oracleSigner).approve(await ctx.network.getAddress(), STAKE_AMOUNT);
          await ctx.network.connect(oracleSigner).stake(STAKE_AMOUNT);

          const oracles = [ctx.signers[17], ctx.signers[18], ctx.signers[19]];
          await setupFuzzOracles(ctx, oracles);

          const fuzzedEBPerValidator = Number(ctx.rng.nextInRange(32n, 2048n));
          const storedEB = 3 * fuzzedEBPerValidator;
          const expectedVUnits = ebToVUnits(BigInt(storedEB));

          const blockNum = Number(await ctx.provider.getBlockNumber());
          const clusterId = computeClusterId(seed.clusterOwner.address, seed.operatorIds);
          const root = computeEBRoot(clusterId, storedEB);

          await commitEBRoot(ctx.network, root, blockNum, oracles);

          const tx = await ctx.network.updateClusterBalance(
            blockNum,
            seed.clusterOwner.address,
            seed.operatorIds,
            seed.preUpgradeCluster,
            storedEB,
            [],
          );
          const receipt = await tx.wait();
          const clusterAfterEB = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_BALANCE_UPDATED);

          const eb = BigInt(
            await ctx.views.getEffectiveBalance(seed.clusterOwner.address, seed.operatorIds, clusterAfterEB),
          );
          expect(eb).to.equal(BigInt(storedEB));

          return {
            cluster: {
              cluster: clusterAfterEB,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: [...seed.validatorKeys],
            },
            operators: seed.operators,
            oracle: { oracles, lastCommittedBlock: BigInt(blockNum) },
            phase: "post-eb-update",
            storedEB,
            expectedVUnits,
            ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
            tickDepositDelta: 0n,
          };
        },

        steps: [
          {
            name: "phase2-timing-gap",
            async fn(ctx) {
              const { cluster } = ctx.state;

              const gapBlocks = Number(ctx.rng.nextInRange(10n, 200n));
              await mineBlocks(ctx.provider, gapBlocks);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(BigInt(ctx.state.storedEB));

              ctx.state.phase = "timing-gap-done";
            },
          },

          {
            name: "phase3-migration-with-stored-eb",
            async fn(ctx) {
              const { cluster } = ctx.state;

              const migrateStep = migrateLegacyCluster<State>(
                DEFAULT_ETH_REGISTER_VALUE,
                DEFAULT_ETH_REGISTER_VALUE * 3n,
              );
              await migrateStep(ctx);

              const eventArgs = extractEventArgs(
                ctx.network, ctx.state.migrationSnapshot!.migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH,
              );
              expect(Number(eventArgs.effectiveBalance)).to.equal(ctx.state.storedEB);

              await assertLegacyMigrationRefund(ctx as any);
              await assertLegacyEnsureETHDefaultsTransition(ctx as any);

              await assertDaoVUnitsMatchCluster(ctx);

              const ebAfter = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(ebAfter).to.equal(BigInt(ctx.state.storedEB));

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              ctx.state.phase = "migrated";
            },
          },

          {
            name: "phase4-post-migration-accrual",
            async fn(ctx) {
              const { cluster, operators } = ctx.state;

              const postBlocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, postBlocks);

              await assertDaoVUnitsMatchCluster(ctx);

              const eb = BigInt(
                await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              expect(eb).to.equal(BigInt(ctx.state.storedEB));

              const clusterBal = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              let totalOpEarnings = 0n;
              for (const op of operators) {
                totalOpEarnings += BigInt(await ctx.views.getOperatorEarnings(op.id));
              }
              const netEarnings = BigInt(await ctx.views.getNetworkEarnings());
              const contractBal = await getContractEthBalance(ctx);
              const dust = contractBal - (clusterBal + totalOpEarnings + netEarnings);
              const maxDust = BigInt(operators.length) * ETH_DEDUCTED_DIGITS;
              expect(dust).to.be.greaterThanOrEqual(0n);
              expect(dust).to.be.lessThanOrEqual(maxDust);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false);

              ctx.state.phase = "post-migration-accrued";
            },
          },
        ],

        async after(ctx) {
          expect(ctx.state.phase).to.equal("post-migration-accrued");
        },
      }, seed);
    });
  }
});
