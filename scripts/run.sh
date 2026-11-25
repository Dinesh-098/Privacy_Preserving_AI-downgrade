#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python ]]; then
  printf '%s\n' 'The project environment is missing. Run ./scripts/setup.sh first.' >&2
  exit 1
fi
page="frontend/dist/index.html"
if [[ ! -f "$page" || frontend/index.html -nt "$page" || frontend/vite.config.ts -nt "$page" ||
      -n "$(find frontend/src frontend/public -type f -newer "$page" -print -quit)" ]]; then
  export PATH="$PWD/.tooling/node/bin:$PATH"
  npm --prefix frontend run build
fi
PRIVFORENSICS_PROJECT="$PWD"
export PYTHONPATH="$PRIVFORENSICS_PROJECT/backend:$PRIVFORENSICS_PROJECT"
exec .venv/bin/python -m privforensics "$@"
