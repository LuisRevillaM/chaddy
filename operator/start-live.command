#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if ! bash "$SCRIPT_DIR/selfcheck.command" >/dev/null; then
  echo "start-live: selfcheck failed; refusing to run."
  exit 1
fi

CONFIG_PATH="${LIVE_CONFIG_PATH:-"$REPO_ROOT/config/live.json"}"
OUT_PATH="${LIVE_STATUS_PATH:-"$REPO_ROOT/artifacts/live/latest.json"}"
LOG_PATH="${LIVE_LOG_PATH:-"$REPO_ROOT/artifacts/live/live.log"}"
PID_PATH="${LIVE_PID_PATH:-"$REPO_ROOT/artifacts/live/pid.txt"}"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "start-live: missing config file: ${CONFIG_PATH}"
  echo "start-live: set LIVE_CONFIG_PATH to a JSON config path."
  exit 1
fi

mkdir -p "$(dirname "$OUT_PATH")"
mkdir -p "$(dirname "$LOG_PATH")"

(
  nohup node "$REPO_ROOT/scripts/run-live.mjs" --config "$CONFIG_PATH" --out "$OUT_PATH" >"$LOG_PATH" 2>&1 &
  echo $! >"$PID_PATH"
)

echo "start-live: pid $(cat "$PID_PATH")"
echo "start-live: log ${LOG_PATH}"
echo "start-live: status ${OUT_PATH}"

