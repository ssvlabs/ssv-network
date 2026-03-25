/**
 * ScenarioContext — the core API that scenario scripts interact with.
 *
 * Provides:
 * - step() — the heart of the engine with 4-outcome classification
 * - Entity picking helpers (pickCluster, pickOperator, etc.)
 * - Utilities (mineBlocks, snapshot, getBlockNumber)
 */

import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { SSVNetwork, SSVNetworkViews } from "../../types/ethers-contracts/index.js";
import type { ClusterRecord, OperatorRecord, StakerRecord } from "./types.ts";
import type { SimulationState } from "./types.ts";
import type { StateSnapshot } from "./state-snapshot.ts";
import type { StepResult } from "./scenario-types.ts";
import type { JsonlLogger } from "./jsonl-logger.ts";

import { StepReverted, AssertionFailed } from "./scenario-types.ts";
import { captureSnapshot, compactSnapshot } from "./state-snapshot.ts";
import { SeededRNG } from "./rng.ts";

// --- ScenarioContext ---

export interface ScenarioContextContracts {
  network: SSVNetwork;
  views: SSVNetworkViews;
  ssvToken: any;
  cssvToken: any;
}

export interface ScenarioContextActors {
  clusterOwners: HardhatEthersSigner[];
  operators: Map<bigint, OperatorRecord>;
  oracles: HardhatEthersSigner[];
  stakers: StakerRecord[];
}

export class ScenarioContext {
  readonly contracts: ScenarioContextContracts;
  readonly provider: any;
  readonly proxyAddress: string;
  readonly actors: ScenarioContextActors;
  readonly simState: SimulationState;
  readonly rng: SeededRNG;

  private logger: JsonlLogger;
  private scenarioId: string;
  private stepIndex: number = 0;
  private activeCluster: ClusterRecord | null = null;

  constructor(params: {
    contracts: ScenarioContextContracts;
    provider: any;
    proxyAddress: string;
    actors: ScenarioContextActors;
    simState: SimulationState;
    rng: SeededRNG;
    logger: JsonlLogger;
    scenarioId: string;
  }) {
    this.contracts = params.contracts;
    this.provider = params.provider;
    this.proxyAddress = params.proxyAddress;
    this.actors = params.actors;
    this.simState = params.simState;
    this.rng = params.rng;
    this.logger = params.logger;
    this.scenarioId = params.scenarioId;
  }

  // --- Entity picking ---

  /** Pick a random active ETH cluster from the cluster book. */
  pickCluster(): ClusterRecord {
    const active = [...this.simState.clusterBook.values()].filter(
      (c) => c.cluster.active,
    );
    if (active.length === 0) {
      throw new Error("No active clusters available");
    }
    return this.rng.pick(active);
  }

  /** Pick a random active operator. */
  pickOperator(): OperatorRecord {
    const active = [...this.actors.operators.values()].filter(
      (op) => op.isActive,
    );
    if (active.length === 0) {
      throw new Error("No active operators available");
    }
    return this.rng.pick(active);
  }

  /** Pick a random removed (inactive) operator, or null if none. */
  pickRemovedOperator(): OperatorRecord | null {
    const removed = [...this.actors.operators.values()].filter(
      (op) => !op.isActive,
    );
    return removed.length > 0 ? this.rng.pick(removed) : null;
  }

  /**
   * Set the active cluster for state snapshots.
   * Scenarios should call this before their first step so that
   * captureCurrentState() snapshots the correct cluster.
   */
  setActiveCluster(record: ClusterRecord): void {
    this.activeCluster = record;
  }

  // --- The core step() method ---

  /**
   * Execute a named step with 4-outcome classification:
   *
   * 1. Capture pre-state snapshot
   * 2. Execute the action
   * 3. If TX reverts → log EXPECTED_REVERT, throw StepReverted
   * 4. If TX succeeds → capture post-state snapshot
   * 5. Run assertions on pre/post
   * 6. If assertions pass → log PASS, return
   * 7. If assertions fail → log ASSERTION_FAIL as BUG CANDIDATE
   */
  async step(
    name: string,
    action: () => Promise<string | void>,
    assert: (pre: StateSnapshot, post: StateSnapshot) => Promise<void>,
  ): Promise<StepResult> {
    this.stepIndex++;
    const stepLabel = `${this.scenarioId}:step-${this.stepIndex}:${name}`;
    const startMs = Date.now();

    // 1. Capture pre-state
    const pre = await this.captureCurrentState();

    // 2. Try executing the action
    let txHash: string | undefined;
    try {
      const result = await action();
      if (typeof result === "string") txHash = result;
    } catch (err: any) {
      // 3. Action reverted
      const reason = extractRevertReason(err);
      const elapsed_ms = Date.now() - startMs;
      this.logger.writeEvent({
        type: "step.end",
        timestamp: Date.now(),
        scenarioId: this.scenarioId,
        step: name,
        stepIndex: this.stepIndex,
        outcome: "EXPECTED_REVERT",
        block: pre.block,
        revertReason: reason,
        elapsed_ms,
      });
      throw new StepReverted(name, reason);
    }

    // 4. TX succeeded — capture post-state
    const post = await this.captureCurrentState();
    const block = post.block;

    // 5. Run assertions
    try {
      await assert(pre, post);
    } catch (err: any) {
      // 7. Assertion failure → BUG CANDIDATE — log and throw
      const assertionDetail = err instanceof Error ? err.message : String(err);
      const elapsed_ms = Date.now() - startMs;
      this.logger.writeEvent({
        type: "step.end",
        timestamp: Date.now(),
        scenarioId: this.scenarioId,
        step: name,
        stepIndex: this.stepIndex,
        outcome: "ASSERTION_FAIL",
        block,
        txHash,
        assertionDetail,
        elapsed_ms,
      });
      this.logger.writeEvent({
        type: "bug_candidate",
        timestamp: Date.now(),
        scenarioId: this.scenarioId,
        step: name,
        stepIndex: this.stepIndex,
        block,
        assertionDetail,
        pre: compactSnapshot(pre),
        post: compactSnapshot(post),
      });
      throw new AssertionFailed(name, assertionDetail);
    }

    // 6. Assertions passed → PASS
    const elapsed_ms = Date.now() - startMs;
    const result: StepResult = {
      name: stepLabel,
      outcome: "PASS",
      block,
      txHash,
      pre: compactSnapshot(pre),
      post: compactSnapshot(post),
      elapsed_ms,
    };
    this.logger.writeEvent({
      type: "step.end",
      timestamp: Date.now(),
      scenarioId: this.scenarioId,
      step: name,
      stepIndex: this.stepIndex,
      outcome: "PASS",
      block,
      elapsed_ms,
    });
    return result;
  }

  // --- Utilities ---

  async mineBlocks(n: number): Promise<void> {
    if (n <= 0) return;
    await this.provider.send("hardhat_mine", ["0x" + n.toString(16)]);
  }

  async snapshot(): Promise<StateSnapshot> {
    return this.captureCurrentState();
  }

  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  // --- Private helpers ---

  private async captureCurrentState(): Promise<StateSnapshot> {
    // Gather all operator IDs from the context
    const operatorIds = [...this.actors.operators.keys()];

    // Use the active cluster set by the scenario, falling back to first active
    let clusterInfo: any;
    if (this.activeCluster) {
      clusterInfo = {
        owner: this.activeCluster.owner,
        operatorIds: this.activeCluster.operatorIds,
        clusterTuple: this.activeCluster.cluster,
      };
    } else {
      const activeClusters = [...this.simState.clusterBook.values()].filter(
        (c) => c.cluster.active,
      );
      if (activeClusters.length > 0) {
        const c = activeClusters[0];
        clusterInfo = {
          owner: c.owner,
          operatorIds: c.operatorIds,
          clusterTuple: c.cluster,
        };
      }
    }

    return captureSnapshot({
      provider: this.provider,
      views: this.contracts.views,
      proxyAddress: this.proxyAddress,
      operatorIds,
      cluster: clusterInfo,
    });
  }
}

// --- Helpers ---

function extractRevertReason(err: any): string {
  if (typeof err === "string") return err.slice(0, 200);
  if (err?.reason) return String(err.reason).slice(0, 200);
  if (err?.message) {
    // Try to extract revert reason from error message
    const match = err.message.match(/reverted with reason string '([^']+)'/);
    if (match) return match[1];
    const customMatch = err.message.match(/reverted with custom error '([^']+)'/);
    if (customMatch) return customMatch[1];
    return err.message.slice(0, 200);
  }
  return "unknown revert";
}
