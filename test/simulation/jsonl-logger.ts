/**
 * JSONL Logger — streams structured events to disk.
 *
 * Writes to test/simulation/output/run-{seed}-{timestamp}.jsonl
 * One JSON object per line for easy grep/jq processing.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { JsonlEvent } from "./scenario-types.ts";

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const OUTPUT_DIR = path.join(__dirname_esm, "output");

export class JsonlLogger {
  private fd: number | null = null;
  private filePath: string;
  private eventCount: number = 0;

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
