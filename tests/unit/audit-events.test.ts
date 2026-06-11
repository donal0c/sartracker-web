import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AUDIT_EVENT_LIMIT,
  TELEMETRY_EVENT_TYPES,
  isTelemetryEventType,
} from '../../src/features/mission-review/audit-events'

describe('audit event classification', () => {
  it('classifies high-volume tracking heartbeats as telemetry', () => {
    expect(isTelemetryEventType('device_updated')).toBe(true)
    expect(isTelemetryEventType('position_recorded')).toBe(true)
  })

  it('treats operator-meaningful lifecycle events as non-telemetry', () => {
    expect(isTelemetryEventType('mission_created')).toBe(false)
    expect(isTelemetryEventType('marker_created')).toBe(false)
    expect(isTelemetryEventType('drawing_deleted')).toBe(false)
    expect(isTelemetryEventType('mission_finalized')).toBe(false)
  })

  it('exposes the telemetry set and a bounded default limit', () => {
    expect(TELEMETRY_EVENT_TYPES).toContain('device_updated')
    expect(TELEMETRY_EVENT_TYPES).toContain('position_recorded')
    expect(DEFAULT_AUDIT_EVENT_LIMIT).toBeGreaterThan(0)
    expect(DEFAULT_AUDIT_EVENT_LIMIT).toBeLessThanOrEqual(1000)
  })
})
