import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { setupFuzzOracles, updateAllClusterBalances, type OracleState } from "./core/steps.ts";
import { assertCSSVTotalSupply, assertStakerCSSVBalances, assertStakingRewards } from "./core/assertions.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  STAKE_AMOUNT,
} from "../common/constants.ts";

interface StakerRecord {
  signer: HardhatEthersSigner;
  staked: bigint;
}

interface State {
  operators: OperatorRecord[];
  clusters: ClusterRecord[];
  stakers: StakerRecord[];
  oracle: OracleState;
}

const RUNS = 15;
const seeds = generateSeeds(RUNS);

describe("Fuzz: staking rewards distribution", function () {
  for (const seed of seeds) {
    it(`Validates staking rewards accrue correctly across multiple clusters and stakers with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 100,
        blocksPerTick: { min: 10n, max: 500n },

        async setup(ctx) {
          const signers = ctx.signers;
          const operatorOwner = signers[1];

          const operatorCount = ctx.rng.pick([4, 7, 10, 13]);
          const fees: bigint[] = [];
          for (let i = 0; i < operatorCount; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }
          const operators = await registerFuzzOperators(ctx, operatorOwner, operatorCount, fees);
          const operatorIds = operators.map((o) => o.id);

          const stakers: StakerRecord[] = [];
          for (let s = 0; s < 5; s++) {
            const signer = signers[7 + s];
            const amount = ctx.rng.nextInRange(STAKE_AMOUNT, STAKE_AMOUNT * 10n);
            await ctx.ssvToken.mint(signer.address, amount);
            await ctx.ssvToken.connect(signer).approve(await ctx.network.getAddress(), amount);
            await ctx.network.connect(signer).stake(amount);
            stakers.push({ signer, staked: amount });
          }

          const clusters: ClusterRecord[] = [];
          for (let c = 0; c < 5; c++) {
            const clusterOwner = signers[2 + c];
            const validatorCount = Number(ctx.rng.nextInRange(1n, 10n));
            const cluster = await registerFuzzCluster(
              ctx,
              clusterOwner,
              operatorOwner,
              operatorIds,
              validatorCount,
              DEFAULT_ETH_REGISTER_VALUE,
              3000 + c * 100,
            );
            clusters.push(cluster);
          }

          const oracles = [signers[17], signers[18], signers[19]];
          await setupFuzzOracles(ctx, oracles);

          return { operators, clusters, stakers, oracle: { oracles, lastCommittedBlock: 0n } };
        },

        steps: [
          updateAllClusterBalances(32, 2048),
          assertCSSVTotalSupply,
          assertStakerCSSVBalances,
          assertStakingRewards,
        ],
      }, seed);
    });
  }
});
