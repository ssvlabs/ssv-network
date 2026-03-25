/**
 * Scenario Monte Carlo Test Runner
 *
 * Entry point for the scenario-driven simulation engine.
 * Runs only when RUN_SCENARIO_MC=true environment variable is set.
 *
 * Usage:
 *   RUN_SCENARIO_MC=true npx hardhat test test/simulation/scenario-mc.test.ts
 *   SIMULATION_SEED=12345 RUN_SCENARIO_MC=true npx hardhat test test/simulation/scenario-mc.test.ts
 */

import { expect } from "chai";
import { ethers } from "ethers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { SSVNetwork, SSVNetworkViews } from "../../types/ethers-contracts/index.js";

import { getTestConnection } from "../setup/connection.ts";
import {
  ssvNetworkFullPreUpgradeFixture,
  upgradeToStakingVersion,
} from "../setup/fixtures.ts";
import {
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  STAKE_AMOUNT,
  MINIMAL_OPERATOR_ETH_FEE,
  MINIMAL_OPERATOR_FEE_SSV,
  TOKEN_REGISTER_AMOUNT,
} from "../common/constants.ts";
import { makePublicKey, makeOperatorKey } from "../helpers/keys.ts";
import { whitelistAddresses } from "../helpers/operator.ts";
import { getCurrentClusterState } from "../helpers/cluster.ts";

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
  emptyTotals,
} from "./bookkeeping.ts";
import {
  createInvariantContext,
  runFinalInvariants,
  type InvariantContext,
} from "./invariants.ts";
import { ScenarioRunner } from "./scenario-runner.ts";
import { ALL_SCENARIOS } from "../scenarios/index.ts";

// --- Guard ---

const RUN_SCENARIO_MC = process.env.RUN_SCENARIO_MC === "true";

// --- Helpers ---

async function registerSimOperators(
  network: any,
  owner: HardhatEthersSigner,
  count: number,
  startSeed: number,
  fee: bigint = MINIMAL_OPERATOR_ETH_FEE,
): Promise<OperatorRecord[]> {
  const records: OperatorRecord[] = [];
  for (let i = 0; i < count; i++) {
    const key = makeOperatorKey(startSeed + i);
    try {
      const id = await network.connect(owner).registerOperator.staticCall(
        key,
        fee,
        false,
      );
      await network.connect(owner).registerOperator(key, fee, false);
      records.push({
        id: BigInt(id),
        owner: owner.address,
        ownerSigner: owner,
        fee,
        isActive: true,
      });
    } catch {
      // Skip failed registrations
    }
  }
  return records;
}

// --- Test suite ---

(RUN_SCENARIO_MC ? describe : describe.skip)("Scenario MC Simulation", function () {
  this.timeout(300_000);

  let state: SimulationState;
  let invCtx: InvariantContext;

  before(async function () {
    console.log("[SCENARIO-MC] Setting up local environment...");
    const { connection } = await getTestConnection();
    const provider = connection.ethers.provider;

    // --- Phase 1: Deploy pre-upgrade (v1.2.0) fixture ---
    console.log("[SCENARIO-MC] Deploying pre-upgrade SSV stack...");
    const preFixture = await ssvNetworkFullPreUpgradeFixture(connection);
    const ssvToken = preFixture.ssvToken;

    const signers = await connection.ethers.getSigners();
    const operatorOwner = signers[1];
    const operatorPool = new Map<bigint, OperatorRecord>();

    // --- Phase 2: Register SSV-fee operators + create SSV clusters ---
    console.log("[SCENARIO-MC] Registering SSV-fee operators...");
    const ssvOpRecords = await registerSimOperators(
      preFixture.network,
      operatorOwner,
      4,
      8000,
      MINIMAL_OPERATOR_FEE_SSV,
    );
    if (ssvOpRecords.length < 4) {
      throw new Error(`Only registered ${ssvOpRecords.length} SSV operators, need 4`);
    }
    for (const rec of ssvOpRecords) {
      operatorPool.set(rec.id, rec);
    }
    const ssvOpIds = ssvOpRecords.map((r) => Number(r.id));

    // Whitelist staker addresses for SSV operators
    const stakerSigners = signers.slice(2, 6);
    await whitelistAddresses(
      preFixture.network,
      operatorOwner,
      ssvOpIds,
      stakerSigners.map((s) => s.address),
    );

    // Create SSV clusters (legacy registerValidator with SSV token deposit)
    console.log("[SCENARIO-MC] Creating SSV clusters...");
    const clusterBook = new Map<string, ClusterRecord>();
    const rng = new SeededRNG();

    for (let i = 0; i < 2; i++) {
      const staker = rng.pick(stakerSigners);
      const keySeed = 40000 + i;
      const validatorKey = makePublicKey(keySeed);

      try {
        // Mint SSV tokens for staker
        await ssvToken.mint(staker.address, TOKEN_REGISTER_AMOUNT);
        await ssvToken
          .connect(staker)
          .approve(await preFixture.network.getAddress(), TOKEN_REGISTER_AMOUNT);

        // Legacy 5-param registerValidator with SSV token deposit
        await preFixture.network
          .connect(staker)
          .registerValidator(
            validatorKey,
            ssvOpIds,
            DEFAULT_SHARES,
            TOKEN_REGISTER_AMOUNT,
            EMPTY_CLUSTER,
          );

        const cluster = await getCurrentClusterState(
          connection,
          preFixture.network,
          staker.address,
          ssvOpIds,
        );

        const key = clusterKey(
          connection.ethers,
          staker.address,
          ssvOpIds.map((id) => BigInt(id)),
        );
        clusterBook.set(key, {
          owner: staker.address,
          ownerSigner: staker,
          operatorIds: ssvOpIds.map((id) => BigInt(id)),
          cluster,
          version: VERSION_SSV,
          validatorKeys: [validatorKey],
        });
      } catch (err) {
        console.warn(
          `[SCENARIO-MC] Failed to create SSV cluster: ${String(err).slice(0, 120)}`,
        );
      }
    }

    // --- Phase 3: Upgrade to v2.0.0 (staking version) ---
    console.log("[SCENARIO-MC] Upgrading to staking version...");
    const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
      connection,
      preFixture.network,
      preFixture.views,
    );

    const networkAddress = await newNetwork.getAddress();

    // --- Phase 4: Register ETH-fee operators + create ETH clusters ---
    console.log("[SCENARIO-MC] Registering ETH-fee operators...");
    const ethOpRecords = await registerSimOperators(
      newNetwork,
      operatorOwner,
      8,
      9000,
      MINIMAL_OPERATOR_ETH_FEE,
    );
    if (ethOpRecords.length < 4) {
      throw new Error(`Only registered ${ethOpRecords.length} ETH operators, need >= 4`);
    }
    for (const rec of ethOpRecords) {
      operatorPool.set(rec.id, rec);
    }

    console.log("[SCENARIO-MC] Creating ETH clusters...");
    const ethOpIds = ethOpRecords.map((r) => r.id);
    const ethOpGroups = [
      ethOpIds.slice(0, 4),
      ethOpIds.slice(4, 8),
    ].filter((g) => g.length === 4);

    for (const opGroup of ethOpGroups) {
      for (let i = 0; i < 2; i++) {
        const staker = rng.pick(stakerSigners);
        const keySeed = 50000 + Number(rng.next() % 1000000n);
        const validatorKey = makePublicKey(keySeed);

        try {
          const tx = await newNetwork
            .connect(staker)
            .registerValidator(
              validatorKey,
              opGroup,
              DEFAULT_SHARES,
              EMPTY_CLUSTER,
              { value: DEFAULT_ETH_REGISTER_VALUE },
            );
          const receipt = await tx.wait();
          const cluster = parseClusterFromReceipt(
            newNetwork,
            receipt,
            "ValidatorAdded",
          );

          if (cluster) {
            const key = clusterKey(
              connection.ethers,
              staker.address,
              opGroup,
            );
            clusterBook.set(key, {
              owner: staker.address,
              ownerSigner: staker,
              operatorIds: opGroup,
              cluster,
              version: VERSION_ETH,
              validatorKeys: [validatorKey],
            });
          }
        } catch (err) {
          console.warn(
            `[SCENARIO-MC] Failed to create ETH cluster: ${String(err).slice(0, 80)}`,
          );
        }
      }
    }

    // --- Phase 5: Provision oracle signers ---
    console.log("[SCENARIO-MC] Provisioning oracle signers...");
    const oracleSigners = signers.slice(6, 9); // 3 oracle signers
    for (let i = 0; i < oracleSigners.length; i++) {
      await newNetwork.replaceOracle(i + 1, oracleSigners[i].address);
    }

    // --- Phase 6: Provision stakers + bootstrap cSSV supply ---
    console.log("[SCENARIO-MC] Provisioning stakers...");
    const stakerPool: StakerRecord[] = [];

    for (const signer of stakerSigners) {
      await ssvToken.mint(signer.address, ethers.parseEther("100000"));
      await ssvToken.connect(signer).approve(networkAddress, ethers.MaxUint256);
      stakerPool.push({
        signer,
        cssvBalance: 0n,
        pendingRequests: [],
      });
    }

    console.log("[SCENARIO-MC] Bootstrapping cSSV supply...");
    const bootstrapStaker = stakerPool[0];
    await newNetwork.connect(bootstrapStaker.signer).stake(STAKE_AMOUNT);
    bootstrapStaker.cssvBalance = BigInt(
      await cssv.balanceOf(bootstrapStaker.signer.address),
    );

    const ssvClusterCount = [...clusterBook.values()].filter(
      (c) => c.version === VERSION_SSV,
    ).length;
    const ethClusterCount = [...clusterBook.values()].filter(
      (c) => c.version === VERSION_ETH,
    ).length;
    console.log(
      `[SCENARIO-MC] Created ${ssvClusterCount} SSV + ${ethClusterCount} ETH clusters with ${operatorPool.size} operators, ${oracleSigners.length} oracles`,
    );

    const startBlock = await provider.getBlockNumber();

    state = {
      network: newNetwork as unknown as SSVNetwork,
      views: newViews as unknown as SSVNetworkViews,
      provider,
      rng,
      logger: new SimLogger(),
      clusterBook,
      operatorPool,
      stakerPool,
      totals: emptyTotals(),
      startBlock,
      currentBlock: startBlock,
      networkAddress,
      ssvToken,
      cssvToken: cssv,
      oracleSigners,
    };

    invCtx = createInvariantContext();
    try {
      invCtx.prevAccEthPerShare = BigInt(
        await (newViews as unknown as SSVNetworkViews).accEthPerShare(),
      );
    } catch {
      invCtx.prevAccEthPerShare = 0n;
    }

    console.log("[SCENARIO-MC] Setup complete.");
  });

  it("runs scenario Monte Carlo simulation", async function () {
    const totalPicks = parseInt(process.env.SCENARIO_PICKS ?? "30", 10);
    const seed = process.env.SIMULATION_SEED
      ? BigInt(process.env.SIMULATION_SEED)
      : undefined;

    console.log(
      `[SCENARIO-MC] Running ${totalPicks} scenario picks with ${ALL_SCENARIOS.length} scenarios`,
    );

    const runner = new ScenarioRunner({
      totalPicks,
      invariantEvery: 10,
      seed,
    });
    runner.registerScenarios(ALL_SCENARIOS);

    const summary = await runner.run(state, invCtx);

    console.log(`\n[SCENARIO-MC] === Run Summary ===`);
    console.log(`  Picks: ${summary.totalPicks}`);
    console.log(`  Completed: ${summary.totalCompleted}`);
    console.log(`  Stopped (reverts): ${summary.totalStopped}`);
    console.log(`  Bug candidates: ${summary.totalBugs}`);
    console.log(`  Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
    console.log(`  JSONL: ${runner.getOutputPath()}`);

    if (summary.neverPicked.length > 0) {
      console.log(`  Never picked: ${summary.neverPicked.join(", ")}`);
    }

    // Print coverage
    console.log(`\n  Coverage:`);
    for (const [id, cov] of summary.coverage) {
      if (cov.picked === 0) continue;
      const stopped = [...cov.stoppedAtStep.values()].reduce((a, b) => a + b, 0);
      console.log(
        `    ${id}: picked=${cov.picked} completed=${cov.completed} stopped=${stopped} bugs=${cov.bugCandidates}`,
      );
    }

    // Generate report (console + file)
    try {
      const report = runner.generateReport();
      console.log(`\n${report}`);
      const reportPath = runner.generateReportFile();
      console.log(`[SCENARIO-MC] Report written to: ${reportPath}`);
    } catch {
      // Report generation may fail if JSONL was not written
    }

    // Run final invariants
    console.log("[SCENARIO-MC] Running final invariants...");
    const finals = await runFinalInvariants(state, invCtx);
    for (const r of finals) {
      if (!r.passed) {
        console.warn(`  FAIL: ${r.message}`);
      }
    }

    // Assert no bugs found
    expect(summary.totalBugs, "Bug candidates found during simulation").to.equal(0);
  });
});
