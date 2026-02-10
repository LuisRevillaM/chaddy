// Proof harness safety: prevent accidental real network calls in offline suites.
//
// This is not a perfect sandbox (code could still use low-level sockets),
// but it blocks the most common accidental path: `fetch(...)`.

if (process.env.PROVE_NO_NETWORK === "1") {
  globalThis.fetch = async () => {
    throw new Error("Network is disabled in proof suites (PROVE_NO_NETWORK=1). Use SimExchange/replay fixtures instead.");
  };

  // Node 20+ has a global WebSocket implementation; block it to keep offline suites honest.
  // (Integration suites can run without this import.)
  globalThis.WebSocket = class DisabledWebSocket {
    constructor() {
      throw new Error("Network is disabled in proof suites (PROVE_NO_NETWORK=1). WebSocket is not allowed.");
    }
  };
}
