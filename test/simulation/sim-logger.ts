/**
 * Simulation logger — records every action attempted during a simulation run.
 *
 * Provides summary statistics and full JSON export for debugging.
 */

import type { ActionResult } from "./types.ts";

interface LogEntry extends ActionResult {
  /** Block number when the action was attempted */
  block: number;
  /** Timestamp (ms since epoch) when the entry was recorded */
  timestamp: number;
}

interface ActionStats {
  attempted: number;
  succeeded: number;
  reverted: number;
  revertReasons: Record<string, number>;
}

export interface SimSummary {
  totalAttempted: number;
  totalSucceeded: number;
  totalReverted: number;
  successRate: string;
  byAction: Record<string, ActionStats>;
  durationMs: number;
}

export class SimLogger {
  private entries: LogEntry[] = [];
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Record an action result.
   *
   * @param block - block number when action was attempted
   * @param result - the action result
   */
  record(block: number, result: ActionResult): void {
    this.entries.push({
      ...result,
      block,
      timestamp: Date.now(),
    });
  }

  /** Total actions attempted */
  get count(): number {
    return this.entries.length;
  }

  /**
   * Generate a summary of all recorded actions.
   */
  summary(): SimSummary {
    const byAction: Record<string, ActionStats> = {};

    let totalSucceeded = 0;
    let totalReverted = 0;

    for (const entry of this.entries) {
      if (!byAction[entry.name]) {
        byAction[entry.name] = {
          attempted: 0,
          succeeded: 0,
          reverted: 0,
          revertReasons: {},
        };
      }

      const stats = byAction[entry.name];
      stats.attempted++;

      if (entry.success) {
        stats.succeeded++;
        totalSucceeded++;
      } else {
        stats.reverted++;
        totalReverted++;

        const reason = entry.revertReason ?? "unknown";
        stats.revertReasons[reason] = (stats.revertReasons[reason] ?? 0) + 1;
      }
    }

    const total = this.entries.length;

    return {
      totalAttempted: total,
      totalSucceeded,
      totalReverted,
      successRate: total > 0 ? `${((totalSucceeded / total) * 100).toFixed(1)}%` : "N/A",
      byAction,
      durationMs: Date.now() - this.startTime,
    };
  }

  /**
   * Export full log as JSON-serializable object.
   */
  toJSON(): { summary: SimSummary; entries: LogEntry[] } {
    return {
      summary: this.summary(),
      entries: [...this.entries],
    };
  }

  /**
   * Format summary as a human-readable string for console output.
   */
  formatSummary(): string {
    const s = this.summary();
    const lines: string[] = [
      `\n=== Simulation Summary ===`,
      `Total: ${s.totalAttempted} actions (${s.totalSucceeded} ok, ${s.totalReverted} reverted) — ${s.successRate} success`,
      `Duration: ${(s.durationMs / 1000).toFixed(1)}s`,
      ``,
      `Per-action breakdown:`,
    ];

    const sorted = Object.entries(s.byAction).sort(
      ([, a], [, b]) => b.attempted - a.attempted,
    );

    for (const [name, stats] of sorted) {
      const rate =
        stats.attempted > 0
          ? `${((stats.succeeded / stats.attempted) * 100).toFixed(0)}%`
          : "N/A";
      lines.push(
        `  ${name.padEnd(28)} ${String(stats.attempted).padStart(4)} attempted, ${String(stats.succeeded).padStart(4)} ok (${rate})`,
      );

      if (stats.reverted > 0) {
        for (const [reason, count] of Object.entries(stats.revertReasons)) {
          lines.push(
            `    ${"".padEnd(28)} revert: ${reason} (×${count})`,
          );
        }
      }
    }

    lines.push(`\n=========================\n`);
    return lines.join("\n");
  }
}
