#!/usr/bin/env npx tsx
// Count gate for a Mocha spec-reporter log (e.g. a fork run).
//
//   npx tsx scripts/ci/check-test-log.ts --log <file> --expected <file> [--max-pending N] [--min-passing N]
//   npx tsx scripts/ci/check-test-log.ts --log <file> --emit-titles   # print every parsed test path
//
// Fails (exit 1) when: no summary is found, parsed test lines disagree with the summary (truncated
// log), passing < min-passing (default 1), any test failed, pending > max-pending (default 0), an
// expected test path (one "suite > ... > test" per line) did not pass, or the passing tests are not
// exactly the expected list (extra or duplicated titles). The manifest is mandatory: a fork suite
// never passes on "nonzero passing" alone. Unknown options, repeated options and options without a
// value (or whose value is another --option) exit 2.
// Limitation: suite titles are recognized by indentation; unindented console output is ignored, and
// indented console output can be misread as a suite title (fails closed: expected paths go missing).
import * as fs from 'node:fs';

type Status = 'passing' | 'pending' | 'failing';
interface ParsedTest {
  path: string;
  status: Status;
}

const USAGE =
  'usage: check-test-log.ts --log <file> --expected <file> [--max-pending N] [--min-passing N] | --log <file> --emit-titles';
const usage = (why: string): never => {
  console.error(`${why}\n${USAGE}`);
  process.exit(2);
};
const VALUE_OPTIONS = new Set(['log', 'expected', 'max-pending', 'min-passing']);
const opts: Record<string, string> = {};
let emitTitles = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--emit-titles') {
    if (emitTitles) usage('repeated option --emit-titles');
    emitTitles = true;
    continue;
  }
  const name = a.startsWith('--') ? a.slice(2) : '';
  if (!VALUE_OPTIONS.has(name)) usage(`unknown argument: ${a}`);
  if (name in opts) usage(`repeated option ${a}`);
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--') || value.trim() === '') usage(`missing value for ${a}`);
  opts[name] = value;
  i++;
}
const nonNegativeInt = (name: string, fallback: string): number => {
  const raw = opts[name] ?? fallback;
  if (!/^\d+$/.test(raw)) usage(`--${name} must be a non-negative integer, got "${raw}"`);
  return Number(raw);
};
const logPath = opts['log'] ?? usage('missing --log');
const expectedPath = opts['expected'];
const maxPending = nonNegativeInt('max-pending', '0');
const minPassing = nonNegativeInt('min-passing', '1');
if (!emitTitles && !expectedPath) usage('missing --expected <manifest> (a count gate without a manifest is not accepted)');

// eslint-disable-next-line no-control-regex
const lines = fs.readFileSync(logPath, 'utf8').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/);

const tests: ParsedTest[] = [];
const summary: Partial<Record<Status, number>> = {};
const stack: { indent: number; title: string }[] = [];
let inSummary = false;

for (const line of lines) {
  const summaryMatch = line.match(/^\s+(\d+) (passing|pending|failing)\b/);
  if (summaryMatch) {
    summary[summaryMatch[2] as Status] = Number(summaryMatch[1]);
    inSummary = true;
    continue;
  }
  // Failure details after the summary repeat test titles; stop collecting.
  if (inSummary) continue;

  const m = line.match(/^( +)(✔|✓|-|\d+\)) (.*)$/);
  if (m) {
    const indent = m[1].length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const title = m[3].replace(/\s+\(\d+ms\)$/, '').trim();
    const status: Status = m[2] === '-' ? 'pending' : /^\d+\)$/.test(m[2]) ? 'failing' : 'passing';
    tests.push({ path: [...stack.map(s => s.title), title].join(' > '), status });
    continue;
  }

  const suite = line.match(/^( {2,})(\S.*)$/);
  if (suite && suite[1].length % 2 === 0) {
    const indent = suite[1].length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, title: suite[2].trim() });
  }
}

if (emitTitles) {
  for (const t of tests) console.log(t.path);
  process.exit(0);
}

const count = (s: Status) => tests.filter(t => t.status === s).length;
const failures: string[] = [];
const parsed = { passing: count('passing'), pending: count('pending'), failing: count('failing') };

if (summary.passing === undefined) failures.push('no "N passing" summary line found');
for (const s of ['passing', 'pending', 'failing'] as Status[]) {
  if ((summary[s] ?? 0) !== parsed[s]) {
    failures.push(`summary ${s}=${summary[s] ?? 0} but parsed ${parsed[s]} test lines (truncated or unparseable log)`);
  }
}
if (parsed.passing < minPassing) failures.push(`passing ${parsed.passing} < required ${minPassing}`);
if (parsed.failing > 0) failures.push(`${parsed.failing} failing`);
if (parsed.pending > maxPending) failures.push(`pending ${parsed.pending} > allowed ${maxPending}`);

let expectedCount = 0;
if (expectedPath) {
  const expected = fs.readFileSync(expectedPath, 'utf8').split(/\r?\n/).filter(l => l.trim().length > 0);
  expectedCount = expected.length;
  if (expected.length === 0) failures.push(`expected list ${expectedPath} is empty`);
  const passed = new Set(tests.filter(t => t.status === 'passing').map(t => t.path));
  const missing = expected.filter(e => !passed.has(e));
  if (missing.length > 0) {
    failures.push(`${missing.length} expected tests did not pass`);
    for (const m of missing.slice(0, 20)) failures.push(`  missing: ${m}`);
  }
  const expectedSet = new Set(expected);
  if (expectedSet.size !== expected.length) failures.push(`expected list ${expectedPath} has duplicate entries`);
  const unexpected = [...passed].filter(p => !expectedSet.has(p));
  if (unexpected.length > 0) {
    failures.push(`${unexpected.length} passing tests are not in ${expectedPath}`);
    for (const u of unexpected.slice(0, 20)) failures.push(`  unexpected: ${u}`);
  }
  if (parsed.passing !== passed.size) {
    failures.push(`${parsed.passing - passed.size} passing test paths are duplicated (ambiguous titles)`);
  }
}

console.log(
  `parsed passing=${parsed.passing} pending=${parsed.pending} failing=${parsed.failing}` +
  (expectedPath ? ` expected=${expectedCount}` : '')
);
if (failures.length > 0) {
  console.error('TEST LOG CHECK FAILED:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('TEST LOG CHECK PASSED');
