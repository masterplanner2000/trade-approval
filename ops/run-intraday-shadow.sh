#!/bin/zsh
set -euo pipefail

project_dir="/Users/timmac2/.codex/.chatgpt-projects/g-p-6a8b606292bc81919b5ed254237ea6c6/trade-approval"
lock_dir="$project_dir/service/data/intraday-shadow.lock"

if ! mkdir "$lock_dir" 2>/dev/null; then
  print '{"ok":true,"skipped":true,"reason":"capture_already_running"}'
  exit 0
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

cd "$project_dir"
if [[ -f .env.local ]]; then
  set -a
  source .env.local
  set +a
fi

.venv-ibkr-10.49/bin/python service/intraday_shadow_capture.py capture
