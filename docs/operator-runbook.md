# Operator Runbook (Argentina / Non-Blocked Locations)

This runbook is for a trusted operator who will run the bot from a location where Polymarket is **not geoblocked**. Do not attempt to bypass georestrictions.

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

Real trading is intentionally **not enabled** yet in this scaffold:

- do not add secrets to the repo
- do not attempt to wire signing keys into `mm-core`
- when live trading is implemented, secrets must live only under `packages/executor/` at runtime

## 5) Process Management

For long-running shadow-live, use `nohup` or `systemd` and ensure the operator can:

- restart on crash
- check `artifacts/shadow-live/latest.json`
- rotate logs (do not log secrets)

