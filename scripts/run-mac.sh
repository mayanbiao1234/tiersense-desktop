#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != 'Darwin' ]]; then printf '请在 Mac 上运行此脚本。\n'; exit 1; fi
cd "$(dirname "$0")/.."
export TEMP="$PWD/.build-temp"
export TMP="$TEMP"
export TMPDIR="$TEMP"
export npm_config_cache="$PWD/.build-cache/npm"
export electron_config_cache="$PWD/.build-cache/electron"
export ELECTRON_CACHE="$electron_config_cache"
export ELECTRON_BUILDER_CACHE="$PWD/.build-cache/electron-builder"
unset ELECTRON_RUN_AS_NODE
mkdir -p "$TEMP" "$npm_config_cache" "$electron_config_cache" "$ELECTRON_BUILDER_CACHE"
printf 'TEMP=%s\nnpm=%s\nElectron=%s\nBuilder=%s\n' "$TEMP" "$npm_config_cache" "$electron_config_cache" "$ELECTRON_BUILDER_CACHE"
if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
npm run mac:dmg
