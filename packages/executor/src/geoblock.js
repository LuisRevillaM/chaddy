// @ts-check

/**
 * Geoblock check stub.
 *
 * Real implementation should call the official Polymarket geoblock guidance and refuse trading
 * when blocked. For proof harnesses we gate on an env var.
 */
export function isGeoAllowed() {
  return process.env.GEO_ALLOWED === "1";
}

