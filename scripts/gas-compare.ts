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

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--baseline' && args[i + 1]) {
    baselinePath = args[++i];
  } else if (args[i] === '--current' && args[i + 1]) {
    currentPath = args[++i];
  } else if (args[i] === '--baseline-label' && args[i + 1]) {
    baselineLabel = args[++i];
  } else if (args[i] === '--current-label' && args[i + 1]) {
    currentLabel = args[++i];
  } else if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[++i];
  }
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

console.log('Gas Comparison Tool');
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
process.exit(0);
