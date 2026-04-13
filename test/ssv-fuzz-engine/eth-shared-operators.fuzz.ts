import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster, alignFee } from "./core/setup.ts";
import { computeClusterBalance } from "./core/fuzz-helpers.ts";
import type { OperatorRecord, ClusterRecord } from "./core/types.ts";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { makePublicKey } from "../helpers/keys.ts";
import { Events } from "../common/events.ts";
import { mineBlocks, setAccountBalance } from "../helpers/blocks.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  BPS_DENOMINATOR,
} from "../common/constants.ts";

interface State {
  clusterA: ClusterRecord;
  clusterB: ClusterRecord;
  operators: OperatorRecord[];
  sharedIndices: number[];
  exclusiveAIndices: number[];
  exclusiveBIndices: number[];
  validatorCountA: number;
  validatorCountB: number;
  phase: string;
}

const RUNS = 10;
const seeds = generateSeeds(RUNS);

describe("Fuzz: ETH shared operators — multiple clusters (CAT-2-8)", function () {
  for (const seed of seeds) {
    it(`Validates shared operator counts across two clusters with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 1,
        blocksPerTick: { min: 0n, max: 0n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwnerA, clusterOwnerB] = ctx.signers;

          const sharedCount = Number(ctx.rng.nextInRange(2n, 3n));
          const exclusivePerCluster = 4 - sharedCount;
          const totalOperators = sharedCount + exclusivePerCluster * 2;

          const fees: bigint[] = [];
          for (let i = 0; i < totalOperators; i++) {
            fees.push(alignFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 5n)));
          }

          const operators = await registerFuzzOperators(ctx, operatorOwner, totalOperators, fees, 1000, false);

          const sharedIndices = Array.from({ length: sharedCount }, (_, i) => i);
          const exclusiveAIndices = Array.from({ length: exclusivePerCluster }, (_, i) => sharedCount + i);
          const exclusiveBIndices = Array.from({ length: exclusivePerCluster }, (_, i) => sharedCount + exclusivePerCluster + i);

          const opsA = [...sharedIndices, ...exclusiveAIndices].map(i => operators[i].id);
          const opsB = [...sharedIndices, ...exclusiveBIndices].map(i => operators[i].id);

          const validatorCountA = Number(ctx.rng.nextInRange(2n, 5n));
          const validatorCountB = Number(ctx.rng.nextInRange(1n, 4n));

          const clusterA = await registerFuzzCluster(
            ctx, clusterOwnerA, operatorOwner, opsA,
            validatorCountA, DEFAULT_ETH_REGISTER_VALUE, 2000,
          );

          const clusterB = await registerFuzzCluster(
            ctx, clusterOwnerB, operatorOwner, opsB,
            validatorCountB, DEFAULT_ETH_REGISTER_VALUE * 10n, 3000,
          );

          return {
            clusterA,
            clusterB,
            operators,
            sharedIndices,
            exclusiveAIndices,
            exclusiveBIndices,
            validatorCountA,
            validatorCountB,
            phase: "setup",
          };
        },

        steps: [
          {
            name: "phase1-verify-shared-counts",
            async fn(ctx) {
              const { operators, sharedIndices, exclusiveAIndices, exclusiveBIndices,
                validatorCountA, validatorCountB } = ctx.state;

              const expectedShared = BigInt(validatorCountA + validatorCountB);
              for (const idx of sharedIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  expectedShared, `shared op[${idx}] count mismatch`,
                );
              }

              for (const idx of exclusiveAIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  BigInt(validatorCountA), `exclusiveA op[${idx}] count mismatch`,
                );
              }

              for (const idx of exclusiveBIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  BigInt(validatorCountB), `exclusiveB op[${idx}] count mismatch`,
                );
              }

              const networkCount = BigInt(await ctx.views.getNetworkValidatorsCount());
              expect(networkCount).to.equal(BigInt(validatorCountA + validatorCountB));

              ctx.state.phase = "counts-verified";
            },
          },

          {
            name: "phase2-liquidate-A",
            async fn(ctx) {
              const { clusterA, clusterB, operators, sharedIndices, exclusiveAIndices,
                exclusiveBIndices, validatorCountB } = ctx.state;
              const thirdParty = ctx.signers[4];

              const blockBefore = BigInt(await ctx.provider.getBlockNumber());
              const balanceBBefore = BigInt(
                await ctx.views.getBalance(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
              );

              const balance = BigInt(
                await ctx.views.getBalance(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
              );
              const burnRate = BigInt(
                await ctx.views.getBurnRate(clusterA.owner.address, clusterA.operatorIds, clusterA.cluster),
              );

              const blocksToDepletion = Number(balance / burnRate) + 1;
              await mineBlocks(ctx.provider, blocksToDepletion);

              const isLiq = await ctx.views.isLiquidatable(
                clusterA.owner.address, clusterA.operatorIds, clusterA.cluster,
              );
              expect(isLiq).to.equal(true, "Cluster A must be liquidatable");

              const liqTx = await ctx.network.connect(thirdParty).liquidate(
                clusterA.owner.address, clusterA.operatorIds, clusterA.cluster,
              );
              const liqReceipt = await liqTx.wait();
              clusterA.cluster = parseClusterFromEvent(ctx.network, liqReceipt, Events.CLUSTER_LIQUIDATED);

              expect(clusterA.cluster.active).to.equal(false);

              const expectedB = BigInt(validatorCountB);
              for (const idx of sharedIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  expectedB, `shared op[${idx}] post-liquidation count mismatch`,
                );
              }

              for (const idx of exclusiveAIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  0n, `exclusiveA op[${idx}] must be 0 after A liquidated`,
                );
              }

              for (const idx of exclusiveBIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  expectedB, `exclusiveB op[${idx}] must be unchanged`,
                );
              }

              const blockAfter = BigInt(await ctx.provider.getBlockNumber());
              const opFeesB = [...sharedIndices, ...exclusiveBIndices].map(i => operators[i].fee);
              const networkFee = BigInt(await ctx.views.getNetworkFee());
              const expectedBalanceB = computeClusterBalance(
                balanceBBefore, opFeesB, networkFee, BigInt(validatorCountB) * BPS_DENOMINATOR, blockAfter - blockBefore,
              );

              const balanceB = BigInt(
                await ctx.views.getBalance(clusterB.owner.address, clusterB.operatorIds, clusterB.cluster),
              );
              expect(balanceB).to.equal(expectedBalanceB);

              const networkCount = BigInt(await ctx.views.getNetworkValidatorsCount());
              expect(networkCount).to.equal(expectedB);

              ctx.state.phase = "A-liquidated";
            },
          },

          {
            name: "phase3-operate-B",
            async fn(ctx) {
              const { clusterB, operators, sharedIndices, exclusiveAIndices,
                exclusiveBIndices, validatorCountB } = ctx.state;

              const newKey = makePublicKey(4000);
              await setAccountBalance(ctx.provider, clusterB.owner.address, DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n);
              const regTx = await ctx.network.connect(clusterB.owner).registerValidator(
                newKey, clusterB.operatorIds, DEFAULT_SHARES, clusterB.cluster,
                { value: DEFAULT_ETH_REGISTER_VALUE },
              );
              const regReceipt = await regTx.wait();
              clusterB.cluster = parseClusterFromEvent(ctx.network, regReceipt, Events.VALIDATOR_ADDED);
              clusterB.validatorKeys.push(newKey);

              const newCountB = BigInt(validatorCountB + 1);
              expect(BigInt(clusterB.cluster.validatorCount)).to.equal(newCountB);

              for (const idx of sharedIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  newCountB, `shared op[${idx}] post-register count mismatch`,
                );
              }

              for (const idx of exclusiveAIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  0n, `exclusiveA op[${idx}] must remain 0`,
                );
              }

              for (const idx of exclusiveBIndices) {
                const opData = await ctx.views.getOperatorById(operators[idx].id);
                expect(BigInt(opData.validatorCount)).to.equal(
                  newCountB, `exclusiveB op[${idx}] post-register count mismatch`,
                );
              }

              const networkCount = BigInt(await ctx.views.getNetworkValidatorsCount());
              expect(networkCount).to.equal(newCountB);

              ctx.state.phase = "B-operating";
            },
          },
        ],

        expectedPhase: "B-operating",
      }, seed);
    });
  }
});
