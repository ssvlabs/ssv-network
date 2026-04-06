import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, alignFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { DepositWithdrawTracker } from "./core/steps.ts";
import {
  assertOperatorValidatorCounts,
  assertNetworkValidatorCount,
  assertPhaseAwareOperatorEarnings,
  assertPhaseAwareNetworkEarnings,
  assertPhaseAwareClusterBalance,
  assertContractBalanceWithDeltas,
  assertEthConservation,
  type PhaseAwareOperatorEarningsSnapshot,
  type PhaseAwareNetworkEarningsSnapshot,
  type PhaseAwareClusterBalanceSnapshot,
  type ContractBalanceWithDeltasSnapshot,
} from "./core/assertions.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { makePublicKey } from "../helpers/keys.ts";
import { setAccountBalance, mineBlocks } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../common/constants.ts";

interface State {
  cluster: ClusterRecord;
  operators: OperatorRecord[];
  phase: string;
  tracker: DepositWithdrawTracker;
  lastPhaseAwareOperatorEarnings?: PhaseAwareOperatorEarningsSnapshot;
  lastPhaseAwareClusterBalance?: PhaseAwareClusterBalanceSnapshot;
  lastPhaseAwareNetworkEarnings?: PhaseAwareNetworkEarningsSnapshot;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH cluster full lifecycle (CAT-2-1)", function () {
  for (const seed of seeds) {
    it(`Validates full ETH cluster lifecycle with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const operatorCount = ctx.rng.pick([4, 7, 10, 13]);
          const fees: bigint[] = [];
          for (let i = 0; i < operatorCount; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees, false);
          const operatorIds = operators.map((o) => o.id);

          return {
            operators,
            cluster: {
              cluster: { ...EMPTY_CLUSTER },
              operatorIds,
              owner: clusterOwner,
              validatorKeys: [],
            },
            phase: "setup",
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
          };
        },

        steps: [
          // Phase 1 — Create (single registerValidator)
          {
            name: "phase1-create",
            async fn(ctx) {
              const { cluster, operators, tracker } = ctx.state;
              const totalOpFee = operators.reduce((sum, op) => sum + op.fee, 0n);
              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const packedRate = totalOpFee / ETH_DEDUCTED_DIGITS + networkFee / ETH_DEDUCTED_DIGITS;
              const vUnits = BPS_DENOMINATOR;
              const minBlocks = MINIMUM_BLOCKS_BEFORE_LIQUIDATION;
              const threshold = (minBlocks * packedRate * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
              const minCollateral = MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;
              const minViable = threshold > minCollateral ? threshold : minCollateral;

              const initialDeposit = ctx.rng.nextInRange(minViable + DEFAULT_ETH_REGISTER_VALUE / 10n, minViable + DEFAULT_ETH_REGISTER_VALUE * 3n);
              await setAccountBalance(ctx.provider, cluster.owner.address, initialDeposit + 10n ** 18n);

              const key = makePublicKey(2000);
              const tx = await ctx.network.connect(cluster.owner).registerValidator(
                key, cluster.operatorIds, DEFAULT_SHARES, cluster.cluster, { value: initialDeposit },
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_ADDED);
              cluster.validatorKeys.push(key);
              tracker.totalDeposited += initialDeposit;

              expect(BigInt(cluster.cluster.validatorCount)).to.equal(1n);
              expect(cluster.cluster.active).to.equal(true);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "created";
            },
          },

          // Phase 2 — Grow (bulkRegisterValidator)
          {
            name: "phase2-grow",
            async fn(ctx) {
              const { cluster, tracker } = ctx.state;
              const phase2Blocks = Number(ctx.rng.nextInRange(10n, 50n));
              await mineBlocks(ctx.provider, phase2Blocks);

              const additionalCount = Number(ctx.rng.nextInRange(2n, 8n));
              const perValidatorDeposit = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE / 5n, DEFAULT_ETH_REGISTER_VALUE * 2n);
              const growDeposit = perValidatorDeposit * BigInt(additionalCount);
              await setAccountBalance(ctx.provider, cluster.owner.address, growDeposit + 10n ** 18n);

              const keys: string[] = [];
              const shares: string[] = [];
              for (let i = 0; i < additionalCount; i++) {
                const key = makePublicKey(2001 + i);
                keys.push(key);
                shares.push(DEFAULT_SHARES);
              }

              const tx = await ctx.network.connect(cluster.owner).bulkRegisterValidator(
                keys, cluster.operatorIds, shares, cluster.cluster, { value: growDeposit },
              );
              const receipt = await tx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_ADDED);
              cluster.validatorKeys.push(...keys);
              tracker.totalDeposited += growDeposit;

              expect(BigInt(cluster.cluster.validatorCount)).to.equal(BigInt(1 + additionalCount));
              expect(cluster.cluster.active).to.equal(true);

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);
              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);

              ctx.state.phase = "grown";
            },
          },

          // Phase 3 — Deposit + Withdraw
          {
            name: "phase3-deposit-withdraw",
            async fn(ctx) {
              const { cluster, tracker } = ctx.state;

              const preDepositBlocks = Number(ctx.rng.nextInRange(50n, 200n));
              await mineBlocks(ctx.provider, preDepositBlocks);

              const depositAmount = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE / 2n, DEFAULT_ETH_REGISTER_VALUE * 5n);
              await setAccountBalance(ctx.provider, cluster.owner.address, depositAmount + 10n ** 18n);

              const depositTx = await ctx.network.connect(cluster.owner).deposit(
                cluster.owner.address, cluster.operatorIds, cluster.cluster, { value: depositAmount },
              );
              const depositReceipt = await depositTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, depositReceipt, Events.CLUSTER_DEPOSITED);
              tracker.totalDeposited += depositAmount;

              const postDepositBlocks = Number(ctx.rng.nextInRange(20n, 100n));
              await mineBlocks(ctx.provider, postDepositBlocks);

              const balance = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const withdrawPct = ctx.rng.nextInRange(10n, 50n);
              const withdrawAmount = (balance * withdrawPct) / 100n;

              if (withdrawAmount > 0n) {
                const withdrawTx = await ctx.network.connect(cluster.owner).withdraw(
                  cluster.operatorIds, withdrawAmount, cluster.cluster,
                );
                const withdrawReceipt = await withdrawTx.wait();
                cluster.cluster = parseClusterFromEvent(ctx.network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);
                tracker.totalWithdrawn += withdrawAmount;
              }

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(false, "Cluster must not be liquidatable after partial withdrawal");

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);
              await assertEthConservation(ctx);

              ctx.state.phase = "deposit-withdraw";
            },
          },

          // Phase 4 — Shrink (single remove + bulk remove)
          {
            name: "phase4-shrink",
            async fn(ctx) {
              const { cluster } = ctx.state;
              const phase4Blocks = Number(ctx.rng.nextInRange(10n, 50n));
              await mineBlocks(ctx.provider, phase4Blocks);

              const totalValidators = cluster.validatorKeys.length;
              expect(totalValidators).to.be.greaterThanOrEqual(3, "Need at least 3 validators for shrink phase");

              const singleKey = cluster.validatorKeys.splice(0, 1)[0];
              const singleTx = await ctx.network.connect(cluster.owner).removeValidator(
                singleKey, cluster.operatorIds, cluster.cluster,
              );
              const singleReceipt = await singleTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, singleReceipt, Events.VALIDATOR_REMOVED);

              const remaining = cluster.validatorKeys.length;
              const maxBulkRemove = remaining - 1;
              const bulkRemoveCount = maxBulkRemove <= 1
                ? 1
                : Number(ctx.rng.nextInRange(1n, BigInt(maxBulkRemove)));
              const bulkKeys = cluster.validatorKeys.splice(0, bulkRemoveCount);

              const bulkTx = await ctx.network.connect(cluster.owner).bulkRemoveValidator(
                bulkKeys, cluster.operatorIds, cluster.cluster,
              );
              const bulkReceipt = await bulkTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, bulkReceipt, Events.VALIDATOR_REMOVED);

              const expectedRemaining = totalValidators - 1 - bulkRemoveCount;
              expect(BigInt(cluster.cluster.validatorCount)).to.equal(BigInt(expectedRemaining));
              expect(cluster.validatorKeys.length).to.equal(expectedRemaining);
              expect(cluster.cluster.active).to.equal(true);

              ctx.state.lastPhaseAwareOperatorEarnings = undefined;
              ctx.state.lastPhaseAwareClusterBalance = undefined;
              ctx.state.lastPhaseAwareNetworkEarnings = undefined;

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);
              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);

              ctx.state.phase = "shrunk";
            },
          },

          // Phase 5 — Liquidation
          {
            name: "phase5-liquidation",
            async fn(ctx) {
              const { cluster, operators, tracker } = ctx.state;
              const liquidator = ctx.signers[4];

              const balance = BigInt(
                await ctx.views.getBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );
              const burnRate = BigInt(
                await ctx.views.getBurnRate(cluster.owner.address, cluster.operatorIds, cluster.cluster),
              );

              if (burnRate > 0n) {
                const blocksUntilDrained = balance / burnRate;
                const blocksToMine = Number(blocksUntilDrained) + 1;
                await mineBlocks(ctx.provider, blocksToMine);
              }

              const isLiq = await ctx.views.isLiquidatable(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              expect(isLiq).to.equal(true, "Cluster must be liquidatable after draining balance");

              const contractAddress = await ctx.network.getAddress();
              const contractEthBefore = BigInt(await ctx.provider.getBalance(contractAddress));
              const liquidatorEthBefore = BigInt(await ctx.provider.getBalance(liquidator.address));

              const liqTx = await ctx.network.connect(liquidator).liquidate(
                cluster.owner.address, cluster.operatorIds, cluster.cluster,
              );
              const liqReceipt = await liqTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, liqReceipt, Events.CLUSTER_LIQUIDATED);

              expect(cluster.cluster.active).to.equal(false);
              expect(BigInt(cluster.cluster.balance)).to.equal(0n);

              const contractEthAfter = BigInt(await ctx.provider.getBalance(contractAddress));
              const bounty = contractEthBefore - contractEthAfter;
              const liquidatorEthAfter = BigInt(await ctx.provider.getBalance(liquidator.address));
              const gasCost = liqReceipt!.gasUsed * liqReceipt!.gasPrice;
              expect(liquidatorEthAfter).to.equal(
                liquidatorEthBefore + bounty - gasCost,
                "Liquidator must receive full cluster balance as bounty",
              );

              tracker.totalWithdrawn += bounty;

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              ctx.state.phase = "liquidated";
            },
          },

          // Phase 6 — Reactivation
          {
            name: "phase6-reactivation",
            async fn(ctx) {
              const { cluster, operators, tracker } = ctx.state;
              const validatorCount = BigInt(cluster.cluster.validatorCount);
              const vUnits = validatorCount * BPS_DENOMINATOR;

              const totalOpFee = operators.reduce((sum, op) => sum + op.fee, 0n);
              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const packedRate = totalOpFee / ETH_DEDUCTED_DIGITS + networkFee / ETH_DEDUCTED_DIGITS;
              const minBlocks = MINIMUM_BLOCKS_BEFORE_LIQUIDATION;
              const threshold = (minBlocks * packedRate * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
              const minCollateral = MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;
              const minViable = threshold > minCollateral ? threshold : minCollateral;

              const reactivateDeposit = ctx.rng.nextInRange(minViable, minViable + DEFAULT_ETH_REGISTER_VALUE);
              await setAccountBalance(ctx.provider, cluster.owner.address, reactivateDeposit + 10n ** 18n);

              const reactivateTx = await ctx.network.connect(cluster.owner).reactivate(
                cluster.operatorIds, cluster.cluster, { value: reactivateDeposit },
              );
              const reactivateReceipt = await reactivateTx.wait();
              cluster.cluster = parseClusterFromEvent(ctx.network, reactivateReceipt, Events.CLUSTER_REACTIVATED);
              tracker.totalDeposited += reactivateDeposit;

              expect(cluster.cluster.active).to.equal(true);

              ctx.state.phase = "reactivated";
              ctx.state.lastPhaseAwareOperatorEarnings = undefined;
              ctx.state.lastPhaseAwareClusterBalance = undefined;
              ctx.state.lastPhaseAwareNetworkEarnings = undefined;

              await assertOperatorValidatorCounts(ctx);
              await assertNetworkValidatorCount(ctx);

              const postReactivationBlocks = Number(ctx.rng.nextInRange(30n, 100n));
              await mineBlocks(ctx.provider, postReactivationBlocks);

              await assertPhaseAwareOperatorEarnings(ctx);
              await assertPhaseAwareClusterBalance(ctx);
              await assertPhaseAwareNetworkEarnings(ctx);
              await assertContractBalanceWithDeltas(ctx);
            },
          },
        ],

        expectedPhase: "reactivated",
      }, seed);
    });
  }
});
