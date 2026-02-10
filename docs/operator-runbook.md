# Operator Runbook (Argentina / Non-Blocked Locations)

This runbook is for a trusted operator who will run the bot from a location where Polymarket is **not geoblocked**. Do not attempt to bypass georestrictions.

## Operator Skill Level Assumption

This project is being built so a non-technical operator can run it.

Target operator experience (end state):

- download a zip (or clone once)
- double-click `Start (Paper)` or `Start (Live)`
- if something breaks, send back a single status file

This repo is still CLI-first, but the operator bundle now lives under `operator/` and includes clickable `.command` scripts.

## 0) Preconditions

- Node.js `>=20` (recommended: current LTS)
- Git
- A machine/network that can reach Polymarket endpoints

## 1) Confirm Geoblock Status (Required)

Run from the target machine:

```bash
curl -s https://polymarket.com/api/geoblock
```

Proceed only if it reports `blocked: false`.

## 2) Install + Verify (Always)

```bash
git clone <REPO_URL>
cd bot
npm ci
npm run prove
```

`npm run prove` must pass before running anything long-lived.

## 3) Run Modes

### A) Fixture mode (offline, always safe)

```bash
node scripts/run-shadow-live.mjs --mode fixture --out artifacts/shadow-live/fixture.json
```

This never connects to the network and never trades.

### B) Shadow-live (read-only, uses market WebSocket)

Pick a market slug and run:

```bash
node scripts/run-shadow-live.mjs \
  --mode live \
  --gamma-slug '<slug>' \
  --token-index 0 \
  --out artifacts/shadow-live/latest.json
```

Health check:

```bash
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("artifacts/shadow-live/latest.json","utf8"));const {ws:w,snapshot:s}=j;console.log({ready:w.readyState,msg:w.messageCount,ok:w.parsedOkCount,err:w.parsedErrorCount,books:w.bookEventCount,deltas:w.deltaEventCount,needsResync:s.orderbook.needsResync,bestBid:s.orderbook.bestBid,bestAsk:s.orderbook.bestAsk,mid:s.midpoint,kill:s.killSwitch});'
```

Expected "healthy-ish":

- `ready: 1`
- `books > 0`
- `bestBid/bestAsk` non-null
- `mid` non-null

If `books===0`, inspect:

- `ws.lastSubscribePayload`
- `ws.lastMessageSample`
- `ws.lastParsedErrorCode`

## 4) Secrets / Trading

This repo now includes a **tiny-live** trading runner (`scripts/run-live.mjs`), but it is still:

- operator-only (must not be run from blocked locations)
- safe-by-default (requires explicit allowlist + caps + price band)
- unproven on a real account until you run the opt-in integration suite

Do not add secrets to the repo and do not paste secrets into chat logs.

Rules:

- do not add secrets to the repo
- do not attempt to wire signing keys into `mm-core`
- when live trading is implemented, secrets must live only under `packages/executor/` at runtime

### Live-Mode Runtime Secrets (Operator Only)

The live runner and integration suite require runtime-only credentials via environment variables:

- `POLY_CLOB_AUTH_HEADERS_JSON`: JSON object of HTTP auth headers for Polymarket CLOB REST calls.
  - Example shape (keys are placeholders): `{"x-api-key":"...","x-api-passphrase":"...","x-api-secret":"..."}`
- `POLY_USER_WS_SUBSCRIBE_JSON` (optional but strongly recommended): JSON payload to subscribe to your user WebSocket channel so the bot can track your orders/fills.

If these are missing, `scripts/run-live.mjs` will refuse to start (or will be unable to track user state).

## 6) Funding / Live Readiness (Future Step)

When live trading is implemented, the operator will additionally need:

- a compliant Polymarket account they are allowed to operate
- a funded balance sufficient for tiny-caps testing
- an explicit allowlist + caps configuration (safe-by-default)

## 5) Process Management

For long-running shadow-live, use `nohup` or `systemd` and ensure the operator can:

- restart on crash
- check `artifacts/shadow-live/latest.json`
- rotate logs (do not log secrets)

## 7) Send Back A Single Debug Summary (Run Journal)

If you are running `paper-live` or `live`, you can write an append-only JSONL run journal and then generate a single compact summary JSON for debugging.

1) Run with a journal file:

```bash
node scripts/run-paper-live.mjs --mode fixture --journal artifacts/run.journal.jsonl --out artifacts/paper-live/latest.json
```

Live runner:

```bash
node scripts/run-live.mjs --config <path> --journal artifacts/run.journal.jsonl --out artifacts/live/latest.json
```

2) Generate a single summary file and send it back:

```bash
node scripts/analyze-run.mjs --journal artifacts/run.journal.jsonl --out artifacts/run-summary.json
```

Send back only `artifacts/run-summary.json` unless asked for more.

## 8) Opt-In Integration Checks (Operator Machine Only)

The integration suite is network-enabled and **opt-in**. Run it only from the operator machine after confirming geoblock is allowed.

```bash
INTEGRATION_ENABLED=1 npm run integration
```

If you want the live smoke to actually place/cancel an order (tiny), you must provide:

- `POLY_CLOB_AUTH_HEADERS_JSON`
- `POLY_CLOB_TOKEN_ID` (a real token/asset id)
- optional: `POLY_CLOB_PRICE`, `POLY_CLOB_SIZE`, `POLY_CLOB_SIDE`

If any integration check fails, send back:

- `artifacts/proofs/latest/logs/integration.log`
- `artifacts/proofs/latest/suite/integration/*.json`
