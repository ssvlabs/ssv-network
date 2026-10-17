#!/usr/bin/env bash
# Deterministic recursive test-family discovery for local aliases and CI rows.
#
#   scripts/ci/test-family-files.sh <family>   print the family's files (sorted, one per line)
#   scripts/ci/test-family-files.sh --check    fail if any mocha file under test/ belongs to no
#                                               family, or to more than one
#
# Families:
#   unit, integration, e2e   every *.test.ts under test/<family>/, any depth
#   sanity                   every *.ts under test/sanity/ (includes effective-balance.ts)
#   fork                     canonical fork suite test/test-forked/**/*.test.ts (RUN_FORK-gated)
#   fork-legacy              older test/forked/**/*.test.ts, a separate regression row
#
# `local` = unit + integration + e2e + sanity, i.e. every non-fork test file.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/../.."

list() {
  case "$1" in
    unit | integration | e2e) find "test/$1" -type f -name '*.test.ts' | sort ;;
    sanity) find test/sanity -type f -name '*.ts' | sort ;;
    fork) find test/test-forked -type f -name '*.test.ts' | sort ;;
    fork-legacy) find test/forked -type f -name '*.test.ts' | sort ;;
    local) for f in unit integration e2e sanity; do list "$f"; done | sort ;;
    *)
      echo "unknown family: $1" >&2
      return 2
      ;;
  esac
}

if [ "${1:-}" = "--check" ]; then
  # Mocha files Hardhat would discover under test/: every *.ts outside support directories
  # and fork-suite config modules.
  all=$(find test -type f -name '*.ts' \
    -not -path 'test/helpers/*' -not -path 'test/common/*' -not -path 'test/setup/*' \
    -not -path 'test/echidna/*' -not -path 'test/solidity/*' \
    -not -path 'test/forked/*/config.ts' -not -path 'test/test-forked/*/config.ts' | sort)
  assigned=$(for f in unit integration e2e sanity fork fork-legacy; do list "$f"; done | sort)
  status=0
  dups=$(printf '%s\n' "$assigned" | uniq -d)
  if [ -n "$dups" ]; then
    echo "FAIL: files assigned to more than one family:" >&2
    printf '%s\n' "$dups" >&2
    status=1
  fi
  orphans=$(comm -23 <(printf '%s\n' "$all") <(printf '%s\n' "$assigned" | uniq))
  if [ -n "$orphans" ]; then
    echo "FAIL: test files outside every family:" >&2
    printf '%s\n' "$orphans" >&2
    status=1
  fi
  for f in unit integration e2e sanity fork fork-legacy; do
    n=$(list "$f" | grep -c . || true)
    echo "$f files=$n"
    if [ "$n" -eq 0 ]; then
      echo "FAIL: family $f is empty" >&2
      status=1
    fi
  done
  echo "discovered=$(printf '%s\n' "$all" | grep -c .) assigned=$(printf '%s\n' "$assigned" | grep -c .)"
  exit $status
fi

[ $# -eq 1 ] || {
  echo "usage: $0 <unit|integration|e2e|sanity|fork|fork-legacy|local> | --check" >&2
  exit 2
}
out=$(list "$1")
[ -n "$out" ] || {
  echo "family $1 has no files" >&2
  exit 1
}
printf '%s\n' "$out"
