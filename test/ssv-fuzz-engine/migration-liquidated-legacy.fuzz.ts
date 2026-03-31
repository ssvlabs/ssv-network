import { fuzz, generateSeeds } from "./core/runner.ts";
import type { ClusterRecord, FuzzContext, OperatorRecord, StepFn } from "./core/types.ts";
import {
  assertLiquidatedLegacyEnsureETHDefaultsTransition,
  assertLiquidatedLegacyMigrationReactivated,
  assertLiquidatedLegacyMigrationRefund,
  assertLiquidatedLegacyNetworkValidatorCountTransition,
  assertLiquidatedLegacyOperatorTrackingTransition,
  assertLiquidatedLegacyPostMigrationValidatorCount,
  assertLiquidatedLegacyPostUpgradeSnapshot,
  assertLiquidatedLegacyQuantitativeInvariants,
  assertLiquidatedLegacyVersionTransition,
  type ClusterBalanceWithDeltasSnapshot,
  type ContractBalanceWithDeltasSnapshot,
  type LiquidatedLegacyPostUpgradeSnapshot,
  type NetworkEarningsSnapshot,
  type OperatorEarningsSnapshot,
} from "./core/assertions.ts";
import {
  calcLiquidationThreshold,
  defaultVUnits,
  extractEventArgs,
  makePublicKey,
  mineBlocks,
  parseClusterFromEvent,
  setAccountBalance,
  setupLiquidatedLegacyClusterAndUpgrade,
} from "../helpers/index.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
} from "../common/constants.ts";
import { Events } from "../common/events.ts";

type Phase =
  | "post-upgrade-liquidated-legacy"
  | "migrated-reactivated"
  | "post-migration-accrued"
  | "post-migration-complete";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  ssvToken: any;
  tracker: { totalDeposited: bigint; totalWithdrawn: bigint };
  phase: Phase;
  migrationEthDeposit: bigint;
  postUpgradeBlocks: bigint;
  postMigrationBlocks: bigint;
  nextKeyOffset: number;
  postUpgradeSnapshot: LiquidatedLegacyPostUpgradeSnapshot;
  actualRefund?: bigint;
  migrationEventRefund?: bigint;
  migrationEventEthDeposited?: bigint;
  reactivatedEmitted?: boolean;
  migrationBlockNumber?: bigint;
  defaultFeeExecutedEvents?: Map<number, { owner: string; blockNumber: bigint; fee: bigint }>;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
  lastClusterBalanceWithDeltas?: ClusterBalanceWithDeltasSnapshot;
  lastOperatorEarnings?: OperatorEarningsSnapshot;
  lastNetworkEarnings?: NetworkEarningsSnapshot;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

function migrateLiquidatedLegacyCluster<S extends State>(): StepFn<S> {
  return async function migrateLiquidatedLegacyCluster(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, ssvToken, phase, migrationEthDeposit, tracker } = ctx.state;
    if (phase !== "post-upgrade-liquidated-legacy") return;

    await setAccountBalance(ctx.provider, cluster.owner.address, migrationEthDeposit + 10n ** 18n);

    const ownerSSVBefore = BigInt(await ssvToken.balanceOf(cluster.owner.address));
    const tx = await ctx.network
      .connect(cluster.owner)
      .migrateClusterToETH(cluster.operatorIds, cluster.cluster, { value: migrationEthDeposit });
    const receipt = await tx.wait();

    cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
    tracker.totalDeposited += migrationEthDeposit;
    ctx.state.migrationBlockNumber = BigInt(receipt!.blockNumber);

    const eventArgs = extractEventArgs(ctx.network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const defaultFeeExecutedEvents = new Map<number, { owner: string; blockNumber: bigint; fee: bigint }>();
    let reactivatedEmitted = false;

    for (const log of receipt?.logs ?? []) {
      let parsed;
      try {
        parsed = ctx.network.interface.parseLog(log);
      } catch {
        continue;
      }

      if (parsed?.name === Events.CLUSTER_REACTIVATED) {
        reactivatedEmitted = true;
        continue;
      }

      if (parsed?.name !== Events.OPERATOR_FEE_EXECUTED) continue;

      defaultFeeExecutedEvents.set(Number(parsed.args[1]), {
        owner: String(parsed.args[0]),
        blockNumber: BigInt(parsed.args[2]),
        fee: BigInt(parsed.args[3]),
      });
    }

    const ownerSSVAfter = BigInt(await ssvToken.balanceOf(cluster.owner.address));
    ctx.state.actualRefund = ownerSSVAfter - ownerSSVBefore;
    ctx.state.migrationEventRefund = BigInt(eventArgs.ssvRefunded);
    ctx.state.migrationEventEthDeposited = BigInt(eventArgs.ethDeposited);
    ctx.state.reactivatedEmitted = reactivatedEmitted;
    ctx.state.defaultFeeExecutedEvents = defaultFeeExecutedEvents;
    ctx.state.phase = "migrated-reactivated";
  };
}

function advanceLiquidatedLegacyPostMigrationWindow<S extends State>(): StepFn<S> {
  return async function advanceLiquidatedLegacyPostMigrationWindow(ctx: FuzzContext<S>): Promise<void> {
    if (ctx.state.phase !== "migrated-reactivated") return;
    await mineBlocks(ctx.provider, Number(ctx.state.postMigrationBlocks));
    ctx.state.phase = "post-migration-accrued";
  };
}

function registerLiquidatedLegacyValidatorPostMigration<S extends State>(): StepFn<S> {
  return async function registerLiquidatedLegacyValidatorPostMigration(ctx: FuzzContext<S>): Promise<void> {
    const { cluster, phase, nextKeyOffset, tracker } = ctx.state;
    if (phase !== "post-migration-accrued") return;

    await setAccountBalance(ctx.provider, cluster.owner.address, DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n);
    const validatorKey = makePublicKey(nextKeyOffset);
    const tx = await ctx.network.connect(cluster.owner).registerValidator(
      validatorKey,
      cluster.operatorIds,
      DEFAULT_SHARES,
      cluster.cluster,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const receipt = await tx.wait();

    cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_ADDED);
    cluster.validatorKeys.push(validatorKey);
    tracker.totalDeposited += DEFAULT_ETH_REGISTER_VALUE;
    ctx.state.nextKeyOffset += 1;
    ctx.state.phase = "post-migration-complete";
  };
}

describe("Fuzz: CAT-1-2 liquidated legacy cluster migration lifecycle", function () {
  for (const seed of seeds) {
    it(`Validates liquidated legacy migration reactivation with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;
          const postUpgradeBlocks = ctx.rng.nextInRange(0n, 500n);

          const {
            newNetwork,
            newViews,
            ssvToken,
            operatorIds,
            cluster,
            validatorKey,
          } = await setupLiquidatedLegacyClusterAndUpgrade(
            ctx.connection,
            operatorOwner,
            clusterOwner,
            postUpgradeBlocks,
          );

          ctx.network = newNetwork;
          ctx.views = newViews;
          ctx.ssvToken = ssvToken;

          const feeRaw = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
          const networkFeeRaw = BigInt(await ctx.views.getNetworkFee()) / ETH_DEDUCTED_DIGITS;
          const threshold = calcLiquidationThreshold({
            minimumBlocksBeforeLiquidation: BigInt(await ctx.views.getLiquidationThresholdPeriod()),
            numOperators: 4n,
            ethFee: feeRaw,
            networkFee: networkFeeRaw,
            effectiveVUnits: defaultVUnits(1n),
          });
          const migrationEthDeposit = threshold + ctx.rng.nextInRange(0n, DEFAULT_ETH_REGISTER_VALUE);

          const operatorSSVValidatorCounts = new Map<number, bigint>();
          const operatorETHValidatorCounts = new Map<number, bigint>();
          const operatorETHFees = new Map<number, bigint>();
          for (const opId of operatorIds) {
            const opSSV = await ctx.views.getOperatorByIdSSV(opId);
            const opETH = await ctx.views.getOperatorById(opId);
            operatorSSVValidatorCounts.set(opId, BigInt(opSSV.validatorCount));
            operatorETHValidatorCounts.set(opId, BigInt(opETH.validatorCount));
            operatorETHFees.set(opId, BigInt(opETH.fee));
          }

          const postUpgradeSnapshot: LiquidatedLegacyPostUpgradeSnapshot = {
            networkValidatorCount: BigInt(await ctx.views.getNetworkValidatorsCount()),
            operatorSSVValidatorCounts,
            operatorETHValidatorCounts,
            operatorETHFees,
          };

          return {
            operators: operatorIds.map((id) => ({ id, fee: DEFAULT_OPERATOR_ETH_FEE, owner: operatorOwner })),
            cluster: {
              cluster,
              operatorIds,
              owner: clusterOwner,
              validatorKeys: [validatorKey],
            },
            ssvToken,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
            phase: "post-upgrade-liquidated-legacy" as const,
            migrationEthDeposit,
            postUpgradeBlocks,
            postMigrationBlocks: 100n,
            nextKeyOffset: 124,
            postUpgradeSnapshot,
          };
        },

        steps: [
          assertLiquidatedLegacyPostUpgradeSnapshot,
          assertLiquidatedLegacyVersionTransition,
          assertLiquidatedLegacyOperatorTrackingTransition,
          assertLiquidatedLegacyNetworkValidatorCountTransition,
          migrateLiquidatedLegacyCluster(),
          assertLiquidatedLegacyVersionTransition,
          assertLiquidatedLegacyMigrationRefund,
          assertLiquidatedLegacyMigrationReactivated,
          assertLiquidatedLegacyEnsureETHDefaultsTransition,
          assertLiquidatedLegacyOperatorTrackingTransition,
          assertLiquidatedLegacyNetworkValidatorCountTransition,
          assertLiquidatedLegacyQuantitativeInvariants,
          advanceLiquidatedLegacyPostMigrationWindow(),
          assertLiquidatedLegacyVersionTransition,
          assertLiquidatedLegacyMigrationRefund,
          assertLiquidatedLegacyEnsureETHDefaultsTransition,
          assertLiquidatedLegacyOperatorTrackingTransition,
          assertLiquidatedLegacyNetworkValidatorCountTransition,
          assertLiquidatedLegacyQuantitativeInvariants,
          registerLiquidatedLegacyValidatorPostMigration(),
          assertLiquidatedLegacyVersionTransition,
          assertLiquidatedLegacyMigrationRefund,
          assertLiquidatedLegacyEnsureETHDefaultsTransition,
          assertLiquidatedLegacyOperatorTrackingTransition,
          assertLiquidatedLegacyNetworkValidatorCountTransition,
          assertLiquidatedLegacyQuantitativeInvariants,
          assertLiquidatedLegacyPostMigrationValidatorCount,
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
