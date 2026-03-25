/**
 * Type definitions for the scenario-driven Monte Carlo engine.
 */

// --- Step outcome classification ---

export type StepOutcome =
  | "PASS"
  | "EXPECTED_REVERT"
  | "UNEXPECTED_REVERT"
  | "ASSERTION_FAIL";

// --- Step result ---

export interface StepResult {
  /** Step name (human-readable label) */
  name: string;
  /** Classification of the step outcome */
  outcome: StepOutcome;
  /** Block number when step was executed */
  block: number;
  /** Transaction hash (if TX was sent) */
  txHash?: string;
  /** Revert reason (if step reverted) */
  revertReason?: string;
  /** Assertion failure detail (if assertions failed) */
  assertionDetail?: string;
  /** Pre-state snapshot */
  pre: StateSnapshotCompact;
  /** Post-state snapshot (only if TX succeeded) */
  post?: StateSnapshotCompact;
  /** Wall-clock time for the step in milliseconds */
  elapsed_ms: number;
}

/** Compact snapshot for JSONL serialization (bigints as strings) */
export interface StateSnapshotCompact {
  block: number;
  daoTotalEthVUnits: string;
  networkFee: string;
  accEthPerShare: string;
  contractEthBalance: string;
  operatorCount: number;
  clusterBalance?: string;
  clusterActive?: boolean;
}

// --- Scenario definition ---

/** Forward reference — ScenarioContext is defined in scenario-context.ts */
export interface ScenarioContextRef {
  step(
    name: string,
    action: () => Promise<void>,
    assert: (pre: any, post: any) => Promise<void>,
  ): Promise<StepResult>;
}

export interface Scenario {
  /** Unique scenario identifier */
  id: string;
  /** Tags for filtering/weighting (e.g. ["cluster", "deposit", "happy-path"]) */
  tags: string[];
  /** Execute the scenario using the provided context */
  run(ctx: ScenarioContextRef): Promise<void>;
}

// --- StepReverted error ---

/**
 * Thrown by step() when the action reverts.
 * The scenario runner catches this to log "stopped at step N" and move on.
 */
export class StepReverted extends Error {
  constructor(
    public stepName: string,
    public reason: string,
  ) {
    super(`Step "${stepName}" reverted: ${reason}`);
    this.name = "StepReverted";
  }
}

// --- AssertionFailed error ---

/**
 * Thrown by step() when post-state assertions fail.
 * The scenario runner catches this to record a BUG CANDIDATE.
 */
export class AssertionFailed extends Error {
  constructor(
    public stepName: string,
    public detail: string,
  ) {
    super(`Step "${stepName}" assertion failed: ${detail}`);
    this.name = "AssertionFailed";
  }
}

// --- ScenarioSkipped error ---

/**
 * Thrown by scenarios when a precondition is not met (e.g. no SSV clusters,
 * no active operator in cluster). The runner catches this as "stopped"
 * with reason "precondition" — NOT as a bug candidate.
 */
export class ScenarioSkipped extends Error {
  constructor(public reason: string) {
    super(`Scenario skipped: ${reason}`);
    this.name = "ScenarioSkipped";
  }
}

// --- JSONL event types ---

export type JsonlEventType =
  | "run.start"
  | "scenario.start"
  | "step.end"
  | "scenario.end"
  | "bug_candidate"
  | "invariant"
  | "run.end";

export interface JsonlEvent {
  type: JsonlEventType;
  timestamp: number;
  [key: string]: unknown;
}

// --- Coverage tracking ---

export interface ScenarioCoverage {
  id: string;
  tags: string[];
  picked: number;
  completed: number;
  stoppedAtStep: Map<string, number>;
  bugCandidates: number;
}

export interface RunSummary {
  seed: string;
  totalPicks: number;
  totalCompleted: number;
  totalStopped: number;
  totalBugs: number;
  neverPicked: string[];
  coverage: Map<string, ScenarioCoverage>;
  durationMs: number;
}
