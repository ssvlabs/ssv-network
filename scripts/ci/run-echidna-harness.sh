#!/usr/bin/env bash
# Run one Echidna harness at the CI config (test/echidna/echidna-ci.yaml, unchanged) with the
# pinned native tools: forge builds the harness closure with the pinned $FUZZ_SOLC (no svm or
# auto_detect_solc download), then Echidna/crytic-compile reuse that build-info. Echidna's output
# goes to <corpus-dir>/echidna-output.txt. Fails on a forge/Echidna error, and also when Echidna's
# Slither guidance step did not complete: "Running slither failed" is a hard failure, not a warning.
#
#   FUZZ_SOLC=<path> scripts/ci/run-echidna-harness.sh <Harness> <seed> <corpus-dir>
set -euo pipefail

[ $# -eq 3 ] || { echo "usage: $0 <Harness> <seed> <corpus-dir>" >&2; exit 2; }
contract=$1 seed=$2 corpus=$3
file="test/echidna/$contract.sol"
mkdir -p "$corpus"
corpus="$(cd "$corpus" && pwd)"
cd "$(dirname "$0")/../.."
test -f "$file" || { echo "FAIL: no harness $file" >&2; exit 1; }
test -x "${FUZZ_SOLC:-}" || { echo "FAIL: FUZZ_SOLC is not an executable solc" >&2; exit 1; }
output="$corpus/echidna-output.txt"

# Same targeted build crytic-compile 0.3.11 runs for a file target (forge build --build-info <file>),
# but with the pinned compiler and offline so forge cannot fetch one.
forge clean
forge build --build-info --offline --use "$FUZZ_SOLC" "$file"

echidna "$file" \
  --contract "$contract" \
  --config test/echidna/echidna-ci.yaml \
  --crytic-args "--compile-force-framework foundry --foundry-ignore-compile" \
  --test-mode property \
  --corpus-dir "$corpus" \
  --seed "$seed" \
  --format text 2>&1 | tee "$output"

if grep -Fq 'Running slither failed' "$output"; then
  echo "FAIL: Echidna's Slither guidance step failed for $contract (see $output)" >&2
  exit 1
fi
grep -Eq 'Running slither on .*Done!' "$output" || {
  echo "FAIL: no completed Slither guidance step in $output" >&2
  exit 1
}
