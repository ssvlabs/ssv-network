import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed } from "./core/setup.ts";
import type { ClusterRecord, OperatorRecord } from "./core/types.ts";
import {
  advanceLegacyPostMigrationWindow,
  assertBlockedEthOpsOnLegacyCluster,
  assertRemovedValidatorReRegisterBlocked,
  depositToLegacyMigratedCluster,
  migrateLegacyCluster,
  removeLegacyValidator,
  registerRemovedLegacyValidatorPostMigration,
  type DepositWithdrawTracker,
  withdrawFromLegacyMigratedCluster,
} from "./core/steps.ts";
import {
  assertLegacyEnsureETHDefaultsTransition,
  assertLegacyMigrationRefund,
  assertLegacyNetworkValidatorCountTransition,
  assertLegacyOperatorDefaults,
  assertLegacyOperatorTrackingTransition,
  assertLegacyPostMigrationValidatorCount,
  assertLegacyPostUpgradeSnapshot,
  assertLegacyQuantitativeInvariants,
  assertLegacyVersionExclusivity,
  type LegacyPostUpgradeSnapshot,
  type ClusterBalanceWithDeltasSnapshot,
  type ContractBalanceWithDeltasSnapshot,
  type NetworkEarningsSnapshot,
  type OperatorEarningsSnapshot,
} from "./core/assertions.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  SMALL_ETH_REGISTER_VALUE,
  TOKEN_REGISTER_AMOUNT,
} from "../common/constants.ts";
import { calcLiquidationThreshold, defaultVUnits } from "../helpers/index.ts";

type LegacyMigrationPhase =
  | "post-upgrade-legacy"
  | "migrated"
  | "post-migration-accrued"
  | "post-migration-registered"
  | "post-migration-deposited"
  | "post-migration-complete";

interface LegacyMigrationState {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  operatorIds: number[];
  legacyValidatorKeys: string[];
  clusterOwner: OperatorRecord["owner"];
  operatorOwner: OperatorRecord["owner"];
  ssvToken: any;
  tracker: DepositWithdrawTracker;
  phase: LegacyMigrationPhase;
  preUpgradeBlocks: bigint;
  postMigrationBlocks: bigint;
  migrationEthDeposit: bigint;
  totalSsvDeposit: bigint;
  postUpgradeSnapshot: LegacyPostUpgradeSnapshot;
  removedValidatorKey?: string;
  expectedRefund?: bigint;
  actualRefund?: bigint;
  migrationBlockNumber?: bigint;
  defaultFeeExecutedEvents?: Map<number, { owner: string; blockNumber: bigint; fee: bigint }>;
  lastContractBalanceWithDeltas?: ContractBalanceWithDeltasSnapshot;
  lastClusterBalanceWithDeltas?: ClusterBalanceWithDeltasSnapshot;
  lastOperatorEarnings?: OperatorEarningsSnapshot;
  lastNetworkEarnings?: NetworkEarningsSnapshot;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

describe("Fuzz: CAT-1-1 healthy legacy cluster migration lifecycle", function () {
  for (const seed of seeds) {
    it(`Validates the fixed CAT-1-1 legacy-upgrade-migrate-ETH path with seed=${seed}`, async function () {
      await fuzz<LegacyMigrationState>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const preUpgradeBlocks = ctx.rng.nextInRange(100n, 1000n);
          const postMigrationBlocks = ctx.rng.nextInRange(1n, 250n);
          const extraSsvFunding = ctx.rng.nextInRange(0n, TOKEN_REGISTER_AMOUNT * 4n);
          const totalSsvDeposit = TOKEN_REGISTER_AMOUNT * 3n + extraSsvFunding;

          const seedState = await setupLegacyMigrationSeed(ctx, {
            clusterOwner,
            operatorOwner,
            totalSsvDeposit,
            preUpgradeBlocks,
          });

          const feeRaw = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
          const networkFeeRaw = BigInt(await ctx.views.getNetworkFee()) / ETH_DEDUCTED_DIGITS;
          const threshold = calcLiquidationThreshold({
            minimumBlocksBeforeLiquidation: BigInt(await ctx.views.getLiquidationThresholdPeriod()),
            numOperators: 4n,
            ethFee: feeRaw,
            networkFee: networkFeeRaw,
            effectiveVUnits: defaultVUnits(2n),
          });
          const migrationEthDeposit = threshold + ctx.rng.nextInRange(
            SMALL_ETH_REGISTER_VALUE,
            DEFAULT_ETH_REGISTER_VALUE,
          );

          const operatorSSVValidatorCounts = new Map<number, bigint>();
          const operatorETHValidatorCounts = new Map<number, bigint>();
          const operatorETHFees = new Map<number, bigint>();
          for (const op of seedState.operators) {
            const opSSV = await ctx.views.getOperatorByIdSSV(op.id);
            const opETH = await ctx.views.getOperatorById(op.id);
            operatorSSVValidatorCounts.set(op.id, BigInt(opSSV.validatorCount));
            operatorETHValidatorCounts.set(op.id, BigInt(opETH.validatorCount));
            operatorETHFees.set(op.id, BigInt(opETH.fee));
          }

          const postUpgradeSnapshot: LegacyPostUpgradeSnapshot = {
            balanceSSV: BigInt(
              await ctx.views.getBalanceSSV(
                seedState.cluster.owner.address,
                seedState.cluster.operatorIds,
                seedState.cluster.cluster,
              ),
            ),
            burnRateSSV: BigInt(
              await ctx.views.getBurnRateSSV(
                seedState.cluster.owner.address,
                seedState.cluster.operatorIds,
                seedState.cluster.cluster,
              ),
            ),
            networkValidatorCount: BigInt(await ctx.views.getNetworkValidatorsCount()),
            networkFee: BigInt(await ctx.views.getNetworkFee()),
            liquidationThresholdPeriod: BigInt(await ctx.views.getLiquidationThresholdPeriod()),
            cssvTotalSupply: BigInt(await ctx.cssvToken.totalSupply()),
            accEthPerShare: BigInt(await ctx.views.accEthPerShare()),
            stakingEthPoolBalance: BigInt(await ctx.views.stakingEthPoolBalance()),
            networkEarnings: BigInt(await ctx.views.getNetworkEarnings()),
            operatorSSVValidatorCounts,
            operatorETHValidatorCounts,
            operatorETHFees,
          };

          return {
            ...seedState,
            clusterOwner,
            operatorOwner,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
            phase: "post-upgrade-legacy" as const,
            preUpgradeBlocks,
            postMigrationBlocks,
            migrationEthDeposit,
            totalSsvDeposit,
            postUpgradeSnapshot,
          };
        },

        steps: [
          assertLegacyPostUpgradeSnapshot,
          assertBlockedEthOpsOnLegacyCluster(),
          assertLegacyPostUpgradeSnapshot,
          removeLegacyValidator(),
          assertLegacyVersionExclusivity,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          assertRemovedValidatorReRegisterBlocked(),
          migrateLegacyCluster(),
          assertLegacyVersionExclusivity,
          assertLegacyMigrationRefund,
          assertLegacyEnsureETHDefaultsTransition,
          assertLegacyOperatorDefaults,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          assertLegacyQuantitativeInvariants,
          advanceLegacyPostMigrationWindow(),
          assertLegacyMigrationRefund,
          assertLegacyEnsureETHDefaultsTransition,
          assertLegacyOperatorDefaults,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          assertLegacyQuantitativeInvariants,
          registerRemovedLegacyValidatorPostMigration(),
          assertLegacyVersionExclusivity,
          assertLegacyMigrationRefund,
          assertLegacyEnsureETHDefaultsTransition,
          assertLegacyOperatorDefaults,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          assertLegacyQuantitativeInvariants,
          depositToLegacyMigratedCluster(),
          assertLegacyVersionExclusivity,
          assertLegacyMigrationRefund,
          assertLegacyEnsureETHDefaultsTransition,
          assertLegacyOperatorDefaults,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          assertLegacyQuantitativeInvariants,
          withdrawFromLegacyMigratedCluster(),
          assertLegacyVersionExclusivity,
          assertLegacyMigrationRefund,
          assertLegacyEnsureETHDefaultsTransition,
          assertLegacyOperatorDefaults,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          assertLegacyQuantitativeInvariants,
          assertLegacyPostMigrationValidatorCount,
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
