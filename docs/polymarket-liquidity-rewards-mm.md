I'm going to pick **Liquidity Rewards-driven market making** as the "best opportunity to build" for most teams right now, because it's the one place you can stack a *repeatable, explicit subsidy* on top of spread capture--without needing to win a pure-latency arms race.

Before we talk architecture: **Polymarket enforces geographic restrictions**; orders from blocked regions are rejected, and they explicitly tell builders to implement geoblock checks. ([Polymarket Documentation][1])
(I can help you build a compliant system; I can't help with bypassing restrictions.)

---

## What we're building

A **24/7 always-on market-making service** that:

1. Finds reward-eligible markets (Gamma API)
2. Subscribes to live order books (CLOB WebSocket market channel)
3. Continuously posts/updates limit orders (CLOB REST trading endpoints)
4. Tracks fills & inventory (CLOB WebSocket user channel + Data API)
5. Keeps orders inside reward constraints (max spread, min size) and verifies scoring

Polymarket's docs frame market making exactly this way: interact via CLOB, use WebSocket feeds for low latency, and manage outcome-token inventory. ([Polymarket Documentation][2])

---

## Key point about "open CLOB instance"

There is **no** "open CLOB instance" you run locally that Polymarket matches against. Polymarket runs the operator + endpoints, and you run **clients** that connect to them. They provide open-source SDKs (TypeScript/Python/Rust) to make signing/auth and order management easier. ([Polymarket Documentation][3])

So yes: **something is running**--it's your bot(s) + your infra, connected to Polymarket's hosted CLOB.

---

## How your system communicates with Polymarket

### The three REST APIs + WebSockets you'll use

Polymarket documents these base URLs (this is basically your integration map): ([Polymarket Documentation][4])

* **Gamma API** (`https://gamma-api.polymarket.com`)
  Market discovery + metadata (events, markets, token IDs, tags, etc.) ([Polymarket Documentation][5])
* **CLOB API** (`https://clob.polymarket.com`)
  Orderbooks, prices, and **trading** (place/cancel orders). ([Polymarket Documentation][3])
* **Data API** (`https://data-api.polymarket.com`)
  Positions, activity, trade history. ([Polymarket Documentation][4])
* **CLOB WebSocket** (`wss://ws-subscriptions-clob.polymarket.com/ws/`)
  Live orderbook updates + your user order/trade updates. ([Polymarket Documentation][4])

(Optionally) **RTDS WebSocket** (`wss://ws-live-data.polymarket.com`) for ultra-low-latency crypto price feeds/comments, but it's not required for the baseline rewards/MM bot. ([Polymarket Documentation][6])

---

## Authentication model (this matters for architecture)

Polymarket's CLOB uses **two authentication levels**: ([Polymarket Documentation][7])

* **L1 (Private key / wallet signing)**: used to prove wallet ownership and **derive API creds** (EIP-712 signed)
* **L2 (API key + secret + passphrase)**: used to authenticate requests to **trading endpoints** (place/cancel/orders/trades, etc.)

This is why most serious bots isolate "signing + trading" from everything else (more below).

Also, order signing is non-trivial; Polymarket explicitly recommends using their client libraries (TS/Python/Golang). ([Polymarket Documentation][8])

---

## Liquidity Rewards constraints you must design around

From the user-facing docs: to qualify, orders must be within the market's **max spread** around midpoint; and there are cases where you need **both sides** to qualify (e.g., midpoint below $0.10). ([Polymarket Documentation][9])

From the MM-facing docs: the scoring system is quadratic-ish in "closeness" to midpoint and favors tighter quotes with size, plus two-sided behavior. ([Polymarket Documentation][10])

**Super practical tool:** there's a CLOB endpoint to check whether an order is "scoring" for rewards (and a batch version). That's gold for debugging/ops. ([Polymarket Documentation][11])

---

## The architecture I'd build (and why)

### Design goal

Keep the **latency-critical quoting loop deterministic and robust**, and put "AI / agentic stuff" in a slower, safer control plane.

### High-level diagram

```mermaid
flowchart LR
  subgraph ControlPlane["Control Plane (slow, agent-friendly)"]
    MS[Market Scanner\n(Gamma API)] --> SEL[Market Selector\n(rewards/competition heuristics)]
    SEL --> CFG[Strategy Config\n(spreads, size, inventory targets)]
    OBS[Logs/Metrics] --> AI[AI Ops Agent\n(summarize, diagnose, suggest params)]
    AI --> CFG
  end

  subgraph DataPlane["Data Plane (hot path, deterministic)"]
    WS[Mkt Data Ingestor\n(CLOB WS market)] --> OB[Orderbook State]
    UWS[User Ingestor\n(CLOB WS user)] --> POS[Positions/Inventory State]
    OB --> SE[Strategy Engine\n(fair, quotes, skew)]
    POS --> SE
    SE --> OM[Order Manager\n(diff desired vs live)]
    OM --> EX[Execution/Signer Service\n(CLOB REST)]
    EX --> PM[(Polymarket CLOB)]
    OM --> SC[Scoring Checker\n(/order-scoring)]
  end

  subgraph Storage["Storage/Monitoring"]
    DB[(Postgres/SQLite)]
    MET[(Prometheus/Grafana)]
  end

  OM --> DB
  UWS --> DB
  OBS --> MET
```

---

## Components and "required infrastructure"

### 1) Market discovery + selection

**Purpose:** Decide *where* to quote.

* Use **Gamma** to fetch markets/events and get:

  * `clobTokenIds` (what you trade)
  * `tickSize`, `negRisk` flags (needed by the TS client when placing orders)
  * volume/liquidity fields and metadata ([Polymarket Documentation][12])
* You'll also want to filter for "rewards markets" using Polymarket's rewards indicators/metadata (varies by API surface; often easiest to start by pulling candidates and then verifying scoring with `/order-scoring` once you post). ([Polymarket Documentation][11])

**Infra:** can be a cron-like process or a small service; doesn't need low latency.

---

### 2) Market data ingestion (hot path)

**Purpose:** Maintain a real-time view of the book so you know where to quote.

* Subscribe to **CLOB WebSocket `market` channel** (public) which emits:

  * `book` messages (initial snapshot; also after trades affecting the book)
  * `price_change` messages (new orders/cancels affecting the book) ([Polymarket Documentation][13])
* You maintain a local orderbook state (at least top-of-book, often level-2 depth).

**Infra:** one always-on process with robust reconnect + resync logic.

---

### 3) User stream ingestion (fills, order status)

**Purpose:** Keep your internal state correct without polling.

* Subscribe to **CLOB WebSocket `user` channel** (authenticated), which gives you updates about your orders and trades. ([Polymarket Documentation][14])

**Infra:** same always-on process or a sibling process.

---

### 4) Strategy engine (deterministic quoting)

This is where you compute *desired orders*.

For a rewards-first MM bot, the first version can be intentionally simple:

* Reference price = midpoint (or smoothed midpoint)
* Quote bid/ask around reference price at a spread that:

  * is inside **max spread**
  * respects **tick size**
* Size = at/above the **minimum shares** threshold + scaled by your risk budget
* Inventory skew = if you're net long YES, make your ask more aggressive and bid less aggressive, etc.

This strategy's edge is:

* **rewards** (explicit subsidy)
* plus **some** spread capture
* minus adverse selection and inventory drift

You're not trying to be "the smartest predictor" on day 1.

---

### 5) Order manager (the most important module)

**Purpose:** Turn "desired state" into "live orders" safely and efficiently.

Responsibilities:

* Fetch open orders (or track from user stream)
* Compute a diff: what to place/cancel/replace
* Batch where possible to reduce API calls
* Enforce per-market and global limits (max open orders, max notional, etc.)
* Kill switch: if data feed stale, cancel everything

Polymarket's CLOB endpoints support placing and canceling (single and batch), and their docs emphasize using the CLOB client libraries. ([Polymarket Documentation][15])

**Rate limits:** Polymarket publishes substantial limits (with burst vs sustained behavior). Build your order manager to avoid "churn storms" and use WebSockets to reduce polling. ([Polymarket Documentation][16])

---

### 6) Execution + signing service (key isolation)

This is a best practice if you add any AI/agentic layer:

* A small "execution service" owns:

  * L1 signer (private key)
  * derived L2 API creds
  * the only network path allowed to hit trading endpoints
* Everyone else (including any AI agent) talks to execution through a very narrow internal API:

  * "place order: token, side, price, size"
  * "cancel order IDs"
  * "cancel all"
* Execution service enforces policy:

  * max size
  * allowed markets list
  * price bands
  * daily notional caps

**Why:** you never want an LLM (or a prompt injection through logs/news) to have direct access to signing keys.

Auth details and how L1/L2 work are in the docs. ([Polymarket Documentation][7])

---

### 7) Rewards-scoring verifier

Very pragmatic: after you place/update orders, call:

* `GET /order-scoring?order_id=...`
* or the batch endpoint

This tells you if the order is "scoring" for rewards. ([Polymarket Documentation][11])

This module is how you avoid spending days thinking you're earning rewards while your orders are actually non-qualifying.

---

### 8) Inventory manager (on-chain realities)

To *sell* outcome tokens (provide asks), you need inventory.

Polymarket's MM docs describe inventory management explicitly as:

1. **Splitting USDCe** into YES/NO tokens
2. **Merging** back to USDCe
3. **Redeeming** after resolution

...and they show doing this via the Conditional Token Framework contract, typically through a relayer client for gasless execution. ([Polymarket Documentation][17])

For the bot:

* Maintain a target inventory band per market
* If inventory too low to quote asks, split more (or reduce asks)
* If inventory too high / you want to unwind, merge when possible (requires both sides)

---

## What should actually be "running" (process model)

### MVP (single host)

* 1 container / service:

  * websocket market + user ingestion
  * strategy + order manager
  * execution signing (same process, simplest)
  * writes to SQLite/Postgres
* plus basic alerting (logs + a heartbeat)

### Production-ish (what I'd do if you want it to be reliable)

* **Two services**:

  1. `mm-core` (data plane): deterministic quoting + order mgmt (no LLM deps)
  2. `executor` (signing/trading): owns keys, enforces guardrails
* Optional third:
  3) `ai-ops` (control plane): market selection suggestions, anomaly detection, report generation

Add:

* Postgres (or a durable DB)
* Prometheus/Grafana
* Pager/alerts (deadman switch: "if no WS updates in X seconds => cancel-all")

---

## Can an AI agent be part of the loop?

### Yes--but put it in the right place.

Polymarket themselves maintain an open-source **"Polymarket Agents"** framework that's explicitly about trading with AI agents, including RAG support and data sourcing, and it references integrating with Polymarket APIs. ([GitHub][18])

That said, for **market making**, I strongly recommend:

#### Keep AI out of the hot quoting loop

Because:

* WebSocket timing + order churn is where you blow up
* LLM latency and nondeterminism is a liability
* Reward/MM bots need reliability > creativity

#### Use AI in the control plane

Great AI agent jobs here:

* Market selection (scan Gamma tags/markets and rank by "reward pool vs competition")
* Incident response ("why did rewards drop yesterday?" -> summarize diffs, scoring checks)
* Parameter proposals ("reduce size on these markets due to toxic flow")
* Codegen assistance for new connectors, dashboards, reports

#### If you *do* let AI propose trades/orders

Make it **advisory**:

* AI writes a "desired quote spec"
* deterministic validator clamps it inside rules
* executor enforces caps and allowed-market lists

---

## Concrete "stack" I'd choose for this build

### Language choice

* **TypeScript/Node** for the hot path is very reasonable because:

  * official `@polymarket/clob-client` exists ([GitHub][19])
  * websocket + event-loop model is strong
* **Python** is great for the AI/control plane (and Polymarket has Python clients + an AI agents repo). ([GitHub][18])

A clean hybrid is:

* `mm-core` + `executor`: Node/TS
* `ai-ops`: Python

### Key integration details you'll implement (TS client example cues)

Polymarket's TS client README shows:

* `host = https://clob.polymarket.com`
* chain id 137 (Polygon)
* `funder` is your Polymarket "profile address"
* signatureType differs for browser wallet vs Magic/email login
* `createAndPostOrder` needs `{ tickSize, negRisk }` which you get from Gamma `/markets` ([GitHub][20])

---

## If we move forward from here, what I would build next (in order)

1. **Market scanner**: pull active markets via Gamma `/markets` and extract:

   * clobTokenIds, tickSize, negRisk, liquidity/volume fields ([Polymarket Documentation][21])
2. **WebSocket book state**: subscribe to `market` channel and maintain top-of-book ([Polymarket Documentation][13])
3. **Order manager + executor**: place/cancel orders via CLOB, with guardrails ([Polymarket Documentation][15])
4. **Scoring verifier loop**: after updates, confirm orders score ([Polymarket Documentation][11])
5. **User fills -> inventory tracking**: subscribe to `user` channel; compute exposures ([Polymarket Documentation][14])
6. **Inventory operations**: split/merge USDCe as needed using CTF/relayer patterns ([Polymarket Documentation][17])
7. **Observability + kill switch**: cancel-all on stale feeds or error storms (and stay inside rate limits) ([Polymarket Documentation][16])
8. Add `ai-ops` agent (optional): recommend markets/params; never hold keys ([GitHub][18])

---

If you want, I can now turn this into a **repo blueprint** (directory layout + interfaces between `mm-core`, `executor`, and `ai-ops`, plus the exact message formats you'd pass around), and a minimal set of config knobs (spread/size/skew/limits) that makes the first version controllable and safe.

[1]: https://docs.polymarket.com/developers/CLOB/geoblock?utm_source=chatgpt.com "Geographic Restrictions"
[2]: https://docs.polymarket.com/developers/market-makers/trading?utm_source=chatgpt.com "Trading"
[3]: https://docs.polymarket.com/developers/CLOB/introduction?utm_source=chatgpt.com "CLOB Introduction"
[4]: https://docs.polymarket.com/quickstart/reference/endpoints?utm_source=chatgpt.com "Endpoints"
[5]: https://docs.polymarket.com/developers/gamma-markets-api/overview?utm_source=chatgpt.com "Overview - Polymarket Documentation"
[6]: https://docs.polymarket.com/developers/RTDS/RTDS-overview?utm_source=chatgpt.com "Real Time Data Socket"
[7]: https://docs.polymarket.com/developers/CLOB/authentication?utm_source=chatgpt.com "Authentication"
[8]: https://docs.polymarket.com/developers/CLOB/orders/orders?utm_source=chatgpt.com "Orders Overview"
[9]: https://docs.polymarket.com/polymarket-learn/trading/liquidity-rewards?utm_source=chatgpt.com "Liquidity Rewards"
[10]: https://docs.polymarket.com/developers/market-makers/liquidity-rewards?utm_source=chatgpt.com "Liquidity Rewards"
[11]: https://docs.polymarket.com/developers/CLOB/orders/check-scoring?utm_source=chatgpt.com "Check Order Reward Scoring"
[12]: https://docs.polymarket.com/developers/market-makers/data-feeds?utm_source=chatgpt.com "Data Feeds"
[13]: https://docs.polymarket.com/developers/CLOB/websocket/market-channel?utm_source=chatgpt.com "Market Channel"
[14]: https://docs.polymarket.com/developers/CLOB/websocket/user-channel?utm_source=chatgpt.com "User Channel"
[15]: https://docs.polymarket.com/developers/CLOB/orders/create-order?utm_source=chatgpt.com "Place Single Order"
[16]: https://docs.polymarket.com/quickstart/introduction/rate-limits?utm_source=chatgpt.com "API Rate Limits"
[17]: https://docs.polymarket.com/developers/market-makers/inventory?utm_source=chatgpt.com "Inventory Management"
[18]: https://github.com/Polymarket/agents "GitHub - Polymarket/agents: Trade autonomously on Polymarket using AI Agents"
[19]: https://github.com/Polymarket/clob-client?utm_source=chatgpt.com "Typescript client for the Polymarket CLOB"
[20]: https://github.com/Polymarket/clob-client "GitHub - Polymarket/clob-client: Typescript client for the Polymarket CLOB"
[21]: https://docs.polymarket.com/developers/gamma-markets-api/get-markets?utm_source=chatgpt.com "Get Markets"
