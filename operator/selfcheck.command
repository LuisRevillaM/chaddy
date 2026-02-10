#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUT_PATH="${OPERATOR_SELF_CHECK_OUT:-"$REPO_ROOT/artifacts/operator/selfcheck.json"}"

NODE_PRESENT=0
NODE_VERSION=""
NODE_MAJOR=""
REASONS=()

if command -v node >/dev/null 2>&1; then
  NODE_PRESENT=1
  NODE_VERSION="$(node -v 2>/dev/null || true)"
  NODE_MAJOR="$(echo "$NODE_VERSION" | sed -E 's/^v([0-9]+).*/\1/' 2>/dev/null || true)"
  if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]]; then
    REASONS+=("node_version_parse_failed")
  elif (( NODE_MAJOR < 20 )); then
    REASONS+=("node_too_old")
  fi
else
  REASONS+=("node_missing")
fi

HAS_PACKAGE_JSON=0
HAS_SCRIPTS_PROVE=0
if [[ -f "$REPO_ROOT/package.json" ]]; then HAS_PACKAGE_JSON=1; else REASONS+=("repo_missing_package_json"); fi
if [[ -f "$REPO_ROOT/scripts/prove.mjs" ]]; then HAS_SCRIPTS_PROVE=1; else REASONS+=("repo_missing_scripts_prove"); fi

OK=1
if (( ${#REASONS[@]} > 0 )); then OK=0; fi

mkdir -p "$(dirname "$OUT_PATH")"
RAN_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")"

{
  printf '{\n'
  if (( OK == 1 )); then
    printf '  "ok": true,\n'
  else
    printf '  "ok": false,\n'
  fi
  printf '  "repoRoot": "%s",\n' "$REPO_ROOT"
  printf '  "node": {\n'
  if (( NODE_PRESENT == 1 )); then
    printf '    "present": true,\n'
    printf '    "version": "%s",\n' "$NODE_VERSION"
    if [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]]; then
      printf '    "major": %s,\n' "$NODE_MAJOR"
    else
      printf '    "major": null,\n'
    fi
  else
    printf '    "present": false,\n'
    printf '    "version": null,\n'
    printf '    "major": null,\n'
  fi
  printf '    "requiredMajor": 20\n'
  printf '  },\n'
  printf '  "checks": {\n'
  if (( HAS_PACKAGE_JSON == 1 )); then printf '    "packageJson": true,\n'; else printf '    "packageJson": false,\n'; fi
  if (( HAS_SCRIPTS_PROVE == 1 )); then printf '    "scriptsProve": true\n'; else printf '    "scriptsProve": false\n'; fi
  printf '  },\n'
  printf '  "reasons": ['
  for i in "${!REASONS[@]}"; do
    if (( i > 0 )); then printf ', '; fi
    printf '"%s"' "${REASONS[$i]}"
  done
  printf '],\n'
  printf '  "ranAt": "%s"\n' "$RAN_AT"
  printf '}\n'
} >"$OUT_PATH"

echo "selfcheck: wrote ${OUT_PATH}"
if (( OK == 1 )); then
  echo "selfcheck: OK (node ${NODE_VERSION})"
  exit 0
fi

echo "selfcheck: FAIL (${REASONS[*]})"
exit 1

