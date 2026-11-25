#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export UV_PYTHON_INSTALL_DIR="$PWD/.tooling/python"
export UV_CACHE_DIR="$PWD/.tooling/uv-cache"
if command -v uv >/dev/null; then
  uv sync --locked --python 3.12
else
  if [[ ! -d .tooling/bootstrap/uv ]]; then
    python3 -m pip --disable-pip-version-check install --no-cache-dir --target .tooling/bootstrap 'uv>=0.9,<1'
  fi
  PYTHONPATH="$PWD/.tooling/bootstrap" python3 -m uv sync --locked --python 3.12
fi
if ! command -v node >/dev/null || [[ "$(node -p 'process.execPath')" == *ChatGPT.app* ]]; then
  ./scripts/install-node.sh
fi
if [[ -x .tooling/node/bin/node ]]; then
  export PATH="$PWD/.tooling/node/bin:$PATH"
fi
if ! command -v pnpm >/dev/null; then
  if [[ ! -x .tooling/pnpm/node_modules/.bin/pnpm ]]; then
    npm install --prefix .tooling/pnpm --no-package-lock --cache .tooling/npm-cache pnpm@11.25.0
  fi
  export PATH="$PWD/.tooling/pnpm/node_modules/.bin:$PATH"
fi
pnpm -C frontend install --frozen-lockfile --store-dir ../.pnpm-store
pnpm -C frontend build
