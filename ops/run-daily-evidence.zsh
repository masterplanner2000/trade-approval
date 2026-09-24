#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/timmac2/.codex/.chatgpt-projects/g-p-6a8b606292bc81919b5ed254237ea6c6/trade-approval"
LOCK_DIR="$PROJECT_DIR/service/data/daily-evidence.lock"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) daily evidence skipped: another run holds the lock"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

cd "$PROJECT_DIR"
if [[ ! -f .env.local ]]; then
  print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) daily evidence failed: .env.local is missing"
  exit 1
fi

set -a
source .env.local
set +a

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) daily evidence started"
/opt/homebrew/bin/npm run market:daily
/opt/homebrew/bin/npm run market:evidence:readiness
print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) daily evidence completed"
