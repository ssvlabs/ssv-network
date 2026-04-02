import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupSharedOperatorPhantomFeeSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  migrateLegacyCluster,
  type DepositWithdrawTracker,
  type LegacyMigrationSnapshot,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
} from "./core/assertions.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { expect } from "chai";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  removedOperator: OperatorRecord;
  frozenEthIndex: bigint;
  ethInitBlock: number;
  phase: string;

  ssvFee: bigint;
  totalSsvDeposit: bigint;
  migrationSnapshot?: LegacyMigrationSnapshot;

  tracker: DepositWithdrawTracker;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: CAT-1-13 — shared operators, removed operator frozen ETH index phantom fee proof", function () {
  for (const seed of seeds) {
    it(`Validates phantom fee on shared-operator migration with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const ssvFee = alignSSVFee(ctx.rng.nextInRange(
            MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n,
          ));
          const removedOperatorIndex = Number(ctx.rng.nextInRange(0n, 3n));
          const foreignEthBlocks = Number(ctx.rng.nextInRange(50n, 200n));

          const seed = await setupSharedOperatorPhantomFeeSeed(ctx, {
            ssvFee,
            removedOperatorIndex,
            foreignEthBlocks,
          });

          return {
            cluster: {
              cluster: seed.preUpgradeCluster,
              operatorIds: seed.operatorIds,
              owner: seed.clusterOwner,
              validatorKeys: [...seed.validatorKeys],
            },
            operators: seed.operators,
            removedOperator: seed.removedOperator,
            frozenEthIndex: seed.frozenEthIndex,
            ethInitBlock: seed.ethInitBlock,
            phase: "post-upgrade-shared-ops",
            ssvFee,
            totalSsvDeposit: seed.totalSsvDeposit,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "phantomFeeProof",
            fn: async (ctx) => {
              const { cluster, operators, removedOperator, frozenEthIndex, ethInitBlock } = ctx.state;

              expect(cluster.cluster.active).to.equal(true);
              expect(frozenEthIndex).to.be.greaterThan(0n);

              const removedOpView = await ctx.views.getOperatorById(removedOperator.id);
              expect(removedOpView.isActive).to.equal(false, "Removed op: ethSnapshot.block == 0");
              expect(BigInt(removedOpView.fee)).to.equal(0n, "Removed op: ethFee == 0");
              expect(BigInt(removedOpView.validatorCount)).to.equal(0n, "Removed op: ethValidatorCount == 0");

              const activeOpCount = BigInt(operators.length);
              const valCount = BigInt(cluster.cluster.validatorCount);
              const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
              const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
              const burnRate = activeOpCount * packedOpFee;
              const vUnits = valCount * BPS_DENOMINATOR;
              const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (burnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
              const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
              const minViable = liquidationThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
                ? liquidationThreshold
                : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

              const phantomFee = (frozenEthIndex * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
              expect(phantomFee).to.be.greaterThan(0n);

              const ethDepositMax = DEFAULT_ETH_REGISTER_VALUE * 2n;
              const migrateStep = migrateLegacyCluster<State>(minViable, ethDepositMax);
              await migrateStep(ctx);

              const ethDeposited = ctx.state.migrationSnapshot!.ethDeposited;

              const { migrateReceipt } = ctx.state.migrationSnapshot!;
              let feeEventCount = 0;
              for (const log of migrateReceipt.logs ?? []) {
                let parsed;
                try {
                  parsed = ctx.network.interface.parseLog(log);
                } catch {
                  continue;
                }
                if (parsed && parsed.name === Events.OPERATOR_FEE_EXECUTED) {
                  feeEventCount++;
                }
              }
              expect(feeEventCount).to.equal(
                0,
                "Active ops already ETH-initialized by foreign cluster — no OperatorFeeExecuted during migration",
              );

              for (const op of operators) {
                const opData = await ctx.views.getOperatorById(op.id);
                expect(BigInt(opData.validatorCount)).to.be.greaterThan(0n);
              }

              await assertLegacyMigrationRefund(ctx as any);

              const migrateBlock = migrateReceipt.blockNumber;
              const activeOpsIndex = BigInt(operators.length) * BigInt(migrateBlock - ethInitBlock) * packedOpFee;
              const expectedFixClusterIndex = activeOpsIndex + frozenEthIndex;
              expect(BigInt(cluster.cluster.index)).to.equal(
                expectedFixClusterIndex,
                "FIX: cluster.index must include frozen ETH index from removed operator",
              );

              const networkValCount = BigInt(await ctx.views.getNetworkValidatorsCount());
              expect(networkValCount).to.equal(
                BigInt(cluster.cluster.validatorCount) + 2n,
                "Network validator count = owner1 migrated + owner2 ETH (2)",
              );

              const balanceAfterMigration = BigInt(
                await ctx.views.getBalance(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                ),
              );
              expect(balanceAfterMigration).to.equal(
                ethDeposited,
                "FIX: getBalance immediately after migration must equal deposited ETH (no phantom fee)",
              );

              const withdrawTx = await ctx.network.connect(cluster.owner).withdraw(
                cluster.operatorIds, 1n, cluster.cluster,
              );
              const withdrawReceipt = await withdrawTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);
              ctx.state.tracker.totalWithdrawn += 1n;

              const oneBlockBurn = ((burnRate + packedNetFee) * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
              const expectedAfterWithdraw = ethDeposited - oneBlockBurn - 1n;
              const balanceAfterWithdraw = BigInt(
                await ctx.views.getBalance(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                ),
              );
              expect(balanceAfterWithdraw).to.equal(
                expectedAfterWithdraw,
                "FIX: withdraw deducts exactly 1-block burn + 1 wei, no phantom fee",
              );

              const perBlockBurn = oneBlockBurn;

              const blocksToPhantomLiquidation = (ethDeposited - 1n - liquidationThreshold) > phantomFee
                ? Number(((ethDeposited - 1n - liquidationThreshold - phantomFee) / perBlockBurn) + 1n)
                : 1;

              await mineBlocks(ctx.provider, blocksToPhantomLiquidation);

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(
                false,
                "FIX: without phantom fee, cluster is still healthy at this block count",
              );

              await expect(
                ctx.network.connect(ctx.signers[4]).liquidate(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.CLUSTER_NOT_LIQUIDATABLE);

              ctx.state.phase = "phantom-fee-proved";
            },
          },
        ],

        expectedPhase: "phantom-fee-proved",
      }, seed);
    });
  }
});
