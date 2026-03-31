import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed } from "./core/setup.ts";
import type { ClusterRecord, OperatorRecord } from "./core/types.ts";
import {
  assertBlockedEthOpsOnLegacyCluster,
  assertRemovedValidatorReRegisterBlocked,
  migrateLegacyCluster,
  removeLegacyValidator,
  runPostMigrationEthLifecycle,
  type DepositWithdrawTracker,
} from "./core/steps.ts";
import {
  assertLegacyMigrationRefund,
  assertLegacyNetworkValidatorCountTransition,
  assertLegacyOperatorDefaults,
  assertLegacyOperatorTrackingTransition,
  assertLegacyPostMigrationValidatorCount,
  assertLegacyVersionExclusivity,
} from "./core/assertions.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  SMALL_ETH_REGISTER_VALUE,
  TOKEN_REGISTER_AMOUNT,
} from "../common/constants.ts";
import { calcLiquidationThreshold, defaultVUnits } from "../helpers/index.ts";

interface LegacyMigrationState {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  operatorIds: number[];
  legacyValidatorKeys: string[];
  clusterOwner: OperatorRecord["owner"];
  operatorOwner: OperatorRecord["owner"];
  ssvToken: any;
  tracker: DepositWithdrawTracker;
  phase: "post-upgrade-legacy" | "migrated" | "post-migration-complete";
  preUpgradeBlocks: bigint;
  postMigrationBlocks: bigint;
  migrationEthDeposit: bigint;
  removedValidatorKey?: string;
  expectedRefund?: bigint;
  actualRefund?: bigint;
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

          return {
            ...seedState,
            clusterOwner,
            operatorOwner,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
            phase: "post-upgrade-legacy" as const,
            preUpgradeBlocks,
            postMigrationBlocks,
            migrationEthDeposit,
          };
        },

        steps: [
          assertBlockedEthOpsOnLegacyCluster(),
          removeLegacyValidator(),
          assertLegacyVersionExclusivity,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          assertRemovedValidatorReRegisterBlocked(),
          migrateLegacyCluster(),
          assertLegacyVersionExclusivity,
          assertLegacyMigrationRefund,
          assertLegacyOperatorDefaults,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          runPostMigrationEthLifecycle(),
          assertLegacyVersionExclusivity,
          assertLegacyMigrationRefund,
          assertLegacyOperatorDefaults,
          assertLegacyOperatorTrackingTransition,
          assertLegacyNetworkValidatorCountTransition,
          assertLegacyPostMigrationValidatorCount,
        ],

        expectedPhase: "post-migration-complete",
      }, seed);
    });
  }
});
