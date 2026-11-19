#!/usr/bin/env bash
# Fail unless the Echidna job's tools on PATH are the pinned set from scripts/ci/fuzz-tools/:
# echidna 2.3.3, forge 1.8.5 (commit 51a52c59), slither 0.11.4, crytic-compile 0.3.11, and
# $FUZZ_SOLC = solc 0.8.24+commit.e11b9ed9. Prints the measured versions and resolved paths.
#
#   FUZZ_SOLC=<path> scripts/ci/check-fuzz-tools.sh
set -euo pipefail

status=0
fail() {
  echo "FAIL: $*" >&2
  status=1
}

# Exact match of one stdout line of "<cmd> --version"; a missing executable or nonzero exit fails.
expect_line() {
  local label=$1 want=$2 out
  shift 2
  if ! out=$("$@" --version); then
    fail "$label: '$*' --version failed"
    return
  fi
  printf '%s\n' "$out" | sed "s/^/$label: /"
  printf '%s\n' "$out" | grep -Fxq -- "$want" || fail "$label: expected line '$want'"
}

for tool in echidna forge slither crytic-compile; do
  if path=$(command -v "$tool"); then
    echo "path $tool=$path"
  else
    fail "$tool not on PATH"
  fi
done
if [ -z "${FUZZ_SOLC:-}" ] || [ ! -x "$FUZZ_SOLC" ]; then
  fail "FUZZ_SOLC is not an executable solc path: '${FUZZ_SOLC:-}'"
fi

expect_line echidna 'Echidna 2.3.3' echidna
expect_line forge 'forge Version: 1.8.5' forge
expect_line forge 'Commit SHA: 51a52c59cffd940f76eddd0b4bb1791aa4b5ac7f' forge
expect_line slither '0.11.4' slither
expect_line crytic-compile '0.3.11' crytic-compile
if [ -x "${FUZZ_SOLC:-}" ]; then
  if solc_out=$("$FUZZ_SOLC" --version); then
    printf '%s\n' "$solc_out" | sed 's/^/solc: /'
    printf '%s\n' "$solc_out" | grep -Eq '^Version: 0\.8\.24\+commit\.e11b9ed9\.' ||
      fail "solc: expected Version: 0.8.24+commit.e11b9ed9"
  else
    fail "solc: '$FUZZ_SOLC' --version failed"
  fi
fi
exit $status
