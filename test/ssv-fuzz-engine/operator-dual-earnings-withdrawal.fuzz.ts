import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { setupLegacyMigrationSeed, alignSSVFee, registerFuzzCluster, registerFuzzOperators } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { migrateLegacyCluster, type DepositWithdrawTracker, type LegacyMigrationSnapshot } from "./core/steps.ts";
import { Errors } from "../common/errors.ts";
import { generateRandomFees, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  DEDUCTED_DIGITS,
} from "../common/constants.ts";

type Phase =
  | "migrate"
  | "accrue"
  | "withdraw-eth"
  | "withdraw-ssv"
  | "withdraw-all-version"
  | "eth-only-ssv-revert"
  | "verified";

interface MigrateWrapper {
  cluster: ClusterRecord;
  tracker: DepositWithdrawTracker;
  phase: string;
  migrationSnapshot?: LegacyMigrationSnapshot;
}

interface State {
  legacyOperators: OperatorRecord[];
  legacyCluster: ClusterRecord;
  ethOnlyOperators: OperatorRecord[];
  ethOnlyCluster: ClusterRecord;
  phase: Phase;
  tracker: DepositWithdrawTracker;
  migrationSnapshot?: LegacyMigrationSnapshot;
  operatorOwner: HardhatEthersSigner;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { legacyOperators, legacyCluster, ethOnlyOperators } = ctx.state;

  if (ctx.state.phase === "migrate") {
    const wrapper: FuzzContext<MigrateWrapper> = {
      ...ctx,
      state: {
        cluster: ctx.state.legacyCluster,
        tracker: ctx.state.tracker,
        phase: "",
        migrationSnapshot: ctx.state.migrationSnapshot,
      },
    };
    const migrateStep = migrateLegacyCluster<MigrateWrapper>(
      DEFAULT_ETH_REGISTER_VALUE, DEFAULT_ETH_REGISTER_VALUE * 3n,
    );
    await migrateStep(wrapper);
    ctx.state.legacyCluster = wrapper.state.cluster;
    ctx.state.tracker = wrapper.state.tracker;
    ctx.state.migrationSnapshot = wrapper.state.migrationSnapshot;
    ctx.state.phase = "accrue";
    return;
  }

  if (ctx.state.phase === "accrue") {
    ctx.state.phase = "withdraw-eth";
    return;
  }

  if (ctx.state.phase === "withdraw-eth") {
    const op = legacyOperators[0];
    const ethEarnings = BigInt(await ctx.views.getOperatorEarnings(op.id));

    if (ethEarnings > 0n) {
      const raw = ctx.rng.nextInRange(ETH_DEDUCTED_DIGITS, ethEarnings);
      const amount = (raw / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
      const balBefore = BigInt(await ctx.provider.getBalance(op.owner.address));
      const tx = await ctx.network.connect(op.owner)
        .withdrawOperatorEarnings(op.id, amount);
      const receipt = await tx.wait();
      const gasUsed = BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice);
      const balAfter = BigInt(await ctx.provider.getBalance(op.owner.address));
      expect(balAfter).to.equal(balBefore + amount - gasUsed);
    }

    ctx.state.phase = "withdraw-ssv";
    return;
  }

  if (ctx.state.phase === "withdraw-ssv") {
    const op = legacyOperators[0];
    const ssvEarnings = BigInt(await ctx.views.getOperatorEarningsSSV(op.id));

    if (ssvEarnings >= DEDUCTED_DIGITS) {
      const raw = ctx.rng.nextInRange(DEDUCTED_DIGITS, ssvEarnings);
      const amount = (raw / DEDUCTED_DIGITS) * DEDUCTED_DIGITS;
      const tokenBefore = BigInt(await ctx.ssvToken.balanceOf(op.owner.address));
      await ctx.network.connect(op.owner)
        .withdrawOperatorEarningsSSV(op.id, amount);
      const tokenAfter = BigInt(await ctx.ssvToken.balanceOf(op.owner.address));
      expect(tokenAfter).to.equal(tokenBefore + amount);
    }

    ctx.state.phase = "withdraw-all-version";
    return;
  }

  if (ctx.state.phase === "withdraw-all-version") {
    const op = legacyOperators[1];

    const expectedEthEarnings = BigInt(await ctx.views.getOperatorEarnings(op.id));
    const expectedSSVEarnings = BigInt(await ctx.views.getOperatorEarningsSSV(op.id));

    const tokenBefore = BigInt(await ctx.ssvToken.balanceOf(op.owner.address));
    const balBefore = BigInt(await ctx.provider.getBalance(op.owner.address));

    const tx = await ctx.network.connect(op.owner)
      .withdrawAllVersionOperatorEarnings(op.id);
    const receipt = await tx.wait();
    const gasUsed = BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice);

    const balAfter = BigInt(await ctx.provider.getBalance(op.owner.address));
    const tokenAfter = BigInt(await ctx.ssvToken.balanceOf(op.owner.address));

    const ethWithdrawn = balAfter - balBefore + gasUsed;
    const ssvWithdrawn = tokenAfter - tokenBefore;

    const migrationValidatorCount = 2n;
    const oneBlockEthDelta = DEFAULT_OPERATOR_ETH_FEE * migrationValidatorCount;
    expect(ethWithdrawn).to.equal(expectedEthEarnings + oneBlockEthDelta);
    expect(ssvWithdrawn).to.equal(expectedSSVEarnings);

    expect(BigInt(await ctx.views.getOperatorEarnings(op.id))).to.equal(0n);
    expect(BigInt(await ctx.views.getOperatorEarningsSSV(op.id))).to.equal(0n);

    ctx.state.phase = "eth-only-ssv-revert";
    return;
  }

  if (ctx.state.phase === "eth-only-ssv-revert") {
    const op = ethOnlyOperators[0];
    const ssvEarnings = BigInt(await ctx.views.getOperatorEarningsSSV(op.id));
    expect(ssvEarnings).to.equal(0n);

    await expect(
      ctx.network.connect(op.owner)
        .withdrawOperatorEarningsSSV(op.id, 1n),
    ).to.be.revertedWithCustomError(ctx.network, Errors.INSUFFICIENT_BALANCE);

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: Operator dual ETH + SSV earnings withdrawal (CAT-4-6)", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 12,
        blocksPerTick: { min: 10n, max: 100n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner] = ctx.signers;

          const ssvFee = alignSSVFee(
            ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 3n),
          );

          const seed = await setupLegacyMigrationSeed(ctx, {
            operatorCount: 4,
            ssvFee,
            validatorCount: 2,
            ssvDepositPerValidator: ctx.rng.nextInRange(TOKEN_REGISTER_AMOUNT, TOKEN_REGISTER_AMOUNT * 3n),
            preUpgradeBlocks: Number(ctx.rng.nextInRange(50n, 200n)),
          });

          const legacyCluster: ClusterRecord = {
            cluster: seed.preUpgradeCluster,
            operatorIds: seed.operatorIds,
            owner: seed.clusterOwner,
            validatorKeys: [...seed.validatorKeys],
          };

          const ethOnlyOwner = ctx.signers[5];
          const ethOnlyFees = generateRandomFees(ctx, 4, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n);
          const ethOnlyOperators = await registerFuzzOperators(ctx, ethOnlyOwner, 4, ethOnlyFees, 5000);
          const ethOnlyIds = ethOnlyOperators.map(o => o.id);
          const ethClusterOwner = ctx.signers[6];
          const ethOnlyCluster = await registerFuzzCluster(
            ctx, ethClusterOwner, ethOnlyOwner, ethOnlyIds, 2, DEFAULT_ETH_REGISTER_VALUE, 4000,
          );

          return {
            legacyOperators: seed.operators,
            legacyCluster,
            ethOnlyOperators,
            ethOnlyCluster,
            phase: "migrate" as Phase,
            tracker: { totalDeposited: 0n, totalWithdrawn: 0n },
            operatorOwner,
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
