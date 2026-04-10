import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import { generateRandomFees } from "./core/fuzz-helpers.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { setupFuzzOracles, ebValidatorLifecycle, type OracleState } from "./core/steps.ts";
import {
  assertDaoVUnitsMatchCluster,
  assertOperatorEarningsWithEB,
  assertClusterBalanceWithEB,
  type EBOperatorEarningsSnapshot,
  type EBClusterBalanceSnapshot,
} from "./core/assertions.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  STAKE_AMOUNT,
} from "../common/constants.ts";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  oracle: OracleState;
  nextKeyOffset: number;
  lastEBOperatorEarnings?: EBOperatorEarningsSnapshot;
  lastEBClusterBalance?: EBClusterBalanceSnapshot;
  tickDepositDelta: bigint;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

describe("Fuzz: EB deviations through validator lifecycle", function () {
  for (const seed of seeds) {
    it(`Validates operatorEthVUnits and daoTotalEthVUnits consistency through EB updates and validator removals with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 100,
        blocksPerTick: { min: 10n, max: 500n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner, oracleSigner] = ctx.signers;

          const operatorCount = ctx.rng.pick([4, 7, 10, 13]);
          const fees = generateRandomFees(ctx, operatorCount);
          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees);
          const operatorIds = operators.map((o) => o.id);

          await ctx.ssvToken.mint(oracleSigner.address, STAKE_AMOUNT);
          await ctx.ssvToken.connect(oracleSigner).approve(await ctx.network.getAddress(), STAKE_AMOUNT);
          await ctx.network.connect(oracleSigner).stake(STAKE_AMOUNT);

          const oracles = [ctx.signers[17], ctx.signers[18], ctx.signers[19]];
          await setupFuzzOracles(ctx, oracles);

          const validatorCount = Number(ctx.rng.nextInRange(10n, 100n));
          const cluster = await registerFuzzCluster(
            ctx,
            clusterOwner,
            operatorOwner,
            operatorIds,
            validatorCount,
            DEFAULT_ETH_REGISTER_VALUE,
          );

          return { operators, cluster, oracle: { oracles, lastCommittedBlock: 0n }, nextKeyOffset: 10000, tickDepositDelta: 0n };
        },

        steps: [
          ebValidatorLifecycle(32, 2048),
          assertOperatorEarningsWithEB,
          assertClusterBalanceWithEB,
          assertDaoVUnitsMatchCluster,
        ],
      }, seed);
    });
  }
});
