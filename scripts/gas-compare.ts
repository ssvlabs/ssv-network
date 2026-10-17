#!/usr/bin/env npx tsx
import * as fs from 'node:fs';
import * as path from 'node:path';
interface GasReportEntry {
  name: string;
  maxLimit: number;
  min: number | null;
  max: number | null;
  average: number | null;
  txCount: number;
  withinLimit: boolean;
}

interface GasReport {
  timestamp: string;
  commit?: string;
  branch?: string;
  entries: GasReportEntry[];
  summary: {
    totalOperations: number;
    operationsWithData: number;
    allWithinLimits: boolean;
  };
}

interface ComparisonResult {
  name: string;
  baseline: number | null;
  current: number | null;
  difference: number | null;
  percentChange: number | null;
}

const args = process.argv.slice(2);
let baselinePath = 'test/helpers/v1-gas-report.json';
let currentPath = 'gas-report.json';
let baselineLabel = process.env.BASELINE_TAG || 'v1.2.0';
let currentLabel = process.env.CURRENT_LABEL || 'current';
let outputPath = process.env.GAS_COMPARE_OUTPUT || 'gas-compare.txt';
// informational: print the baseline comparison and always exit 0 (historical v1 table).
// limits:        fail unless every tracked operation's max gas is within its MAX_GAS_PER_GROUP
//                limit as recorded in the current report (no baseline needed).
// enforce:       fail on any average-gas regression vs the baseline, or on a baseline operation
//                that has no data in the current report.
// exact:         frozen-graph equivalence gate: fail unless the current report has exactly the
//                baseline's operation set and every entry's maxLimit/min/max/average/txCount/
//                withinLimit plus the summary are equal. Only timestamp/commit/branch are ignored.
// --expected-ops <file> (limits, exact): one operation name per line; fail unless the set of
//                operations with data is exactly this set, so an operation that loses all
//                tracking cannot pass silently.
type Mode = 'informational' | 'limits' | 'enforce' | 'exact';
let mode: Mode = 'informational';
let expectedOpsPath: string | undefined;
let baselineGiven = false;

// An option value may not itself be an option (`--baseline --mode` is incomplete, not a path).
const hasValue = (i: number) => args[i + 1] !== undefined && !args[i + 1].startsWith('--');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--baseline' && hasValue(i)) {
    baselinePath = args[++i];
    baselineGiven = true;
  } else if (args[i] === '--expected-ops' && hasValue(i)) {
    expectedOpsPath = args[++i];
  } else if (args[i] === '--current' && hasValue(i)) {
    currentPath = args[++i];
  } else if (args[i] === '--baseline-label' && hasValue(i)) {
    baselineLabel = args[++i];
  } else if (args[i] === '--current-label' && hasValue(i)) {
    currentLabel = args[++i];
  } else if (args[i] === '--output' && hasValue(i)) {
    outputPath = args[++i];
  } else if (args[i] === '--mode' && hasValue(i)) {
    const value = args[++i];
    if (value !== 'informational' && value !== 'limits' && value !== 'enforce' && value !== 'exact') {
      console.error(`Unknown --mode ${value} (expected informational|limits|enforce|exact)`);
      process.exit(2);
    }
    mode = value;
  } else {
    console.error(`Unknown or incomplete argument: ${args[i]}`);
    process.exit(2);
  }
}
if (mode === 'exact' && !baselineGiven) {
  console.error('--mode exact requires an explicit --baseline <frozen reference gas-report.json>');
  process.exit(2);
}
if (expectedOpsPath && mode !== 'limits' && mode !== 'exact') {
  console.error('--expected-ops applies only to --mode limits or --mode exact');
  process.exit(2);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

function loadJson<T>(filePath: string): T | null {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    console.error(`Failed to parse ${absolutePath}:`, error);
    return null;
  }
}

function buildEntryMap(report: GasReport): Map<string, GasReportEntry> {
  const map = new Map<string, GasReportEntry>();
  for (const entry of report.entries) {
    map.set(entry.name, entry);
  }
  return map;
}

function compare(baseline: GasReport, current: GasReport): ComparisonResult[] {
  const results: ComparisonResult[] = [];
  const baselineEntries = buildEntryMap(baseline);
  const currentEntries = buildEntryMap(current);
  const names = new Set<string>();

  for (const entry of baseline.entries) {
    if (entry.average !== null) names.add(entry.name);
  }

  for (const entry of current.entries) {
    if (entry.average !== null) names.add(entry.name);
  }

  for (const name of names) {
    const baselineEntry = baselineEntries.get(name);
    const currentEntry = currentEntries.get(name);
    const baselineValue = baselineEntry?.average ?? null;
    const currentValue = currentEntry?.average ?? null;
    const hasValues = baselineValue !== null && currentValue !== null;
    const difference = hasValues ? currentValue - baselineValue : null;
    const percentChange =
      hasValues && baselineValue !== 0
        ? (difference / baselineValue) * 100
        : null;

    results.push({
      name,
      baseline: baselineValue,
      current: currentValue,
      difference,
      percentChange,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function formatNumber(value: number | null): string {
  return value === null ? '-' : value.toLocaleString();
}

function formatDiff(value: number | null): string {
  if (value === null) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toLocaleString()}`;
}

function formatPercent(value: number | null): string {
  if (value === null) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function printResults(results: ComparisonResult[]): string {
  const baselineWidth = Math.max(12, baselineLabel.length + 2);
  const currentWidth = Math.max(12, currentLabel.length + 2);
  const lines: string[] = [];

  lines.push('');
  lines.push('='.repeat(100));
  lines.push('                        GAS COMPARISON REPORT');
  lines.push('='.repeat(100));
  lines.push(`Baseline: ${baselineLabel}`);
  lines.push(`Current:  ${currentLabel}`);
  lines.push('-'.repeat(100));

  lines.push(
    padRight('Operation', 50) +
    padLeft(baselineLabel, baselineWidth) +
    padLeft(currentLabel, currentWidth) +
    padLeft('Diff', 12) +
    padLeft('Change', 12)
  );
  lines.push('-'.repeat(100));

  for (const result of results) {
    lines.push(
      padRight(result.name, 50) +
      padLeft(formatNumber(result.baseline), baselineWidth) +
      padLeft(formatNumber(result.current), currentWidth) +
      padLeft(formatDiff(result.difference), 12) +
      padLeft(formatPercent(result.percentChange), 12)
    );
  }

  lines.push('-'.repeat(100));

  const comparable = results.filter(r => r.difference !== null);
  const regressions = comparable.filter(r => (r.difference ?? 0) > 0);
  const improvements = comparable.filter(r => (r.difference ?? 0) < 0);
  const unchanged = comparable.filter(r => r.difference === 0);
  const missingBaseline = results.filter(r => r.baseline === null).length;
  const missingCurrent = results.filter(r => r.current === null).length;

  lines.push('');
  lines.push('Summary:');
  lines.push(`  Compared: ${comparable.length}`);
  lines.push(`  Regressions: ${regressions.length}`);
  lines.push(`  Improvements: ${improvements.length}`);
  lines.push(`  Unchanged: ${unchanged.length}`);
  lines.push(`  Missing baseline: ${missingBaseline}`);
  lines.push(`  Missing current: ${missingCurrent}`);
  lines.push('='.repeat(100));
  lines.push('');

  const output = lines.join('\n');
  console.log(output);
  return output;
}

function checkLimits(report: GasReport): string[] {
  const failures: string[] = [];
  const withData = report.entries.filter(e => e.txCount > 0);
  if (withData.length === 0) {
    failures.push('current report has no operations with gas data');
  }
  for (const entry of withData) {
    if (entry.max === null || !(entry.max <= entry.maxLimit)) {
      failures.push(`${entry.name}: max ${entry.max} exceeds limit ${entry.maxLimit}`);
    } else if (!entry.withinLimit) {
      failures.push(`${entry.name}: report marks withinLimit=false`);
    }
  }
  if (!report.summary?.allWithinLimits) {
    failures.push('report summary allWithinLimits is not true');
  }
  return failures;
}

function loadExpectedOps(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    console.error(`Expected-ops file not found: ${filePath}`);
    process.exit(2);
  }
  const names = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (names.length === 0 || new Set(names).size !== names.length) {
    console.error(`Expected-ops file ${filePath} is empty or has duplicates`);
    process.exit(2);
  }
  return names;
}

function checkExpectedOps(report: GasReport, expected: string[]): string[] {
  const failures: string[] = [];
  const withData = new Set(report.entries.filter(e => e.txCount > 0).map(e => e.name));
  const want = new Set(expected);
  for (const name of expected) if (!withData.has(name)) failures.push(`${name}: expected operation has no gas data`);
  for (const name of withData) if (!want.has(name)) failures.push(`${name}: operation with data is not in the expected set`);
  if (withData.size !== expected.length) failures.push(`operations with data ${withData.size} != expected ${expected.length}`);
  return failures;
}

const EXACT_FIELDS = ['maxLimit', 'min', 'max', 'average', 'txCount', 'withinLimit'] as const;

function checkExact(baseline: GasReport, current: GasReport): string[] {
  const failures: string[] = [];
  const names = (r: GasReport) => r.entries.map(e => e.name);
  for (const [label, r] of [['baseline', baseline], ['current', current]] as const) {
    if (new Set(names(r)).size !== r.entries.length) failures.push(`${label} report has duplicate operation names`);
  }
  const base = buildEntryMap(baseline);
  const cur = buildEntryMap(current);
  for (const name of base.keys()) if (!cur.has(name)) failures.push(`${name}: operation removed from current report`);
  for (const name of cur.keys()) if (!base.has(name)) failures.push(`${name}: operation added in current report`);
  for (const [name, b] of base) {
    const c = cur.get(name);
    if (!c) continue;
    for (const field of EXACT_FIELDS) {
      if (b[field] !== c[field]) failures.push(`${name}: ${field} ${b[field]} -> ${c[field]}`);
    }
  }
  for (const field of ['totalOperations', 'operationsWithData', 'allWithinLimits'] as const) {
    if (baseline.summary?.[field] !== current.summary?.[field]) {
      failures.push(`summary.${field} ${baseline.summary?.[field]} -> ${current.summary?.[field]}`);
    }
  }
  if (!baseline.entries.some(e => e.txCount > 0)) failures.push('baseline report has no operations with gas data');
  return failures;
}

console.log('Gas Comparison Tool');
console.log(`Mode: ${mode}`);
if (mode === 'limits') {
  console.log(`Current report: ${currentPath}`);
  const report = loadJson<GasReport>(currentPath);
  if (!report) {
    console.error('Failed to load current gas report.');
    process.exit(2);
  }
  const failures = checkLimits(report);
  if (expectedOpsPath) failures.push(...checkExpectedOps(report, loadExpectedOps(expectedOpsPath)));
  const tracked = report.entries.filter(e => e.txCount > 0).length;
  console.log(`Operations with data: ${tracked}`);
  if (failures.length > 0) {
    console.error(`GAS LIMITS FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log('All tracked operations within MAX_GAS_PER_GROUP limits.' +
    (expectedOpsPath ? ` Operation set equals ${expectedOpsPath}.` : ''));
  process.exit(0);
}
if (mode === 'exact') {
  console.log(`Baseline report: ${baselinePath}`);
  console.log(`Current report: ${currentPath}`);
  const baseline = loadJson<GasReport>(baselinePath);
  const current = loadJson<GasReport>(currentPath);
  if (!baseline || !current || !Array.isArray(baseline.entries) || !Array.isArray(current.entries)) {
    console.error('Failed to load baseline/current gas report.');
    process.exit(2);
  }
  const failures = checkExact(baseline, current);
  if (expectedOpsPath) failures.push(...checkExpectedOps(current, loadExpectedOps(expectedOpsPath)));
  const tracked = current.entries.filter(e => e.txCount > 0);
  if (failures.length > 0) {
    console.error(`GAS EXACT FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(
    `GAS EXACT PASSED: entries=${current.entries.length} withData=${tracked.length} ` +
    `txCount=${tracked.reduce((n, e) => n + e.txCount, 0)} (timestamp/commit/branch ignored)`
  );
  process.exit(0);
}
console.log(`Baseline report: ${baselinePath}`);
console.log(`Current report: ${currentPath}`);
console.log(`Labels: ${baselineLabel} -> ${currentLabel}`);

const baselineReport = loadJson<GasReport>(baselinePath);
if (!baselineReport) {
  console.error('Failed to load baseline gas report.');
  process.exit(2);
}

const currentReport = loadJson<GasReport>(currentPath);
if (!currentReport) {
  console.error('Failed to load current gas report. Run tests with SSV_REPORT_GAS=true first.');
  process.exit(2);
}

const results = compare(baselineReport, currentReport);
const output = printResults(results);

const resolvedOutputPath = path.isAbsolute(outputPath)
  ? outputPath
  : path.join(process.cwd(), outputPath);
fs.writeFileSync(resolvedOutputPath, output, 'utf8');
console.log(`Gas comparison report saved to: ${resolvedOutputPath}`);

if (mode === 'enforce') {
  const comparable = results.filter(r => r.difference !== null);
  const regressions = comparable.filter(r => (r.difference ?? 0) > 0);
  const missingCurrent = results.filter(r => r.baseline !== null && r.current === null);
  if (comparable.length === 0 || regressions.length > 0 || missingCurrent.length > 0) {
    console.error(
      `GAS ENFORCE FAILED: compared=${comparable.length} regressions=${regressions.length} ` +
      `missingCurrent=${missingCurrent.length}`
    );
    for (const r of regressions) console.error(`  regression ${r.name}: ${r.baseline} -> ${r.current}`);
    for (const r of missingCurrent) console.error(`  missing current ${r.name}`);
    process.exit(1);
  }
  console.log(`GAS ENFORCE PASSED: compared=${comparable.length} regressions=0 missingCurrent=0`);
}
process.exit(0);
