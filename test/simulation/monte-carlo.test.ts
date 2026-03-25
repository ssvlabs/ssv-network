/**
 * Monte Carlo Upgrade Simulation
 *
 * Stress-tests the SSV Network v2.0.0 upgrade (ETH payments, effective balance,
 * SSV staking) on a mainnet fork under randomized workloads.
 *
 * Guard: only runs when RUN_FORK=true — will not execute in normal CI.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";

import { ssvNetworkFullForkedFixture } from "../setup/fixtures.ts";
import { getForkedConnection } from "../setup/fork.ts";
import {
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  STAKE_AMOUNT,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../common/constants.ts";
import { makePublicKey, makeOperatorKey } from "../common/helpers.ts";

import type {
  SimulationState,
  ClusterRecord,
  OperatorRecord,
  StakerRecord,
} from "./types.ts";
import { VERSION_SSV, VERSION_ETH } from "./types.ts";
import { SeededRNG } from "./rng.ts";
import { SimLogger } from "./sim-logger.ts";
import {
  clusterKey,
  parseClusterFromReceipt,
  trackEthFlow,
  emptyTotals,
} from "./bookkeeping.ts";
import {
  discoverOperators,
  sampleOperators,
} from "./state-discovery.ts";
import {
  getActionWeights,
  selectAction,
} from "./weight-schedule.ts";
import { ACTION_REGISTRY } from "./actions/index.ts";
import {
  runPeriodicInvariants,
  runFinalInvariants,
  createInvariantContext,
  type InvariantContext,
} from "./invariants.ts";

async function mineBlocks(provider: any, n: number): Promise<void> {
  if (n <= 0) return;
  await provider.send("hardhat_mine", ["0x" + n.toString(16)]);
}

async function provisionStakers(
  connection: NetworkConnection<"generic">,
  fixture: Awaited<ReturnType<typeof ssvNetworkFullForkedFixture>>,
  count: number,
): Promise<StakerRecord[]> {
  const allSigners = await connection.ethers.getSigners();
  const signers = allSigners.slice(10, 10 + count);

  if (signers.length < count) {
    throw new Error(`Not enough signers for ${count} stakers (have ${signers.length})`);
  }

  const networkAddr = await fixture.network.getAddress();
  const ssvTokenAddr = await fixture.ssvToken.getAddress();

  const stakerRecords: StakerRecord[] = [];

  for (const signer of signers) {
    await connection.ethers.provider.send("hardhat_setBalance", [
      signer.address,
      "0x" + (BigInt(100e18)).toString(16),
    ]);
    const ssvAmount = connection.ethers.parseEther("100000");
    const tokenOwner = await fixture.ssvToken.owner();
    await connection.ethers.provider.send("hardhat_impersonateAccount", [tokenOwner]);
    await connection.ethers.provider.send("hardhat_setBalance", [
      tokenOwner,
      "0x" + BigInt(1e18).toString(16),
    ]);
    const ownerSigner = await connection.ethers.getSigner(tokenOwner);
    await fixture.ssvToken.connect(ownerSigner).mint(signer.address, ssvAmount);
    await connection.ethers.provider.send("hardhat_stopImpersonatingAccount", [tokenOwner]);
    await fixture.ssvToken.connect(signer).approve(networkAddr, ethers.MaxUint256);

    stakerRecords.push({
      signer,
      cssvBalance: 0n,
      pendingRequests: [],
    });
  }

  return stakerRecords;
}

async function registerSimOperators(
  network: any,
  owner: HardhatEthersSigner,
  count: number,
  startSeed: number,
): Promise<OperatorRecord[]> {
  const records: OperatorRecord[] = [];
  for (let i = 0; i < count; i++) {
    const key = makeOperatorKey(startSeed + i);
    try {
      const id = await network.connect(owner).registerOperator.staticCall(
        key,
        MINIMAL_OPERATOR_ETH_FEE,
        false,
      );
      await network.connect(owner).registerOperator(key, MINIMAL_OPERATOR_ETH_FEE, false);
      records.push({
        id: BigInt(id),
        owner: owner.address,
        ownerSigner: owner,
        fee: MINIMAL_OPERATOR_ETH_FEE,
        isActive: true,
      });
    } catch {
    }
  }
  return records;
}

// ACTION_REGISTRY from actions/index.ts is used as the unified action dispatch.
// All action implementations live in test/simulation/actions/*.ts.

async function forceMigrateRemaining(state: SimulationState): Promise<void> {
  const ssvClusters = [...state.clusterBook.entries()].filter(
    ([, c]) => c.version === VERSION_SSV && c.cluster.active,
  );

  for (const [key, record] of ssvClusters) {
    try {
      const validatorCount = Number(record.cluster.validatorCount);
      const minEth = ethers.parseEther("0.01") * BigInt(Math.max(validatorCount, 1));

      await state.provider.send("hardhat_impersonateAccount", [record.owner]);
      await state.provider.send("hardhat_setBalance", [
        record.owner,
        "0x" + (minEth + BigInt(10e18)).toString(16),
      ]);

      const tx = await state.network.connect(record.ownerSigner).migrateClusterToETH(
        record.operatorIds,
        record.cluster,
        { value: minEth },
      );
      const receipt = await tx.wait();
      const updated = parseClusterFromReceipt(state.network, receipt, "ClusterMigratedToETH");
      if (updated) {
        record.cluster = updated;
        record.version = VERSION_ETH;
        trackEthFlow(state, "in", minEth);
      }
    } catch (err) {
      console.warn(`  [forceMigrate] Failed for cluster ${key}: ${String(err).slice(0, 80)}`);
    }
  }
}

async function exhaustPendingFees(state: SimulationState): Promise<void> {
  const totalPeriod = Number(DECLARE_OPERATOR_FEE_PERIOD + EXECUTE_OPERATOR_FEE_PERIOD);
  await mineBlocks(state.provider, totalPeriod + 100);
}

async function claimAllRewards(state: SimulationState): Promise<void> {
  for (const staker of state.stakerPool) {
    try {
      const claimable = BigInt(await state.views.previewClaimableEth(staker.signer.address));
      if (claimable > 0n) {
        const tx = await state.network.connect(staker.signer).claimEthRewards();
        await tx.wait();
      }
    } catch {
    }

    try {
      const pending = await state.views.pendingUnstake(staker.signer.address);
      if (pending.length > 0) {
        const tx = await state.network.connect(staker.signer).withdrawUnlocked();
        await tx.wait();
      }
    } catch {
    }
  }
}

const RUN_FORK = process.env.RUN_FORK === "true";

(RUN_FORK ? describe : describe.skip)("Monte Carlo Upgrade Simulation", function () {
  this.timeout(600_000);

  let state: SimulationState;
  let invCtx: InvariantContext;

  before(async function () {
    console.log("[SIM] Setting up forked environment...");
    const { connection } = await getForkedConnection();
    const provider = connection.ethers.provider;
    console.log("[SIM] Deploying v2.0.0 upgrade...");
    const fixture = await ssvNetworkFullForkedFixture(connection);
    const networkAddress = await fixture.network.getAddress();
    const rng = new SeededRNG();
    const logger = new SimLogger();
    const [deployer, operatorOwner] = await connection.ethers.getSigners();
    await provider.send("hardhat_setBalance", [
      operatorOwner.address,
      "0x" + BigInt(100e18).toString(16),
    ]);
    console.log("[SIM] Registering simulation operators...");
    const simOpRecords = await registerSimOperators(fixture.network, operatorOwner, 8, 9000);
    if (simOpRecords.length < 4) {
      throw new Error(`Failed to register enough operators: got ${simOpRecords.length}`);
    }
    console.log("[SIM] Discovering mainnet operators...");
    const currentBlock = await provider.getBlockNumber();
    const scanFrom = Math.max(0, currentBlock - 50_000);
    let sampledOps: Awaited<ReturnType<typeof sampleOperators>> = [];
    try {
      const discovered = await discoverOperators(
        provider,
        connection.ethers,
        networkAddress,
        scanFrom,
        currentBlock,
      );
      console.log(`[SIM] Discovered ${discovered.size} operators`);
      sampledOps = await sampleOperators(discovered, fixture.views, 20, rng);
      console.log(`[SIM] Sampled ${sampledOps.length} active mainnet operators`);
    } catch (err) {
      console.warn(`[SIM] Operator discovery failed (${String(err).slice(0, 120)}); continuing with synthetic operators only`);
    }
    const operatorPool = new Map<bigint, OperatorRecord>();
    for (const rec of simOpRecords) {
      operatorPool.set(rec.id, rec);
    }
    for (const sampled of sampledOps) {
      await provider.send("hardhat_impersonateAccount", [sampled.owner]);
      await provider.send("hardhat_setBalance", [
        sampled.owner,
        "0x" + BigInt(10e18).toString(16),
      ]);
      const ownerSigner = await connection.ethers.getSigner(sampled.owner);
      operatorPool.set(sampled.id, { ...sampled, ownerSigner });
    }
    console.log("[SIM] Provisioning stakers...");
    const stakerPool = await provisionStakers(connection, fixture, 8);
    console.log("[SIM] Bootstrapping cSSV supply...");
    const bootstrapStaker = stakerPool[0];
    await fixture.ssvToken.connect(bootstrapStaker.signer).approve(networkAddress, ethers.MaxUint256);
    const stakeTx = await fixture.network.connect(bootstrapStaker.signer).stake(STAKE_AMOUNT);
    await stakeTx.wait();
    bootstrapStaker.cssvBalance = BigInt(
      await fixture.cssvToken.balanceOf(bootstrapStaker.signer.address),
    );
    console.log(`[SIM] Initial cSSV supply: ${await fixture.cssvToken.totalSupply()}`);
    console.log("[SIM] Creating synthetic clusters...");
    const clusterBook = new Map<string, ClusterRecord>();
    const simOpIds = simOpRecords.map((r) => r.id);

    const opGroups = [
      simOpIds.slice(0, 4),
      simOpIds.slice(4, 8),
    ].filter((g) => g.length === 4);

    for (const opGroup of opGroups) {
      for (let i = 0; i < 3; i++) {
        const staker = rng.pick(stakerPool);
        const keySeed = currentBlock + Number(rng.next() % 1000000n);
        const validatorKey = makePublicKey(keySeed);

        try {
          const tx = await fixture.network.connect(staker.signer).registerValidator(
            validatorKey,
            opGroup,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: DEFAULT_ETH_REGISTER_VALUE },
          );
          const receipt = await tx.wait();
          const cluster = parseClusterFromReceipt(fixture.network, receipt, "ValidatorAdded");

          if (cluster) {
            const key = clusterKey(connection.ethers, staker.signer.address, opGroup);
            clusterBook.set(key, {
              owner: staker.signer.address,
              ownerSigner: staker.signer,
              operatorIds: opGroup,
              cluster,
              version: VERSION_ETH,
              validatorKeys: [validatorKey],
            });
          }
        } catch (err) {
          console.warn(`[SIM] Failed to register cluster: ${String(err).slice(0, 80)}`);
        }
      }
    }
    console.log(`[SIM] Created ${clusterBook.size} synthetic clusters`);
    const startBlock = await provider.getBlockNumber();

    state = {
      network: fixture.network,
      views: fixture.views,
      provider,
      rng,
      logger,
      clusterBook,
      operatorPool,
      stakerPool,
      totals: emptyTotals(),
      startBlock,
      currentBlock: startBlock,
      networkAddress,
      ssvToken: fixture.ssvToken,
      cssvToken: fixture.cssvToken,
      oracleSigners: [],
    };
    invCtx = createInvariantContext();
    try {
      invCtx.prevAccEthPerShare = BigInt(await fixture.views.accEthPerShare());
    } catch {
      invCtx.prevAccEthPerShare = 0n;
    }

    console.log("[SIM] Setup complete.");
  });

  it("runs 30-day simulation without invariant violations", async function () {
    const BLOCKS_PER_DAY = 7200;
    const TARGET_DAYS = 30;
    const TARGET_BLOCKS = TARGET_DAYS * BLOCKS_PER_DAY;
    const ACTIONS_PER_EPOCH = 20;
    const INVARIANT_CHECK_EVERY = 5;
    const BLOCKS_PER_EPOCH_MIN = 150;
    const BLOCKS_PER_EPOCH_MAX = 500;

    let epoch = 0;

    console.log(`[SIM] Starting simulation at block ${state.startBlock}`);
    console.log(`[SIM] Target: ${TARGET_DAYS} days (${TARGET_BLOCKS} blocks)`);

    while (true) {
      const weights = getActionWeights(state.currentBlock, state.startBlock, BLOCKS_PER_DAY);
      for (let i = 0; i < ACTIONS_PER_EPOCH; i++) {
        const actionName = selectAction(weights, state.rng.nextFloat());
        const actionFn = ACTION_REGISTRY[actionName] ?? ACTION_REGISTRY["mineBlocks"];
        const result = await actionFn(state);
        state.logger.record(state.currentBlock, result);
      }
      const blocksToMine = Number(state.rng.nextInRange(
        BigInt(BLOCKS_PER_EPOCH_MIN),
        BigInt(BLOCKS_PER_EPOCH_MAX),
      ));
      await mineBlocks(state.provider, blocksToMine);
      state.currentBlock = await state.provider.getBlockNumber();
      epoch++;

      if (epoch % INVARIANT_CHECK_EVERY === 0) {
        const results = await runPeriodicInvariants(state, invCtx);

        for (const r of results) {
          expect(r.passed, r.message).to.be.true;
        }
        const elapsed = state.currentBlock - state.startBlock;
        const pct = Math.floor((elapsed * 100) / TARGET_BLOCKS);
        const ssvCount = [...state.clusterBook.values()].filter(
          (c) => c.version === VERSION_SSV && c.cluster.active,
        ).length;
        console.log(
          `[SIM] Epoch ${epoch} | Block ${state.currentBlock} | ${pct}% | ` +
            `Clusters: ${state.clusterBook.size} (${ssvCount} SSV) | Invariants: all passed`,
        );
      }
      const elapsed = state.currentBlock - state.startBlock;
      const allMigrated = [...state.clusterBook.values()].every(
        (c) => c.version === VERSION_ETH || !c.cluster.active,
      );
      if (allMigrated && elapsed >= TARGET_BLOCKS) {
        console.log("[SIM] Target reached — all clusters migrated.");
        break;
      }
      if (elapsed >= TARGET_BLOCKS * 2) {
        console.log("[SIM] Hard limit reached.");
        break;
      }
    }
    console.log("[SIM] Running post-loop cleanup...");

    console.log("[SIM]   Force-migrating remaining SSV clusters...");
    await forceMigrateRemaining(state);

    console.log("[SIM]   Exhausting pending fee declarations...");
    await exhaustPendingFees(state);

    console.log("[SIM]   Claiming all rewards...");
    await claimAllRewards(state);
    console.log("[SIM] Running final invariant checks...");
    const finals = await runFinalInvariants(state, invCtx);

    for (const r of finals) {
      expect(r.passed, r.message).to.be.true;
    }
    console.log(state.logger.formatSummary());
  });
});
