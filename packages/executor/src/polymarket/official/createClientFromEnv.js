// @ts-check

import { invariant } from "../../../shared/src/assert.js";

import { loadOfficialPolymarketDeps } from "./loadDeps.js";

const DEFAULT_HOST = "https://clob.polymarket.com";
const DEFAULT_CHAIN_ID = 137; // Polygon

function cleanHexKey(s) {
  const raw = String(s || "").trim();
  if (!raw) return null;
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function toInt(s, fallback) {
  const n = Number(String(s ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Create an official Polymarket `ClobClient` from runtime environment variables.
 *
 * Required env (operator machine only):
 * - POLY_PRIVATE_KEY
 * - POLY_FUNDER_ADDRESS
 * - POLY_SIGNATURE_TYPE (0|1|2)
 *
 * Optional:
 * - POLY_CLOB_HOST (default https://clob.polymarket.com)
 * - POLY_CHAIN_ID (default 137)
 *
 * @returns {Promise<
 *  | { ok: true, client: any, apiCreds: any, signerAddress: string, host: string, chainId: number }
 *  | { ok: false, error: string }
 * >}
 */
export async function createOfficialClobClientFromEnv() {
  const deps = await loadOfficialPolymarketDeps();
  if (!deps.ok) return deps;

  const host = String(process.env.POLY_CLOB_HOST || DEFAULT_HOST);
  const chainId = toInt(process.env.POLY_CHAIN_ID, DEFAULT_CHAIN_ID);

  const pk = cleanHexKey(process.env.POLY_PRIVATE_KEY);
  if (!pk) return { ok: false, error: "missing_env:POLY_PRIVATE_KEY" };

  const signatureType = toInt(process.env.POLY_SIGNATURE_TYPE, NaN);
  if (!(signatureType === 0 || signatureType === 1 || signatureType === 2)) return { ok: false, error: "invalid_env:POLY_SIGNATURE_TYPE" };

  const funder = String(process.env.POLY_FUNDER_ADDRESS || "").trim();
  if (!funder) return { ok: false, error: "missing_env:POLY_FUNDER_ADDRESS" };

  // Important: do not log or persist `pk`. Keep it in memory only.
  const signer = new deps.Wallet(pk);
  const signerAddress = String(await signer.getAddress());

  invariant(typeof deps.ClobClient === "function", "ClobClient must be a constructor");

  // Derive or create L2 API creds for this signer.
  const tmp = new deps.ClobClient(host, chainId, signer);
  const apiCreds = await tmp.createOrDeriveApiKey();

  // Full client with trading methods.
  const client = new deps.ClobClient(host, chainId, signer, apiCreds, signatureType, funder);
  return { ok: true, client, apiCreds, signerAddress, host, chainId };
}

