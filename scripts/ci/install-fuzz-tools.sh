#!/usr/bin/env bash
# Install the native Echidna CI toolchain into <dest> on a Linux x86_64 runner (CP2A-F1): the exact
# release artifacts in scripts/ci/fuzz-tools/tools.lock, each checked against its sha256 before use,
# and a Python venv with the hash-locked Slither/crytic-compile closure. Nothing is resolved at
# "latest" and nothing is installed globally. On GitHub Actions the bin/venv directories are added to
# $GITHUB_PATH and FUZZ_SOLC to $GITHUB_ENV. Any download, digest, platform, venv or pip failure exits
# nonzero; the result is then checked with scripts/ci/check-fuzz-tools.sh.
#
#   scripts/ci/install-fuzz-tools.sh <dest>
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: $0 <dest>" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"
lock="${FUZZ_TOOLS_LOCK:-$here/fuzz-tools/tools.lock}"
requirements="${FUZZ_TOOLS_REQUIREMENTS:-$here/fuzz-tools/requirements-slither.txt}"
python="${FUZZ_TOOLS_PYTHON:-python3}"
mkdir -p "$1"
dest="$(cd "$1" && pwd)"

platform="$(uname -s) $(uname -m)"
if [ "$platform" != "Linux x86_64" ]; then
  echo "FAIL: pinned artifacts are for Linux x86_64, host is '$platform'" >&2
  exit 1
fi

sha256() {
  if command -v sha256sum > /dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

if [ -n "$(ls -A "$dest")" ]; then
  echo "FAIL: $dest must be empty" >&2
  exit 1
fi
mkdir "$dest/dl" "$dest/bin"
seen=""
while IFS=$'\t' read -r name version digest url; do
  case "$name" in '' | '#'*) continue ;; esac
  file="$dest/dl/${url##*/}"
  echo "fetch $name $version $url"
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$file" "$url"
  got=$(sha256 "$file")
  if [ "$got" != "$digest" ]; then
    echo "FAIL: $name sha256 $got != pinned $digest" >&2
    exit 1
  fi
  echo "sha256 OK $name $got"
  case "$name" in
    echidna) tar -xzf "$file" -C "$dest/bin" echidna ;;
    foundry) tar -xzf "$file" -C "$dest/bin" forge ;;
    solc) install -m 0755 "$file" "$dest/bin/solc-$version" ;;
    *) echo "FAIL: unknown tool '$name' in $lock" >&2; exit 1 ;;
  esac
  seen="$seen $name"
done < "$lock"
if [ "$seen" != " echidna foundry solc" ]; then
  echo "FAIL: $lock must list exactly echidna, foundry, solc (got:$seen)" >&2
  exit 1
fi

# crytic-compile 0.3.11 declares Requires-Python !=3.12.0; the lock holds cp312 wheels.
"$python" -c 'import sys; v = sys.version_info; sys.exit(0 if (v[:2] == (3, 12) and v[2] >= 1) else 1)' || {
  echo "FAIL: $python is $("$python" --version 2>&1); requirements-slither.txt needs CPython 3.12.1+" >&2
  exit 1
}
"$python" -m venv "$dest/venv"
"$dest/venv/bin/python" -m pip install --disable-pip-version-check --no-input --isolated \
  --require-hashes --no-deps --only-binary=:all: -r "$requirements"
"$dest/venv/bin/python" -m pip check

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$dest/venv/bin" >> "$GITHUB_PATH"
  echo "$dest/bin" >> "$GITHUB_PATH"
fi
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "FUZZ_SOLC=$dest/bin/solc-0.8.24" >> "$GITHUB_ENV"
fi
echo "installed into $dest"
