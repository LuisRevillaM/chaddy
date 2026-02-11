// @ts-check

/**
 * Compute deterministic inventory pressure signals.
 *
 * @param {{ position: number, target: number }} params
 * @returns {{ ok: boolean, needsBuy: boolean, needsSell: boolean, note: string }}
 */
export function computeInventorySignals(params) {
  const position = Number(params?.position);
  const target = Number(params?.target);

  if (!Number.isFinite(position)) return { ok: false, needsBuy: false, needsSell: false, note: "invalid_position" };
  if (!(Number.isFinite(target) && target > 0)) return { ok: false, needsBuy: false, needsSell: false, note: "invalid_target" };

  if (position < -target) {
    return { ok: true, needsBuy: true, needsSell: false, note: "below_target_band" };
  }
  if (position > target) {
    return { ok: true, needsBuy: false, needsSell: true, note: "above_target_band" };
  }
  return { ok: true, needsBuy: false, needsSell: false, note: "within_target_band" };
}

