import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { registerFuzzOperators, registerFuzzCluster } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { parseClusterFromEvent } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import {
  computeClusterId,
  computeEBRoot,
  commitEBRoot,
} from "../helpers/oracle.ts";
import { ebToVUnits, setupFuzzOracles, generateRandomFees, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
} from "../common/constants.ts";

type Phase =
  | "commit-root-a"
  | "commit-root-b"
  | "try-stale-root"
  | "use-latest-root"
  | "verified";

interface State {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  oracles: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  phase: Phase;
  clusterId: string;
  validatorCount: number;
  blockA: number;
  blockB: number;
  ebA: number;
  ebB: number;
  rootA: string;
  rootB: string;
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { cluster, oracles, clusterId } = ctx.state;

  if (ctx.state.phase === "commit-root-a") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    ctx.state.blockA = Number(blockNum);
    ctx.state.rootA = computeEBRoot(clusterId, ctx.state.ebA);
    await commitEBRoot(ctx.network, ctx.state.rootA, ctx.state.blockA, oracles);
    ctx.state.lastCommittedBlock = blockNum;

    ctx.state.phase = "commit-root-b";
    return;
  }

  if (ctx.state.phase === "commit-root-b") {
    const blockNum = BigInt(await ctx.provider.getBlockNumber());
    if (blockNum <= ctx.state.lastCommittedBlock) return;

    ctx.state.blockB = Number(blockNum);
    ctx.state.rootB = computeEBRoot(clusterId, ctx.state.ebB);
    await commitEBRoot(ctx.network, ctx.state.rootB, ctx.state.blockB, oracles);
    ctx.state.lastCommittedBlock = blockNum;

    ctx.state.phase = "try-stale-root";
    return;
  }

  if (ctx.state.phase === "try-stale-root") {
    await expect(
      ctx.network.updateClusterBalance(
        ctx.state.blockA, cluster.owner.address, cluster.operatorIds, cluster.cluster, ctx.state.ebA, [],
      ),
    ).to.be.revertedWithCustomError(ctx.network, Errors.MUST_USE_LATEST_ROOT);

    ctx.state.phase = "use-latest-root";
    return;
  }

  if (ctx.state.phase === "use-latest-root") {
    const tx = await ctx.network.updateClusterBalance(
      ctx.state.blockB, cluster.owner.address, cluster.operatorIds, cluster.cluster, ctx.state.ebB, [],
    );
    cluster.cluster = parseClusterFromEvent(ctx.network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const contractEB = BigInt(
      await ctx.views.getEffectiveBalance(cluster.owner.address, cluster.operatorIds, cluster.cluster),
    );
    expect(contractEB).to.equal(BigInt(ctx.state.ebB));

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: Stale root rejection — must use latest committed root", function () {
  for (const seed of seeds) {
    it(`Validates stale EB root rejection — only latest committed root is accepted with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 12,
        blocksPerTick: { min: 5n, max: 100n },

        async setup(ctx) {
          const [, operatorOwner, clusterOwner, staker] = ctx.signers;

          const fees = generateRandomFees(ctx, 4, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_ETH_FEE * 3n);
          const operators = await registerFuzzOperators(ctx, operatorOwner, 4, fees);
          const operatorIds = operators.map(o => o.id);

          const oracles = await setupFuzzOracles(ctx, staker);

          const validatorCount = Number(ctx.rng.nextInRange(1n, 10n));

          const cluster = await registerFuzzCluster(
            ctx, clusterOwner, operatorOwner, operatorIds,
            validatorCount, DEFAULT_ETH_REGISTER_VALUE,
          );

          const ebAPerVal = Number(ctx.rng.nextInRange(32n, 1024n));
          const ebBPerVal = Number(ctx.rng.nextInRange(32n, 2048n));

          return {
            operators, cluster, oracles,
            lastCommittedBlock: 0n,
            phase: "commit-root-a" as Phase,
            clusterId: computeClusterId(clusterOwner.address, operatorIds),
            validatorCount,
            blockA: 0,
            blockB: 0,
            ebA: ebAPerVal * validatorCount,
            ebB: ebBPerVal * validatorCount,
            rootA: "",
            rootB: "",
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
