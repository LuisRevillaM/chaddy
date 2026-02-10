#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PAPER_PATH="${PAPER_LIVE_STATUS_PATH:-"$REPO_ROOT/artifacts/paper-live/latest.json"}"
SHADOW_PATH="$REPO_ROOT/artifacts/shadow-live/latest.json"
LIVE_PATH="${LIVE_STATUS_PATH:-"$REPO_ROOT/artifacts/live/latest.json"}"

STATUS_PATH=""
if [[ -f "$PAPER_PATH" ]]; then
  STATUS_PATH="$PAPER_PATH"
elif [[ -f "$LIVE_PATH" ]]; then
  STATUS_PATH="$LIVE_PATH"
elif [[ -f "$SHADOW_PATH" ]]; then
  STATUS_PATH="$SHADOW_PATH"
else
  echo "status: missing status JSON (expected ${LIVE_PATH} or ${PAPER_PATH} or ${SHADOW_PATH})"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "status: node is missing"
  exit 1
fi

node -e '
const fs = require("node:fs");
const p = process.argv[1];
let obj;
try {
  obj = JSON.parse(fs.readFileSync(p, "utf8"));
} catch (e) {
  console.error(`status: failed to read/parse ${p}: ${String(e && e.message || e)}`);
  process.exit(1);
}

function healthFromPaperFixture(o) {
  const final = o && o.result && o.result.final;
  if (!final || typeof final !== "object") return { ok: false, reason: "missing_result_final" };
  if (final.cancelAllTriggered) return { ok: false, reason: "cancel_all_triggered" };
  if (final.lastKillSwitchReason) return { ok: false, reason: `kill_switch:${final.lastKillSwitchReason}` };
  return { ok: true, reason: null };
}

function healthFromPaperLive(o) {
  const snap = o && o.snapshot;
  if (!snap || typeof snap !== "object") return { ok: false, reason: "missing_snapshot" };
  if (snap.cancelAllTriggered) return { ok: false, reason: "cancel_all_triggered" };
  if (snap.orderbook && snap.orderbook.needsResync) return { ok: false, reason: "orderbook_needs_resync" };
  return { ok: true, reason: null };
}

function healthFromLiveRunner(o) {
  if (!o || typeof o !== "object") return { ok: false, reason: "missing_obj" };
  if (o.ok !== true) return { ok: false, reason: "runner_not_ok" };
  const per = Array.isArray(o.perMarket) ? o.perMarket : null;
  if (!per || per.length === 0) return { ok: false, reason: "missing_perMarket" };
  for (const m of per) {
    if (!m || typeof m !== "object") continue;
    if (m.cancelAllTriggered) return { ok: false, reason: "cancel_all_triggered" };
    if (m.killSwitch && m.killSwitch.cancelAll) return { ok: false, reason: `kill_switch:${m.killSwitch.reason}` };
    if (m.orderbook && m.orderbook.needsResync) return { ok: false, reason: "orderbook_needs_resync" };
  }
  return { ok: true, reason: null };
}

let h = { ok: false, reason: "unknown_schema" };
if (obj && obj.runner === "live") h = healthFromLiveRunner(obj);
else if (obj && obj.mode === "fixture") h = healthFromPaperFixture(obj);
else if (obj && obj.mode === "live") h = healthFromPaperLive(obj);

const which = (obj && obj.runner === "live") ? "live-runner" : (obj && obj.mode) ? obj.mode : "unknown";
if (h.ok) {
  console.log(`status: OK (${which}) ${p}`);
  process.exit(0);
}
console.log(`status: FAIL (${which}) ${h.reason} ${p}`);
process.exit(1);
' "$STATUS_PATH"
