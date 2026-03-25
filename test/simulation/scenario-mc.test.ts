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
import { ssvNetworkFullFixture } from "../setup/fixtures.ts";
import {
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  STAKE_AMOUNT,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../common/constants.ts";
import { makePublicKey, makeOperatorKey } from "../helpers/keys.ts";

import type {
  SimulationState,
  ClusterRecord,
  OperatorRecord,
  StakerRecord,
} from "./types.ts";
import { VERSION_ETH } from "./types.ts";
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
  network: SSVNetwork,
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

    console.log("[SCENARIO-MC] Deploying full SSV v2.0.0 stack...");
    const fixture = await ssvNetworkFullFixture(connection);
    const networkAddress = await fixture.network.getAddress();

    const rng = new SeededRNG();
    const logger = new SimLogger();

    const signers = await connection.ethers.getSigners();
    const operatorOwner = signers[1];

    // Register operators
    console.log("[SCENARIO-MC] Registering operators...");
    const simOpRecords = await registerSimOperators(
      fixture.network as unknown as SSVNetwork,
      operatorOwner,
      8,
      9000,
    );
    if (simOpRecords.length < 4) {
      throw new Error(`Only registered ${simOpRecords.length} operators, need >= 4`);
    }

    const operatorPool = new Map<bigint, OperatorRecord>();
    for (const rec of simOpRecords) {
      operatorPool.set(rec.id, rec);
    }

    // Provision stakers
    console.log("[SCENARIO-MC] Provisioning stakers...");
    const stakerSigners = signers.slice(2, 6);
    const stakerPool: StakerRecord[] = [];

    for (const signer of stakerSigners) {
      // Mint SSV tokens
      await fixture.ssvToken.mint(signer.address, ethers.parseEther("100000"));
      await fixture.ssvToken.connect(signer).approve(networkAddress, ethers.MaxUint256);
      stakerPool.push({
        signer,
        cssvBalance: 0n,
        pendingRequests: [],
      });
    }

    // Bootstrap cSSV supply
    console.log("[SCENARIO-MC] Bootstrapping cSSV supply...");
    const bootstrapStaker = stakerPool[0];
    await fixture.network.connect(bootstrapStaker.signer).stake(STAKE_AMOUNT);
    bootstrapStaker.cssvBalance = BigInt(
      await fixture.cssvToken.balanceOf(bootstrapStaker.signer.address),
    );

    // Create clusters
    console.log("[SCENARIO-MC] Creating clusters...");
    const clusterBook = new Map<string, ClusterRecord>();
    const simOpIds = simOpRecords.map((r) => r.id);
    const opGroups = [
      simOpIds.slice(0, 4),
      simOpIds.slice(4, 8),
    ].filter((g) => g.length === 4);

    for (const opGroup of opGroups) {
      for (let i = 0; i < 2; i++) {
        const staker = rng.pick(stakerPool);
        const keySeed = 50000 + Number(rng.next() % 1000000n);
        const validatorKey = makePublicKey(keySeed);

        try {
          // Fund the staker for registration
          const tx = await fixture.network
            .connect(staker.signer)
            .registerValidator(
              validatorKey,
              opGroup,
              DEFAULT_SHARES,
              EMPTY_CLUSTER,
              { value: DEFAULT_ETH_REGISTER_VALUE },
            );
          const receipt = await tx.wait();
          const cluster = parseClusterFromReceipt(
            fixture.network,
            receipt,
            "ValidatorAdded",
          );

          if (cluster) {
            const key = clusterKey(
              connection.ethers,
              staker.signer.address,
              opGroup,
            );
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
          console.warn(
            `[SCENARIO-MC] Failed to create cluster: ${String(err).slice(0, 80)}`,
          );
        }
      }
    }

    console.log(
      `[SCENARIO-MC] Created ${clusterBook.size} clusters with ${operatorPool.size} operators`,
    );

    const startBlock = await provider.getBlockNumber();

    state = {
      network: fixture.network as unknown as SSVNetwork,
      views: fixture.views as unknown as SSVNetworkViews,
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
      invCtx.prevAccEthPerShare = BigInt(
        await (fixture.views as unknown as SSVNetworkViews).accEthPerShare(),
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

    // Generate report
    try {
      const report = runner.generateReport();
      console.log(`\n${report}`);
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
