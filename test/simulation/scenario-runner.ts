/**
 * ScenarioRunner — orchestrates the main Monte Carlo loop.
 *
 * - Loads all scenarios from test/scenarios/ via auto-discovery
 * - Main loop: pick random scenario → create context → run → classify
 * - Tracks per-scenario coverage
 * - Runs global invariants periodically
 */

import type { Scenario, ScenarioCoverage, RunSummary } from "./scenario-types.ts";
import type { SimulationState } from "./types.ts";
import type { InvariantContext } from "./invariants.ts";
import { StepReverted, AssertionFailed } from "./scenario-types.ts";
import { ScenarioContext } from "./scenario-context.ts";
import { JsonlLogger } from "./jsonl-logger.ts";
import { SeededRNG } from "./rng.ts";
import { runPeriodicInvariants } from "./invariants.ts";
import { generateReport } from "./report.ts";

export interface ScenarioRunnerConfig {
  /** Number of scenario picks to execute */
  totalPicks: number;
  /** Run global invariants every N picks */
  invariantEvery: number;
  /** Seed for deterministic replay */
  seed?: bigint;
}

const DEFAULT_CONFIG: ScenarioRunnerConfig = {
  totalPicks: 50,
  invariantEvery: 10,
};

export class ScenarioRunner {
  private scenarios: Scenario[] = [];
  private config: ScenarioRunnerConfig;
  private coverage: Map<string, ScenarioCoverage> = new Map();
  private logger: JsonlLogger;
  private rng: SeededRNG;

  constructor(config?: Partial<ScenarioRunnerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = new SeededRNG(this.config.seed);
    const seedStr = (this.config.seed ?? 0xDEADBEEFCAFEBABEn).toString(16);
    this.logger = new JsonlLogger(seedStr);
  }

  /** Register scenarios for execution. */
  registerScenarios(scenarios: Scenario[]): void {
    this.scenarios = scenarios;
    for (const s of scenarios) {
      this.coverage.set(s.id, {
        id: s.id,
        tags: s.tags,
        picked: 0,
        completed: 0,
        stoppedAtStep: new Map(),
        bugCandidates: 0,
      });
    }
  }

  /** Run the main Monte Carlo loop. */
  async run(
    state: SimulationState,
    invCtx: InvariantContext,
  ): Promise<RunSummary> {
    if (this.scenarios.length === 0) {
      throw new Error("No scenarios registered — call registerScenarios() first");
    }

    this.logger.open();
    const startMs = Date.now();

    let totalCompleted = 0;
    let totalStopped = 0;
    let totalBugs = 0;
    let durationMs = 0;

    try {
      this.logger.writeEvent({
        type: "run.start",
        timestamp: Date.now(),
        seed: (this.config.seed ?? 0xDEADBEEFCAFEBABEn).toString(16),
        totalPicks: this.config.totalPicks,
        scenarioCount: this.scenarios.length,
      });

      for (let pick = 0; pick < this.config.totalPicks; pick++) {
        // Pick a random scenario
        const scenario = this.rng.pick(this.scenarios);
        const cov = this.coverage.get(scenario.id)!;
        cov.picked++;

        this.logger.writeEvent({
          type: "scenario.start",
          timestamp: Date.now(),
          scenarioId: scenario.id,
          pick,
          tags: scenario.tags,
        });

        // Create a fresh ScenarioContext for this run
        const ctx = new ScenarioContext({
          contracts: {
            network: state.network,
            views: state.views,
            ssvToken: state.ssvToken,
            cssvToken: state.cssvToken,
          },
          provider: state.provider,
          proxyAddress: state.networkAddress,
          actors: {
            clusterOwners: [...state.clusterBook.values()].map((c) => c.ownerSigner),
            operators: state.operatorPool,
            oracles: state.oracleSigners,
            stakers: state.stakerPool,
          },
          simState: state,
          rng: this.rng,
          logger: this.logger,
          scenarioId: scenario.id,
        });

        // Run the scenario
        let outcome: "completed" | "stopped" | "bug" = "completed";
        let stoppedAtStep: string | undefined;

        try {
          await scenario.run(ctx);
          totalCompleted++;
          cov.completed++;
        } catch (err) {
          if (err instanceof StepReverted) {
            outcome = "stopped";
            stoppedAtStep = err.stepName;
            totalStopped++;
            const count = cov.stoppedAtStep.get(err.stepName) ?? 0;
            cov.stoppedAtStep.set(err.stepName, count + 1);
          } else if (err instanceof AssertionFailed) {
            // Assertion failure — already logged by step(), just count it
            outcome = "bug";
            totalBugs++;
            cov.bugCandidates++;
          } else {
            // Unexpected error — treat as bug
            outcome = "bug";
            totalBugs++;
            cov.bugCandidates++;
            this.logger.writeEvent({
              type: "bug_candidate",
              timestamp: Date.now(),
              scenarioId: scenario.id,
              step: "unknown",
              assertionDetail: err instanceof Error ? err.message : String(err),
            });
          }
        }

        this.logger.writeEvent({
          type: "scenario.end",
          timestamp: Date.now(),
          scenarioId: scenario.id,
          pick,
          outcome,
          stoppedAtStep,
        });

        // Periodic invariant checks
        if (
          this.config.invariantEvery > 0 &&
          (pick + 1) % this.config.invariantEvery === 0
        ) {
          const results = await runPeriodicInvariants(state, invCtx);
          for (const r of results) {
            this.logger.writeEvent({
              type: "invariant",
              timestamp: Date.now(),
              id: r.id,
              passed: r.passed,
              message: r.message,
              pick,
            });
          }
          const failures = results.filter((r) => !r.passed);
          if (failures.length > 0) {
            console.warn(
              `[RUNNER] Invariant failures at pick ${pick}: ${failures.map((f) => f.id).join(", ")}`,
            );
          }
        }

        // Update current block
        state.currentBlock = await state.provider.getBlockNumber();
      }
    } finally {
      durationMs = Date.now() - startMs;
      const neverPicked = [...this.coverage.values()]
        .filter((c) => c.picked === 0)
        .map((c) => c.id);

      this.logger.writeEvent({
        type: "run.end",
        timestamp: Date.now(),
        totalPicks: this.config.totalPicks,
        totalCompleted,
        totalStopped,
        totalBugs,
        neverPicked,
        durationMs,
      });

      this.logger.close();
    }

    const neverPicked = [...this.coverage.values()]
      .filter((c) => c.picked === 0)
      .map((c) => c.id);

    return {
      seed: (this.config.seed ?? 0xDEADBEEFCAFEBABEn).toString(16),
      totalPicks: this.config.totalPicks,
      totalCompleted,
      totalStopped,
      totalBugs,
      neverPicked,
      coverage: this.coverage,
      durationMs,
    };
  }

  /** Generate a human-readable report from the JSONL output. */
  generateReport(): string {
    const allIds = this.scenarios.map((s) => s.id);
    return generateReport(this.logger.getFilePath(), allIds);
  }

  /** Get the JSONL output file path. */
  getOutputPath(): string {
    return this.logger.getFilePath();
  }
}
