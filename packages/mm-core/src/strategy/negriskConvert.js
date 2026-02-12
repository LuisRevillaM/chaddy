export const TERMINAL_FAILURE_STATES = new Set([
  'STATE_FAILED',
  'STATE_INVALID'
]);

export function classifyConversionState(state) {
  if (state === 'STATE_CONFIRMED') return 'success';
  if (TERMINAL_FAILURE_STATES.has(state)) return 'terminal_failure';
  return 'in_flight';
}
