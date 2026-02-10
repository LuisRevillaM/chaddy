# Internal Interfaces (MVP)

These are the interfaces agents should build toward so components stay decoupled and testable.

## Market data events (mm-core input)

MVP shape (JS object):

- Snapshot:
  - `{ type: "book", seq: number, bids: Array<[price:number, size:number]>, asks: Array<[price:number, size:number]> }`
- Delta:
  - `{ type: "price_change", seq: number, side: "bid"|"ask", price: number, size: number }`

`mm-core` must reject non-contiguous `seq` deltas unless it explicitly resyncs from a new snapshot.

## User events (mm-core input)

MVP shape:

- `{ type: "order_open", orderId: string, side: "BUY"|"SELL", price: number, size: number }`
- `{ type: "fill", orderId: string, side: "BUY"|"SELL", price: number, size: number }`
- `{ type: "order_canceled", orderId: string }`
- `{ type: "order_closed", orderId: string }`

## Executor API (mm-core output boundary)

MVP method surface (in-process for now):

- `placeOrder({ market, side, price, size }) -> { ok, reason, orderId }`
- `cancelOrder(orderId) -> { ok, reason }`
- `cancelAll() -> { ok, reason, canceled }`

Hard constraints:

- Executor must enforce geoblock gating and policy guardrails.
- mm-core must never receive keys/creds.

