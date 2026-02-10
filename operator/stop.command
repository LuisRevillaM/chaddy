#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PID_PATH="${LIVE_PID_PATH:-"$REPO_ROOT/artifacts/live/pid.txt"}"

if [[ ! -f "$PID_PATH" ]]; then
  echo "stop: missing pid file: ${PID_PATH}"
  exit 1
fi

PID="$(cat "$PID_PATH" | tr -d "[:space:]")"
if [[ -z "$PID" ]]; then
  echo "stop: empty pid file: ${PID_PATH}"
  exit 1
fi

if kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" >/dev/null 2>&1 || true
  echo "stop: sent SIGTERM to ${PID}"
else
  echo "stop: process not running: ${PID}"
fi

rm -f "$PID_PATH"
exit 0

