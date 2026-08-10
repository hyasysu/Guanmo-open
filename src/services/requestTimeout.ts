export const REQUEST_TIMEOUT_MIN_MS = 5_000
export const REQUEST_TIMEOUT_MAX_MS = 120_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

export function normalizeRequestTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_REQUEST_TIMEOUT_MS
  return Math.min(REQUEST_TIMEOUT_MAX_MS, Math.max(REQUEST_TIMEOUT_MIN_MS, Math.round(value)))
}
