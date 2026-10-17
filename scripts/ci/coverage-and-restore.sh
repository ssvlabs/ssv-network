#!/usr/bin/env bash
# Coverage run that cannot leak its instrumented build into later rows (CP1-F3).
#
#   scripts/ci/coverage-and-restore.sh <fingerprint-dir>
#
# Hardhat 3 `--coverage` writes an instrumented build (different optimizer runs, extra sources) into
# the shared artifacts/. This script fingerprints the normal build, runs coverage, recompiles with
# --force, and fails unless the restored build fingerprint matches the pre-coverage one exactly.
set -uo pipefail
cd "$(dirname "$0")/../.."
out="${1:?usage: $0 <fingerprint-dir>}"
mkdir -p "$out"

npx --no-install hardhat compile --force || exit 1
node scripts/ci/build-fingerprint.mjs . "$out/fp-normal.tsv" || exit 1

COVERAGE=true NO_GAS_ENFORCE=1 npx --no-install hardhat test mocha --coverage
coverage_rc=$?
node scripts/ci/build-fingerprint.mjs . "$out/fp-instrumented.tsv" || true

npx --no-install hardhat compile --force || exit 1
node scripts/ci/build-fingerprint.mjs . "$out/fp-restored.tsv" || exit 1

if ! cmp -s "$out/fp-normal.tsv" "$out/fp-restored.tsv"; then
  echo "FAIL: restored build fingerprint differs from the pre-coverage build" >&2
  diff "$out/fp-normal.tsv" "$out/fp-restored.tsv" | head -20 >&2
  exit 1
fi
echo "coverage exit=$coverage_rc; normal build restored and fingerprint re-matched"
exit $coverage_rc
