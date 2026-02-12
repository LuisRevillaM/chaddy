export function estimateNegRiskEdgePerShare({ buyNoAsk, otherYesBids, feeBips = 0 }) {
  if (!Number.isFinite(buyNoAsk) || buyNoAsk < 0) return null;
  if (!Array.isArray(otherYesBids) || otherYesBids.length === 0) return null;
  if (!otherYesBids.every((p) => Number.isFinite(p) && p >= 0)) return null;
  if (!Number.isFinite(feeBips) || feeBips < 0) return null;

  const fee = feeBips / 10_000;
  const outMultiplier = 1 - fee;
  const revenuePerShare = otherYesBids.reduce((a, b) => a + b, 0) * outMultiplier;
  return revenuePerShare - buyNoAsk;
}

export function sizeByDepthAndRisk({ noAskSize, otherYesBidSizes, maxSharesByRisk }) {
  if (!Number.isFinite(noAskSize) || noAskSize < 0) return 0;
  if (!Array.isArray(otherYesBidSizes) || otherYesBidSizes.length === 0) return 0;
  if (!otherYesBidSizes.every((s) => Number.isFinite(s) && s >= 0)) return 0;
  if (!Number.isFinite(maxSharesByRisk) || maxSharesByRisk < 0) return 0;

  const depthCap = Math.min(noAskSize, ...otherYesBidSizes);
  return Math.max(0, Math.floor(Math.min(depthCap, maxSharesByRisk)));
}
