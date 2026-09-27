#!/usr/bin/env bash
# Start Comfy Studio. Usage: ./studio.sh [dev]   (default: production build on port 3100)
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/opt/node22/bin:$PATH"
PORT="${PORT:-3100}"

if [[ "${1:-}" == "dev" ]]; then
  exec npx next dev -p "$PORT"
fi
npx next build
exec npx next start -p "$PORT"
