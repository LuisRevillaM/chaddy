#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

OUT_PATH="${OPERATOR_DOCTOR_OUT:-"$REPO_ROOT/artifacts/operator/doctor.json"}"

ARGS=(--out "$OUT_PATH")
if [[ "${OPERATOR_DOCTOR_BUNDLE:-0}" == "1" ]]; then
  ARGS+=(--bundle)
fi

node "$REPO_ROOT/scripts/run-operator-doctor.mjs" "${ARGS[@]}" "$@"

