#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/timmac2/.codex/.chatgpt-projects/g-p-6a8b606292bc81919b5ed254237ea6c6/trade-approval"
cd "$PROJECT_DIR"
if [[ ! -f .env.local ]]; then
  print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) news stream failed: .env.local is missing"
  exit 1
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec /opt/homebrew/bin/node --env-file=.env.local service/run_news_stream.mjs
