/**
 * Shared classification of mission event types for the review audit log.
 *
 * Older stores and the legacy Rust reference may contain high-volume `device_updated`
 * and `position_recorded` heartbeat events. Current Electron/browser persistence emits
 * device updates only for a name/status/color change and stores position truth solely in
 * `positions`, but legacy telemetry remains classified so old missions stay reviewable.
 *
 * The review audit log excludes these by default so the IPC payload and rendered DOM
 * stay bounded. A reviewer can opt back into telemetry via an explicit toggle.
 */
export const TELEMETRY_EVENT_TYPES = ['device_updated', 'position_recorded'] as const

/**
 * Default cap on audit events returned to the review UI. Even with telemetry excluded,
 * a long mission can accumulate many operator events; the UI must never receive an
 * unbounded result set in a single call.
 */
export const DEFAULT_AUDIT_EVENT_LIMIT = 500

const TELEMETRY_EVENT_TYPE_SET: ReadonlySet<string> = new Set(TELEMETRY_EVENT_TYPES)

/**
 * Returns true when the given event type is high-volume tracking telemetry that should
 * be excluded from the review audit log by default.
 */
export function isTelemetryEventType(eventType: string): boolean {
  return TELEMETRY_EVENT_TYPE_SET.has(eventType)
}
