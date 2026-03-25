/**
 * JSONL Logger — streams structured events to disk.
 *
 * Writes to test/simulation/output/run-{seed}-{timestamp}.jsonl
 * One JSON object per line for easy grep/jq processing.
 *
 * Enhanced in W11-B:
 * - Run metadata (git commit, timestamp, fork block)
 * - Pre/post state snapshots on step.end events
 * - Compact state diffs for PASS steps (avoids bloating with full snapshots)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import type { JsonlEvent, StateSnapshotCompact } from "./scenario-types.ts";

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const OUTPUT_DIR = path.join(__dirname_esm, "output");

/** Run-level metadata embedded in the run.start event. */
export interface RunMetadata {
  gitCommit: string;
  gitBranch: string;
  timestamp: string;
  forkBlock?: number;
}

/**
 * Capture run metadata: git info + timestamp.
 * Safe — returns "unknown" if git commands fail.
 */
export function captureRunMetadata(forkBlock?: number): RunMetadata {
  let gitCommit = "unknown";
  let gitBranch = "unknown";
  try {
    gitCommit = execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    // Not in a git repo or git not available
  }
  try {
    gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    // ignore
  }
  return {
    gitCommit,
    gitBranch,
    timestamp: new Date().toISOString(),
    forkBlock,
  };
}

/**
 * Compute a compact diff between two state snapshots.
 * Only includes fields that changed, with before/after values.
 * Returns undefined if nothing changed.
 */
export function compactStateDiff(
  pre: StateSnapshotCompact,
  post: StateSnapshotCompact,
): Record<string, { before: unknown; after: unknown }> | undefined {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  const keys: (keyof StateSnapshotCompact)[] = [
    "block",
    "daoTotalEthVUnits",
    "networkFee",
    "accEthPerShare",
    "contractEthBalance",
    "operatorCount",
    "clusterBalance",
    "clusterActive",
  ];

  for (const key of keys) {
    const preVal = pre[key];
    const postVal = post[key];
    if (String(preVal) !== String(postVal)) {
      diff[key] = { before: preVal, after: postVal };
    }
  }

  return Object.keys(diff).length > 0 ? diff : undefined;
}

export class JsonlLogger {
  private fd: number | null = null;
  private filePath: string;
  private eventCount: number = 0;
  private metadata: RunMetadata | null = null;

  constructor(seed: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `run-${seed}-${timestamp}.jsonl`;
    this.filePath = path.join(OUTPUT_DIR, filename);
  }

  /** Initialize the logger — creates output directory and opens the file. */
  open(): void {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    this.fd = fs.openSync(this.filePath, "w");
  }

  /** Set run metadata (called once before writing run.start). */
  setMetadata(meta: RunMetadata): void {
    this.metadata = meta;
  }

  /** Get the run metadata. */
  getMetadata(): RunMetadata | null {
    return this.metadata;
  }

  /** Write a single JSONL event. */
  writeEvent(event: JsonlEvent): void {
    if (this.fd === null) return;
    const line = JSON.stringify(event, bigintReplacer) + "\n";
    fs.writeSync(this.fd, line);
    this.eventCount++;
  }

  /** Close the file descriptor. */
  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  /** Get the output file path. */
  getFilePath(): string {
    return this.filePath;
  }

  /** Get total events written. */
  getEventCount(): number {
    return this.eventCount;
  }
}

/**
 * JSON replacer that converts bigint values to strings.
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

/**
 * Read and parse a JSONL file, returning an array of events.
 */
export function readJsonlFile(filePath: string): JsonlEvent[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line) => JSON.parse(line) as JsonlEvent);
}
