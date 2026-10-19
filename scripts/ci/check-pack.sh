#!/usr/bin/env bash
# npm package content check (dry run only; never publishes).
#
#   scripts/ci/check-pack.sh [--from-json <npm-pack-json>] [--list-out <file>] [--expect-list <file>]
#
# Fails when any of the 12 published ABIs is missing, or when the package contains coordination
# docs (docs/maintenance), tests, mocks, upgrade initializers, deprecated sources, scripts, env files
# or build output. --expect-list additionally requires the exact sorted file list given.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/../.."

from_json="" list_out="" expect_list=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-json) from_json="$2"; shift 2 ;;
    --list-out) list_out="$2"; shift 2 ;;
    --expect-list) expect_list="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -n "$from_json" ]; then
  json=$(cat "$from_json")
else
  json=$(npm pack --dry-run --json --ignore-scripts 2>/dev/null)
fi

# npm 11 prints an array of packages, npm 12 an object keyed by package name.
files=$(printf '%s' "$json" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const parsed = JSON.parse(s);
    const pkgs = Array.isArray(parsed) ? parsed : Object.values(parsed);
    if (pkgs.length !== 1 || !Array.isArray(pkgs[0]?.files)) {
      console.error("unexpected npm pack --json output: expected exactly one package with a files list");
      process.exit(1);
    }
    for (const f of pkgs[0].files.map((x) => x.path).sort()) console.log(f);
  });')

status=0
for abi in CSSVToken ISSVStaking SSVClusters SSVDAO SSVNetwork SSVNetworkViews SSVOperators \
  SSVOperatorsWhitelist SSVStaking SSVToken SSVValidators SSVViews; do
  if ! printf '%s\n' "$files" | grep -qx "abis/$abi.json"; then
    echo "FAIL: missing abis/$abi.json" >&2
    status=1
  fi
done

forbidden=$(printf '%s\n' "$files" | grep -E \
  '^docs/maintenance/|(^|/)(test|tests|mocks|upgrades|deprecated)/|^scripts/|^\.github/|(^|/)\.env|^(artifacts|cache|coverage|types|node_modules)/' || true)
if [ -n "$forbidden" ]; then
  echo "FAIL: forbidden package entries:" >&2
  printf '%s\n' "$forbidden" >&2
  status=1
fi

if [ -n "$expect_list" ]; then
  if ! diff <(sort "$expect_list") <(printf '%s\n' "$files") >&2; then
    echo "FAIL: package file list differs from $expect_list (< expected, > actual)" >&2
    status=1
  fi
fi

[ -z "$list_out" ] || printf '%s\n' "$files" > "$list_out"
echo "entries=$(printf '%s\n' "$files" | grep -c .) abis=$(printf '%s\n' "$files" | grep -c '^abis/')"
[ $status -eq 0 ] && echo "PACK CHECK PASSED" || echo "PACK CHECK FAILED" >&2
exit $status
