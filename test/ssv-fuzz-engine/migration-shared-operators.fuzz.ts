import { expect } from "chai";
import { fuzz, generateSeeds } from "./core/runner.ts";
import { alignSSVFee } from "./core/setup.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./core/types.ts";
import type { Cluster } from "../common/types.ts";
import { assertVersionExclusivity } from "./core/assertions.ts";
import { parseClusterFromEvent, extractEventArgs, getCurrentClusterState } from "../helpers/cluster.ts";
import { Events } from "../common/events.ts";
import { parseFeeExecutedEvents, DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import { setAccountBalance, mineBlocks } from "../helpers/blocks.ts";
import { makePublicKey, makeOperatorKey } from "../helpers/keys.ts";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../setup/fixtures.ts";
import {
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  CLUSTER_VERSION_ETH,
} from "../common/constants.ts";

type Phase = "first-migration" | "second-migration" | "verified";

interface State {
  operators: OperatorRecord[];
  clusterX: ClusterRecord;
  clusterY: ClusterRecord;
  phase: Phase;
  migrationOrder: ("X" | "Y")[];
}



async function migrateCluster(
  ctx: FuzzContext<State>,
  cluster: ClusterRecord,
): Promise<{ receipt: any; ssvRefund: bigint }> {
  const ssvBalanceBefore = BigInt(
    await ctx.views.getBalanceSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster),
  );
  const ssvBurnRate = BigInt(
    await ctx.views.getBurnRateSSV(cluster.owner.address, cluster.operatorIds, cluster.cluster),
  );
  const ownerSSVBefore = BigInt(await ctx.ssvToken.balanceOf(cluster.owner.address));

  const ethDeposit = ctx.rng.nextInRange(DEFAULT_ETH_REGISTER_VALUE, DEFAULT_ETH_REGISTER_VALUE * 5n);
  await setAccountBalance(ctx.provider, cluster.owner.address, ethDeposit + 10n ** 18n);

  const tx = await ctx.network.connect(cluster.owner).migrateClusterToETH(
    cluster.operatorIds, cluster.cluster, { value: ethDeposit },
  );
  const receipt = await tx.wait();

  const ssvRefund = BigInt(extractEventArgs(ctx.network, receipt, Events.CLUSTER_MIGRATED_TO_ETH).ssvRefunded);
  expect(ssvRefund).to.equal(ssvBalanceBefore - ssvBurnRate);
  expect(BigInt(await ctx.ssvToken.balanceOf(cluster.owner.address)) - ownerSSVBefore).to.equal(ssvRefund);

  cluster.cluster = parseClusterFromEvent(ctx.network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
  return { receipt, ssvRefund };
}

async function lifecycle(ctx: FuzzContext<State>): Promise<void> {
  const { clusterX, clusterY, migrationOrder } = ctx.state;

  if (ctx.state.phase === "first-migration") {
    const first = migrationOrder[0] === "X" ? clusterX : clusterY;
    const { receipt } = await migrateCluster(ctx, first);
    const feeEvents = parseFeeExecutedEvents(ctx.network, receipt);

    expect(feeEvents.length).to.equal(first.operatorIds.length);
    for (const opId of first.operatorIds) {
      const ev = feeEvents.find(e => e.operatorId === BigInt(opId));
      expect(ev).to.not.equal(undefined);
      expect(ev!.fee).to.equal(BigInt(DEFAULT_OPERATOR_ETH_FEE));
    }

    ctx.state.phase = "second-migration";
    return;
  }

  if (ctx.state.phase === "second-migration") {
    const first = migrationOrder[0] === "X" ? clusterX : clusterY;
    const second = migrationOrder[1] === "X" ? clusterX : clusterY;
    const { receipt } = await migrateCluster(ctx, second);
    const feeEvents = parseFeeExecutedEvents(ctx.network, receipt);

    const sharedOps = new Set(second.operatorIds.filter(id => first.operatorIds.includes(id)));
    const uniqueOps = second.operatorIds.filter(id => !sharedOps.has(id));

    expect(feeEvents.length).to.equal(uniqueOps.length);
    for (const opId of uniqueOps) {
      expect(feeEvents.find(e => e.operatorId === BigInt(opId))).to.not.equal(undefined);
    }
    for (const opId of sharedOps) {
      expect(feeEvents.find(e => e.operatorId === BigInt(opId))).to.equal(undefined);
    }

    ctx.state.phase = "verified";
  }
}

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: migration with shared operators — ensureETHDefaults idempotency", function () {
  for (const seed of seeds) {
    it(`seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 10,
        blocksPerTick: { min: 10n, max: 100n },

        async setup(ctx) {
          const [, operatorOwner, ownerX, ownerY] = ctx.signers;

          const { network: legacyNetwork, views: legacyViews, ssvToken } =
            await ssvNetworkFullPreUpgradeFixture(ctx.connection);

          const ssvFee = alignSSVFee(ctx.rng.nextInRange(MINIMAL_OPERATOR_FEE_SSV, MINIMAL_OPERATOR_FEE_SSV * 5n));

          const operatorIds: number[] = [];
          for (let i = 0; i < 8; i++) {
            const key = makeOperatorKey(1000 + i);
            const id = await legacyNetwork.connect(operatorOwner).registerOperator.staticCall(key, ssvFee, false);
            await legacyNetwork.connect(operatorOwner).registerOperator(key, ssvFee, false);
            operatorIds.push(Number(id));
          }

          async function registerLegacyCluster(
            owner: any, ops: number[], keyBase: number, valCount: number,
          ): Promise<{ cluster: Cluster; keys: string[] }> {
            const deposit = ctx.rng.nextInRange(TOKEN_REGISTER_AMOUNT, TOKEN_REGISTER_AMOUNT * 3n);
            const total = deposit * BigInt(valCount);
            await ssvToken.mint(owner.address, total);
            await ssvToken.connect(owner).approve(await legacyNetwork.getAddress(), total);

            let cluster: Cluster = EMPTY_CLUSTER;
            const keys: string[] = [];
            for (let i = 0; i < valCount; i++) {
              const key = makePublicKey(keyBase + i);
              keys.push(key);
              await legacyNetwork.connect(owner).registerValidator(key, ops, DEFAULT_SHARES, deposit, cluster);
              cluster = await getCurrentClusterState(ctx.connection, legacyNetwork, owner.address, ops);
            }
            return { cluster, keys };
          }

          const opsX = operatorIds.slice(0, 4);
          const opsY = [operatorIds[0], operatorIds[1], operatorIds[2], operatorIds[4]];
          const valCount = Number(ctx.rng.nextInRange(2n, 5n));

          const { cluster: clusterXState, keys: keysX } = await registerLegacyCluster(ownerX, opsX, 1000, valCount);
          const { cluster: clusterYState, keys: keysY } = await registerLegacyCluster(ownerY, opsY, 2000, valCount);

          await mineBlocks(ctx.connection.ethers.provider, Number(ctx.rng.nextInRange(50n, 200n)));

          const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(ctx.connection, legacyNetwork, legacyViews);
          ctx.network = newNetwork;
          ctx.views = newViews;
          ctx.ssvToken = ssvToken;
          ctx.cssvToken = cssv;

          return {
            operators: operatorIds.map(id => ({ id, fee: DEFAULT_OPERATOR_ETH_FEE, owner: operatorOwner })),
            clusterX: { cluster: clusterXState, operatorIds: opsX, owner: ownerX, validatorKeys: keysX },
            clusterY: { cluster: clusterYState, operatorIds: opsY, owner: ownerY, validatorKeys: keysY },
            phase: "first-migration" as Phase,
            migrationOrder: ctx.rng.nextInRange(0n, 1n) === 0n ? ["X", "Y"] : ["Y", "X"],
          };
        },

        steps: [lifecycle],
        expectedPhase: "verified",
      }, seed);
    });
  }
});
