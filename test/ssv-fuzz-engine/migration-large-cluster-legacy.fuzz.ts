import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLargeClusterLegacyMigrationSeed, alignSSVFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import {
  migrateLegacyCluster,
  type DepositWithdrawTracker,
  type LegacyMigrationSnapshot,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
  assertLegacyOperatorDualTracking,
  assertLargeClusterMigrationEvents,
  assertEthConservation,
  assertNetworkValidatorCount,
  assertPhaseAwareOperatorEarnings,
  assertPhaseAwareClusterBalance,
  assertPhaseAwareNetworkEarnings,
  assertContractBalanceWithDeltas,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type ContractBalanceWithDeltasSnapshot,
} from "./core/assertions.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import { makePublicKey } from "../helpers/keys.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { expect } from "chai";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  NETWORK_FEE,
  ETH_DEDUCTED_DIGITS,
  DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  removedOperator: OperatorRecord;
  removedOperatorIds: number[];
  ssvFees: bigint[];
  phase: string;

  totalSsvDeposit: bigint;
  ssvBalanceAfterRemoval: bigint;
  blockAfterRemoval: bigint;
  migrationSnapshot?: LegacyMigrationSnapshot;

  tracker: DepositWithdrawTracker;

  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: CAT-1-10 — large cluster (13 ops: 10 normal + 2 zero-fee + 1 removed), migration", function () {
  for (const seed of seeds) {
    it(`Validates large cluster legacy migration lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const normalFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n),
          );
          const validatorCount = Number(ctx.rng.nextInRange(1n, 20n));
          const ssvDepositPerValidator = ctx.rng.nextInRange(
            TOKEN_REGISTER_AMOUNT / 5n,
            TOKEN_REGISTER_AMOUNT,
          );

          const removedIndex = Number(ctx.rng.nextInRange(0n, 12n));

          const remaining = [...Array(13).keys()].filter(i => i !== removedIndex);
          const zf1Pos = Number(ctx.rng.nextInRange(0n, BigInt(remaining.length - 1)));
          const zeroFeeIdx1 = remaining[zf1Pos];
          remaining.splice(zf1Pos, 1);
          const zf2Pos = Number(ctx.rng.nextInRange(0n, BigInt(remaining.length - 1)));
          const zeroFeeIdx2 = remaining[zf2Pos];

          const ssvFees: bigint[] = Array(13).fill(normalFee);
          ssvFees[zeroFeeIdx1] = 0n;
          ssvFees[zeroFeeIdx2] = 0n;

          const seed = await setupLargeClusterLegacyMigrationSeed(ctx, {
            ssvFees,
            validatorCount,
            ssvDepositPerValidator,
            removedOperatorIndex: removedIndex,
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
            removedOperatorIds: [seed.removedOperator.id],
            ssvFees: seed.ssvFees,
            phase: "post-upgrade-large-cluster",
            totalSsvDeposit: seed.totalSsvDeposit,
            ssvBalanceAfterRemoval: seed.ssvBalanceAfterRemoval,
            blockAfterRemoval: seed.blockAfterRemoval,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          {
            name: "largeClusterMigrationLifecycle",
            fn: async (ctx) => {
              const { cluster } = ctx.state;

              // Phase 2: pin state
              expect(cluster.cluster.active).to.equal(true);
              expect(BigInt(cluster.cluster.validatorCount)).to.not.equal(0n);

              await expect(
                ctx.network.connect(cluster.owner).deposit(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                  { value: 1n },
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INCORRECT_CLUSTER_VERSION);

              await expect(
                ctx.network.connect(cluster.owner).withdraw(
                  cluster.operatorIds, 1n, cluster.cluster,
                ),
              ).to.be.revertedWithCustomError(ctx.network, Errors.INCORRECT_CLUSTER_VERSION);

              // Compute minViable: burn rate uses only 10 normal ops (zero-fee contribute 0, removed skipped)
              const normalOpCount = ctx.state.ssvFees.filter(
                (f, i) => f !== 0n && !ctx.state.removedOperatorIds.includes(cluster.operatorIds[i]),
              ).length;
              const valCount = BigInt(cluster.cluster.validatorCount);
              const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
              const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
              const burnRate = BigInt(normalOpCount) * packedOpFee;
              const vUnits = valCount * BPS_DENOMINATOR;
              const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (burnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
              const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
              const minViable = liquidationThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
                ? liquidationThreshold
                : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

              // Boundary revert
              if (minViable > 0n) {
                const underfunded = minViable - 1n;
                await setAccountBalance(ctx.provider, cluster.owner.address, underfunded + 10n ** 18n);
                await expect(
                  ctx.network.connect(cluster.owner).migrateClusterToETH(
                    cluster.operatorIds, cluster.cluster,
                    { value: underfunded },
                  ),
                ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);
              }

              // Phase 3: migration
              const ethDepositMax = minViable + DEFAULT_ETH_REGISTER_VALUE;
              const migrateStep = migrateLegacyCluster<State>(minViable, ethDepositMax);
              await migrateStep(ctx);

              // Post-migration assertions
              await assertLargeClusterMigrationEvents(ctx as any);
              await assertLegacyMigrationRefund(ctx as any);

              const snap = ctx.state.migrationSnapshot!;
              const activeSsvFees = ctx.state.ssvFees.filter(
                (_, i) => !ctx.state.removedOperatorIds.includes(cluster.operatorIds[i]),
              );
              const packedSsvFeeSum = activeSsvFees.reduce((sum, f) => sum + f / DEDUCTED_DIGITS, 0n);
              const packedSsvNetFee = NETWORK_FEE / DEDUCTED_DIGITS;
              const expectedSsvBurnRate = (packedSsvFeeSum + packedSsvNetFee) * valCount * DEDUCTED_DIGITS;
              expect(snap.ssvBurnRate).to.equal(
                expectedSsvBurnRate,
                "SSV burn rate must match first-principles (12 active ops × fees + network fee)",
              );

              const currentBlock = BigInt(await ctx.provider.getBlockNumber());
              const blocksSinceRemoval = currentBlock - 1n - ctx.state.blockAfterRemoval;
              const expectedSsvBalance = ctx.state.ssvBalanceAfterRemoval - expectedSsvBurnRate * blocksSinceRemoval;
              expect(snap.ssvBalanceBefore).to.equal(
                expectedSsvBalance,
                "SSV balance must equal post-removal balance minus burn over actual elapsed blocks",
              );

              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              // Inline: removed op has zero ETH earnings
              const removedEarnings = BigInt(
                await ctx.views.getOperatorEarnings(ctx.state.removedOperator.id),
              );
              expect(removedEarnings).to.equal(0n, "Removed operator must have zero ETH earnings");

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              // Phase 4: post-migration lifecycle
              const postMigrationBlocks = Number(ctx.rng.nextInRange(30n, 200n));
              await mineBlocks(ctx.provider, postMigrationBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              // registerValidator reverts (removed op in cluster)
              let regReverted = false;
              try {
                const tx = await ctx.network.connect(cluster.owner).registerValidator(
                  makePublicKey(5000), cluster.operatorIds, DEFAULT_SHARES, cluster.cluster,
                  { value: 0n },
                );
                await tx.wait();
              } catch {
                regReverted = true;
              }
              expect(regReverted, "registerValidator must revert with removed operator in cluster").to.equal(true);

              // Withdraw + deposit succeed
              const clusterBalance = BigInt(
                await ctx.views.getBalance(
                  cluster.owner.address, cluster.operatorIds, cluster.cluster,
                ),
              );
              const withdrawPct = ctx.rng.nextInRange(10n, 50n);
              const withdrawAmount = (clusterBalance * withdrawPct) / 100n;
              if (withdrawAmount > 0n) {
                const wTx = await ctx.network.connect(cluster.owner).withdraw(
                  cluster.operatorIds, withdrawAmount, cluster.cluster,
                );
                const wReceipt = await wTx.wait();
                cluster.cluster = parseClusterFromEvent(ctx.network, wReceipt, Events.CLUSTER_WITHDRAWN);
                ctx.state.tracker.totalWithdrawn += withdrawAmount;
              }

              const depositAmount = ctx.rng.nextInRange(10n ** 17n, DEFAULT_ETH_REGISTER_VALUE);
              await setAccountBalance(ctx.provider, cluster.owner.address, depositAmount + 10n ** 18n);
              const depTx = await ctx.network.connect(cluster.owner).deposit(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
                { value: depositAmount },
              );
              const depReceipt = await depTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, depReceipt, Events.CLUSTER_DEPOSITED);
              ctx.state.tracker.totalDeposited += depositAmount;

              // Reset snapshots after withdraw+deposit
              ctx.state.lastPhaseAwareOperatorEarnings = undefined;
              ctx.state.lastPhaseAwareClusterBalance = undefined;
              ctx.state.lastPhaseAwareNetworkEarnings = undefined;
              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              await assertLegacyOperatorDualTracking(ctx);
              await assertNetworkValidatorCount(ctx);

              // Removed op earnings still zero
              const removedEarningsFinal = BigInt(
                await ctx.views.getOperatorEarnings(ctx.state.removedOperator.id),
              );
              expect(removedEarningsFinal).to.equal(0n, "Removed operator must still have zero ETH earnings");

              await assertEthConservation(ctx);

              ctx.state.phase = "post-migration-complete";
            },
          },
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
