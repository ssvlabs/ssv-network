#!/usr/bin/env npx tsx
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAllMaxGasLimits } from '../test/helpers/gas-usage.ts';

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
  limit: number;
  current: number;
  difference: number;
  percentChange: number;
  status: 'ok' | 'exceeded';
}

const args = process.argv.slice(2);
let reportPath = 'gas-report.json';
let threshold = Number(process.env.GAS_THRESHOLD) || 3;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--report' && args[i + 1]) {
    reportPath = args[++i];
  } else if (args[i] === '--threshold' && args[i + 1]) {
    threshold = Number(args[++i]);
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

function compare(report: GasReport, limits: Record<string, number>): ComparisonResult[] {
  const results: ComparisonResult[] = [];

  for (const entry of report.entries.filter(e => e.txCount > 0 && e.average !== null)) {
    const limitValue = limits[entry.name];
    const currentValue = entry.average!;

    if (limitValue === undefined) continue;

    const difference = currentValue - limitValue;
    const percentChange = limitValue > 0 ? (difference / limitValue) * 100 : 0;

    results.push({
      name: entry.name,
      limit: limitValue,
      current: currentValue,
      difference,
      percentChange,
      status: currentValue > limitValue ? 'exceeded' : 'ok',
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function printResults(results: ComparisonResult[]): boolean {
  console.log('\n');
  console.log('='.repeat(100));
  console.log('                           GAS COMPARISON REPORT');
  console.log('='.repeat(100));
  console.log(`Threshold: ${threshold}%`);
  console.log('-'.repeat(100));

  console.log(
    padRight('Operation', 50) +
    padLeft('Limit', 12) +
    padLeft('Current', 12) +
    padLeft('Diff', 12) +
    padLeft('Change', 12)
  );
  console.log('-'.repeat(100));

  let hasExceeded = false;

  for (const result of results) {
    if (result.status === 'exceeded') hasExceeded = true;

    const changeStr = result.percentChange >= 0
      ? `+${result.percentChange.toFixed(2)}%`
      : `${result.percentChange.toFixed(2)}%`;

    console.log(
      padRight(result.name, 50) +
      padLeft(result.limit.toLocaleString(), 12) +
      padLeft(result.current.toLocaleString(), 12) +
      padLeft((result.difference >= 0 ? '+' : '') + result.difference.toLocaleString(), 12) +
      padLeft(changeStr, 12)
    );
  }

  console.log('-'.repeat(100));

  const exceeded = results.filter(r => r.status === 'exceeded');
  const withinLimits = results.filter(r => r.status === 'ok');

  console.log(`\nSummary:`);
  console.log(`  Exceeded limits: ${exceeded.length}`);
  console.log(`  Within limits: ${withinLimits.length}`);
  console.log('='.repeat(100));

  if (hasExceeded) {
    console.log('\nEXCEEDED LIMITS:');
    for (const r of exceeded) {
      console.log(`  - ${r.name}: ${r.limit.toLocaleString()} limit, ${r.current.toLocaleString()} actual (+${r.percentChange.toFixed(2)}%)`);
    }
  }

  console.log('\n');

  return !hasExceeded;
}

console.log('Gas Comparison Tool');
console.log(`Report: ${reportPath}`);
console.log(`Using MAX_GAS_PER_GROUP limits from gas-usage.ts`);

const report = loadJson<GasReport>(reportPath);
if (!report) {
  console.error('Failed to load gas report. Run tests with REPORT_GAS=true first.');
  process.exit(2);
}

const limits = getAllMaxGasLimits();
const results = compare(report, limits);
const success = printResults(results);

if (!success) {
  console.log('Gas limits exceeded! Exiting with code 1.');
  process.exit(1);
}

console.log('All operations within gas limits.');
process.exit(0);
