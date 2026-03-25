/**
 * Scenario auto-discovery — dynamically imports all scenario files
 * in this directory. Adding a new .ts file here automatically includes
 * it in ALL_SCENARIOS without editing this file.
 *
 * A valid scenario export is any object with `id: string` and `run: Function`.
 */

import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { Scenario } from "../simulation/scenario-types.ts";

const __dirname_esm = dirname(fileURLToPath(import.meta.url));

function isScenario(v: unknown): v is Scenario {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    "run" in v &&
    typeof (v as any).id === "string" &&
    typeof (v as any).run === "function"
  );
}

const scenarioFiles = readdirSync(__dirname_esm).filter(
  (f) => f.endsWith(".ts") && f !== "index.ts",
);

const discovered: Scenario[] = [];
for (const file of scenarioFiles) {
  const fullPath = join(__dirname_esm, file);
  const mod = await import(pathToFileURL(fullPath).href);
  for (const exported of Object.values(mod)) {
    if (isScenario(exported)) {
      discovered.push(exported);
    }
  }
}

/** All auto-discovered scenarios. */
export const ALL_SCENARIOS: Scenario[] = discovered;

/**
 * Get scenarios filtered by tags.
 * If no tags specified, returns all scenarios.
 */
export function getScenariosByTags(tags?: string[]): Scenario[] {
  if (!tags || tags.length === 0) return ALL_SCENARIOS;
  return ALL_SCENARIOS.filter((s) =>
    tags.some((tag) => s.tags.includes(tag)),
  );
}
