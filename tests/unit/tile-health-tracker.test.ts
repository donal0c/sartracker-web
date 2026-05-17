import { describe, it, expect } from 'vitest'

import { createTileHealthTracker } from '../../src/lib/tile-health-tracker'

describe('TileHealthTracker', () => {
  describe('default thresholds (operator-trust gate)', () => {
    // Operators rely on the degraded badge to mean "the basemap is genuinely
    // unreliable, stop trusting positions on it." A handful of 429/timeout
    // hiccups during first-paint or normal panning must not trigger that
    // signal. The defaults below were tightened in response to
    // sartracker-web-2xp where the OpenTopoMap badge was firing immediately
    // on first paint and during normal use.
    it('tolerates a small burst of transient errors near first paint', () => {
      const tracker = createTileHealthTracker()
      // 4 quick errors at first-paint should not trigger the badge.
      expect(tracker.recordError(1000)).toBe('no-change')
      expect(tracker.recordError(1500)).toBe('no-change')
      expect(tracker.recordError(2000)).toBe('no-change')
      expect(tracker.recordError(2500)).toBe('no-change')
    })

    it('only degrades after a sustained burst of errors', () => {
      const tracker = createTileHealthTracker()
      // 5 errors within the default window are required to trip the badge.
      for (let i = 0; i < 4; i++) {
        expect(tracker.recordError(1000 + i * 1000)).toBe('no-change')
      }
      expect(tracker.recordError(5500)).toBe('degrade')
    })

    it('uses a window long enough to span normal pan/zoom interaction', () => {
      const tracker = createTileHealthTracker()
      // 4 errors spread across 25s — still within the 30s default window.
      tracker.recordError(0)
      tracker.recordError(8_000)
      tracker.recordError(16_000)
      tracker.recordError(24_000)
      // The fifth error at 25s closes the window — should degrade.
      expect(tracker.recordError(25_000)).toBe('degrade')
    })

    it('lets errors drop out of the window after roughly 30 seconds', () => {
      const tracker = createTileHealthTracker()
      tracker.recordError(0)
      tracker.recordError(1000)
      tracker.recordError(2000)
      tracker.recordError(3000)
      // 35s after the first error — every recorded error should have
      // dropped out of the window.
      expect(tracker.shouldRecover(35_000)).toBe(true)
    })
  })

  describe('threshold-based degradation', () => {
    it('does not degrade on a single tile error', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      const result = tracker.recordError(1000)
      expect(result).toBe('no-change')
    })

    it('does not degrade on errors below the threshold', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      expect(tracker.recordError(1000)).toBe('no-change')
      expect(tracker.recordError(2000)).toBe('no-change')
    })

    it('degrades when errors reach the threshold within the window', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      tracker.recordError(1000)
      tracker.recordError(2000)
      const result = tracker.recordError(3000)
      expect(result).toBe('degrade')
    })

    it('stays degraded on subsequent errors after threshold', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      tracker.recordError(1000)
      tracker.recordError(2000)
      tracker.recordError(3000)
      const result = tracker.recordError(4000)
      expect(result).toBe('degrade')
    })

    it('supports custom threshold', () => {
      const tracker = createTileHealthTracker({ threshold: 5, windowMs: 10_000 })
      for (let i = 0; i < 4; i++) {
        expect(tracker.recordError(1000 + i * 100)).toBe('no-change')
      }
      expect(tracker.recordError(1400)).toBe('degrade')
    })
  })

  describe('sliding window expiry', () => {
    it('does not degrade when errors are spread beyond the window', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      tracker.recordError(0)
      tracker.recordError(5000)
      // Third error is 11s after the first — first error has expired
      const result = tracker.recordError(11_000)
      expect(result).toBe('no-change')
    })

    it('degrades when errors cluster within a fresh window', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      // Spread errors wide enough that early ones expire
      tracker.recordError(0)
      tracker.recordError(5000)
      // Now cluster three errors in a tight window
      tracker.recordError(15_000)
      tracker.recordError(16_000)
      const result = tracker.recordError(17_000)
      expect(result).toBe('degrade')
    })

    it('supports custom window duration', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 2000 })
      tracker.recordError(0)
      tracker.recordError(500)
      // 2.5s later — first two errors expired
      const result = tracker.recordError(2500)
      expect(result).toBe('no-change')
    })
  })

  describe('reset (recovery on idle)', () => {
    it('clears error history so subsequent errors start fresh', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      tracker.recordError(1000)
      tracker.recordError(2000)
      // Two errors accumulated, one more would degrade
      tracker.reset()
      // After reset, need full threshold again
      expect(tracker.recordError(3000)).toBe('no-change')
      expect(tracker.recordError(4000)).toBe('no-change')
      expect(tracker.recordError(5000)).toBe('degrade')
    })

    it('allows recovery after degradation', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      tracker.recordError(1000)
      tracker.recordError(2000)
      tracker.recordError(3000) // degrades
      tracker.reset() // operator sees idle — tiles loaded
      // A single transient error should not re-degrade
      expect(tracker.recordError(10_000)).toBe('no-change')
    })
  })

  describe('shouldRecover', () => {
    it('returns false when no errors have been recorded', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      expect(tracker.shouldRecover(5000)).toBe(false)
    })

    it('returns true when all errors have expired from the window', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      tracker.recordError(1000)
      tracker.recordError(2000)
      tracker.recordError(3000)
      // 15s later — all errors expired
      expect(tracker.shouldRecover(15_000)).toBe(true)
    })

    it('returns false when recent errors remain in the window', () => {
      const tracker = createTileHealthTracker({ threshold: 3, windowMs: 10_000 })
      tracker.recordError(1000)
      tracker.recordError(2000)
      tracker.recordError(3000)
      // Only 2s later — errors still in window
      expect(tracker.shouldRecover(5000)).toBe(false)
    })
  })
})
