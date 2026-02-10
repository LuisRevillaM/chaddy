#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if ! bash "$SCRIPT_DIR/selfcheck.command" >/dev/null; then
  echo "start-paper: selfcheck failed; refusing to run."
  exit 1
fi

MODE="live"
if [[ "${PROVE_NO_NETWORK:-}" == "1" ]]; then
  MODE="fixture"
fi

OUT_PATH="${PAPER_LIVE_STATUS_PATH:-"$REPO_ROOT/artifacts/paper-live/latest.json"}"
mkdir -p "$(dirname "$OUT_PATH")"

if [[ "$MODE" == "fixture" ]]; then
  FIXTURE_PATH="${PAPER_LIVE_FIXTURE_PATH:-"$REPO_ROOT/tests/replay/fixtures/polymarket-market-channel.jsonl"}"
  STEPS="${PAPER_LIVE_STEPS:-2}"
  STEP_MS="${PAPER_LIVE_STEP_MS:-1000}"

  if [[ ! -f "$FIXTURE_PATH" ]]; then
    echo "start-paper: missing fixture file: ${FIXTURE_PATH}"
    exit 1
  fi

  node "$REPO_ROOT/scripts/run-paper-live.mjs" \
    --mode fixture \
    --steps "$STEPS" \
    --step-ms "$STEP_MS" \
    --market-fixture "$FIXTURE_PATH" \
    --out "$OUT_PATH"

  echo "start-paper: wrote ${OUT_PATH}"
  exit 0
fi

# Live mode requires explicit configuration (safe-by-default).
# Prefer environment variables (double-click friendly), but allow CLI args for power users.
EXTRA_ARGS=()
if [[ -n "${PAPER_LIVE_ASSET_ID:-}" ]]; then
  EXTRA_ARGS+=(--asset-id "$PAPER_LIVE_ASSET_ID")
fi
if [[ -n "${PAPER_LIVE_GAMMA_SLUG:-}" ]]; then
  EXTRA_ARGS+=(--gamma-slug "$PAPER_LIVE_GAMMA_SLUG")
fi
if [[ -n "${PAPER_LIVE_TOKEN_INDEX:-}" ]]; then
  EXTRA_ARGS+=(--token-index "$PAPER_LIVE_TOKEN_INDEX")
fi

if [[ -z "${PAPER_LIVE_ASSET_ID:-}" && -z "${PAPER_LIVE_GAMMA_SLUG:-}" ]]; then
  HAS_ASSET_ID=0
  HAS_GAMMA_SLUG=0
  for a in "$@"; do
    if [[ "$a" == "--asset-id" ]]; then HAS_ASSET_ID=1; fi
    if [[ "$a" == "--gamma-slug" ]]; then HAS_GAMMA_SLUG=1; fi
  done
  if (( HAS_ASSET_ID == 0 && HAS_GAMMA_SLUG == 0 )); then
    echo "start-paper: missing live configuration."
    echo "start-paper: set PAPER_LIVE_ASSET_ID or PAPER_LIVE_GAMMA_SLUG, or pass --asset-id/--gamma-slug."
    exit 1
  fi
fi

node "$REPO_ROOT/scripts/run-paper-live.mjs" --mode live --out "$OUT_PATH" "${EXTRA_ARGS[@]}" "$@"

