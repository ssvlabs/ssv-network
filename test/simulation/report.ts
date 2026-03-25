/**
 * Report Generator — reads JSONL file and produces a human-readable report.
 *
 * Sections:
 * 1. BUG CANDIDATES (critical findings with repro info)
 * 2. COVERAGE MATRIX (per-scenario: picked, completed, stopped@step)
 * 3. NOT REACHED (scenarios never picked)
 * 4. HIGH SKIP RATE (>80% stopped at step 1)
 */

import { readJsonlFile } from "./jsonl-logger.ts";
import type { JsonlEvent } from "./scenario-types.ts";

interface BugCandidate {
  scenarioId: string;
  step: string;
  block: number;
  assertionDetail: string;
  pre: any;
  post: any;
}

interface ScenarioStats {
  id: string;
  picked: number;
  completed: number;
  stoppedAtStep: Record<string, number>;
  bugs: number;
}

export function generateReport(filePath: string, allScenarioIds: string[]): string {
  const events = readJsonlFile(filePath);
  const lines: string[] = [];

  // Parse events
  const bugs: BugCandidate[] = [];
  const scenarioStats = new Map<string, ScenarioStats>();

  // Initialize stats for all known scenarios
  for (const id of allScenarioIds) {
    scenarioStats.set(id, {
      id,
      picked: 0,
      completed: 0,
      stoppedAtStep: {},
      bugs: 0,
    });
  }

  let runStart: JsonlEvent | undefined;
  let runEnd: JsonlEvent | undefined;

  for (const event of events) {
    switch (event.type) {
      case "run.start":
        runStart = event;
        break;

      case "run.end":
        runEnd = event;
        break;

      case "scenario.start": {
        const id = event.scenarioId as string;
        const stats = scenarioStats.get(id);
        if (stats) stats.picked++;
        break;
      }

      case "scenario.end": {
        const id = event.scenarioId as string;
        const outcome = event.outcome as string;
        const stats = scenarioStats.get(id);
        if (!stats) break;
        if (outcome === "completed") {
          stats.completed++;
        } else if (outcome === "stopped") {
          const step = (event.stoppedAtStep as string) ?? "unknown";
          stats.stoppedAtStep[step] = (stats.stoppedAtStep[step] ?? 0) + 1;
        }
        break;
      }

      case "bug_candidate": {
        const bug: BugCandidate = {
          scenarioId: event.scenarioId as string,
          step: event.step as string,
          block: event.block as number,
          assertionDetail: event.assertionDetail as string,
          pre: event.pre,
          post: event.post,
        };
        bugs.push(bug);
        const stats = scenarioStats.get(bug.scenarioId);
        if (stats) stats.bugs++;
        break;
      }
    }
  }

  // --- Header ---
  lines.push("=" .repeat(72));
  lines.push("  SCENARIO MC SIMULATION REPORT");
  lines.push("=" .repeat(72));
  if (runStart) {
    lines.push(`Seed: ${runStart.seed ?? "unknown"}`);
    lines.push(`Started: ${new Date(runStart.timestamp).toISOString()}`);
  }
  if (runEnd) {
    lines.push(`Duration: ${((runEnd.durationMs as number) / 1000).toFixed(1)}s`);
    lines.push(`Total picks: ${runEnd.totalPicks ?? 0}`);
  }
  lines.push("");

  // --- BUG CANDIDATES ---
  lines.push("-".repeat(72));
  lines.push("  BUG CANDIDATES");
  lines.push("-".repeat(72));
  if (bugs.length === 0) {
    lines.push("  (none found)");
  } else {
    for (const bug of bugs) {
      lines.push(`  [BUG] scenario=${bug.scenarioId} step=${bug.step} block=${bug.block}`);
      lines.push(`        ${bug.assertionDetail}`);
      lines.push("");
    }
  }
  lines.push("");

  // --- COVERAGE MATRIX ---
  lines.push("-".repeat(72));
  lines.push("  COVERAGE MATRIX");
  lines.push("-".repeat(72));
  lines.push(
    `  ${"Scenario".padEnd(30)} ${"Picked".padStart(7)} ${"Done".padStart(7)} ${"Stopped".padStart(7)} ${"Bugs".padStart(5)}`,
  );
  lines.push("  " + "-".repeat(60));

  const sortedStats = [...scenarioStats.values()].sort(
    (a, b) => b.picked - a.picked,
  );

  for (const s of sortedStats) {
    if (s.picked === 0) continue;
    const stopped = Object.values(s.stoppedAtStep).reduce((a, b) => a + b, 0);
    lines.push(
      `  ${s.id.padEnd(30)} ${String(s.picked).padStart(7)} ${String(s.completed).padStart(7)} ${String(stopped).padStart(7)} ${String(s.bugs).padStart(5)}`,
    );
    // Show stopped-at-step breakdown
    for (const [step, count] of Object.entries(s.stoppedAtStep)) {
      lines.push(`    stopped@"${step}": ${count}`);
    }
  }
  lines.push("");

  // --- NOT REACHED ---
  const neverPicked = sortedStats.filter((s) => s.picked === 0);
  if (neverPicked.length > 0) {
    lines.push("-".repeat(72));
    lines.push("  NOT REACHED (never picked)");
    lines.push("-".repeat(72));
    for (const s of neverPicked) {
      lines.push(`  - ${s.id}`);
    }
    lines.push("");
  }

  // --- HIGH SKIP RATE ---
  const highSkip = sortedStats.filter((s) => {
    if (s.picked < 3) return false; // need enough samples
    const stopped = Object.values(s.stoppedAtStep).reduce((a, b) => a + b, 0);
    return stopped / s.picked > 0.8;
  });
  if (highSkip.length > 0) {
    lines.push("-".repeat(72));
    lines.push("  HIGH SKIP RATE (>80% stopped at step 1 — needs weight tuning)");
    lines.push("-".repeat(72));
    for (const s of highSkip) {
      const stopped = Object.values(s.stoppedAtStep).reduce((a, b) => a + b, 0);
      const rate = ((stopped / s.picked) * 100).toFixed(0);
      lines.push(`  - ${s.id}: ${rate}% skip rate (${stopped}/${s.picked})`);
    }
    lines.push("");
  }

  lines.push("=" .repeat(72));
  return lines.join("\n");
}
