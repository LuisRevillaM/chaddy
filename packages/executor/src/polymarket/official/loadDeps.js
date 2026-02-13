// @ts-check

/**
 * The repo runs proof suites offline and without npm deps installed.
 *
 * For live/integration runs on an operator machine, we rely on Polymarket's
 * official client libraries. Those are loaded dynamically so offline proofs
 * do not require installing them.
 */

/**
 * @returns {Promise<
 *  | { ok: true, ClobClient: any, OrderType: any, Side: any, Wallet: any }
 *  | { ok: false, error: string }
 * >}
 */
export async function loadOfficialPolymarketDeps() {
  /** @type {any} */
  let clob;
  try {
    clob = await import("@polymarket/clob-client");
  } catch {
    return { ok: false, error: "missing_dep:@polymarket/clob-client" };
  }

  /** @type {any} */
  let walletMod;
  try {
    walletMod = await import("@ethersproject/wallet");
  } catch {
    return { ok: false, error: "missing_dep:@ethersproject/wallet" };
  }

  const ClobClient = clob?.ClobClient;
  const Side = clob?.Side;
  const OrderType = clob?.OrderType;
  const Wallet = walletMod?.Wallet;

  if (!ClobClient || !Side || !OrderType) return { ok: false, error: "invalid_dep:@polymarket/clob-client" };
  if (!Wallet) return { ok: false, error: "invalid_dep:@ethersproject/wallet" };

  return { ok: true, ClobClient, Side, OrderType, Wallet };
}

