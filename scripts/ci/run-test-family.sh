#!/usr/bin/env bash
# Run one test family with the installed Hardhat, failing closed when the family cannot be resolved.
#
#   scripts/ci/run-test-family.sh <unit|integration|e2e|sanity|fork|fork-legacy|local> [hardhat test args...]
#
# `npx hardhat test mocha $(test-family-files.sh X)` discards the substitution's exit status, so an
# empty or unknown family ran every test. Here the list is resolved and validated first; any failure
# exits nonzero before Hardhat starts.
set -euo pipefail
cd "$(dirname "$0")/../.."

[ $# -ge 1 ] || {
  echo "usage: $0 <family> [hardhat test args...]" >&2
  exit 2
}
family=$1
shift

listing=$(bash scripts/ci/test-family-files.sh "$family") || {
  status=$?
  echo "run-test-family: cannot resolve family '$family' (exit $status); no tests run" >&2
  exit "$status"
}
files=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || {
    echo "run-test-family: listed file missing: $f" >&2
    exit 1
  }
  files+=("$f")
done <<<"$listing"
[ "${#files[@]}" -gt 0 ] || {
  echo "run-test-family: family '$family' resolved to no files; no tests run" >&2
  exit 1
}

echo "run-test-family: $family files=${#files[@]}" >&2
exec npx --no-install hardhat test mocha "${files[@]}" "$@"
