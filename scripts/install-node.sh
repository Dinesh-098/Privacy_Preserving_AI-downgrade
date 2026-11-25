#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64 ;;
  Darwin-x86_64) platform=darwin-x64 ;;
  Linux-aarch64) platform=linux-arm64 ;;
  Linux-x86_64) platform=linux-x64 ;;
  *) printf '%s\n' 'Install Node.js 24 for this platform, then rerun setup.' >&2; exit 1 ;;
esac
if [[ -x .tooling/node/bin/node ]]; then
  exit 0
fi
mkdir -p .tooling
stage="$(mktemp -d "$PWD/.tooling/node-download.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
release='https://nodejs.org/dist/latest-v24.x'
curl -fLsS --retry 2 --max-time 60 "$release/SHASUMS256.txt" -o "$stage/SHASUMS256.txt"
checksum="$(awk -v platform="$platform" '$2 ~ ("^node-v[0-9.]+-" platform "\\.tar\\.gz$") {print $0}' "$stage/SHASUMS256.txt")"
archive="$(awk '{print $2}' <<<"$checksum")"
[[ -n "$archive" ]]
curl -fLsS --retry 2 --max-time 180 "$release/$archive" -o "$stage/$archive"
(cd "$stage" && printf '%s\n' "$checksum" | shasum -a 256 -c -)
mkdir "$stage/node"
tar -xf "$stage/$archive" -C "$stage/node" --strip-components=1
mv "$stage/node" .tooling/node
.tooling/node/bin/node --version
