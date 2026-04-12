import { describe, it, expect } from 'vitest'

import { createTileHealthTracker } from '../../src/lib/tile-health-tracker'

describe('TileHealthTracker', () => {
  describe('threshold-based degradation', () => {
    it('does not degrade on a single tile error', () => {
      const tracker = createTileHealthTracker()
      const result = tracker.recordError(1000)
      expect(result).toBe('no-change')
    })

    it('does not degrade on errors below the threshold', () => {
      const tracker = createTileHealthTracker()
      expect(tracker.recordError(1000)).toBe('no-change')
      expect(tracker.recordError(2000)).toBe('no-change')
    })

    it('degrades when errors reach the threshold within the window', () => {
      const tracker = createTileHealthTracker()
      tracker.recordError(1000)
      tracker.recordError(2000)
      const result = tracker.recordError(3000)
      expect(result).toBe('degrade')
    })

    it('stays degraded on subsequent errors after threshold', () => {
      const tracker = createTileHealthTracker()
      tracker.recordError(1000)
      tracker.recordError(2000)
      tracker.recordError(3000)
      const result = tracker.recordError(4000)
      expect(result).toBe('degrade')
    })

    it('supports custom threshold', () => {
      const tracker = createTileHealthTracker({ threshold: 5 })
      for (let i = 0; i < 4; i++) {
        expect(tracker.recordError(1000 + i * 100)).toBe('no-change')
      }
      expect(tracker.recordError(1400)).toBe('degrade')
    })
  })

  describe('sliding window expiry', () => {
    it('does not degrade when errors are spread beyond the window', () => {
      const tracker = createTileHealthTracker()
      tracker.recordError(0)
      tracker.recordError(5000)
      // Third error is 11s after the first — first error has expired
      const result = tracker.recordError(11_000)
      expect(result).toBe('no-change')
    })

    it('degrades when errors cluster within a fresh window', () => {
      const tracker = createTileHealthTracker()
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
      const tracker = createTileHealthTracker({ windowMs: 2000 })
      tracker.recordError(0)
      tracker.recordError(500)
      // 2.5s later — first two errors expired
      const result = tracker.recordError(2500)
      expect(result).toBe('no-change')
    })
  })

  describe('reset (recovery on idle)', () => {
    it('clears error history so subsequent errors start fresh', () => {
      const tracker = createTileHealthTracker()
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
      const tracker = createTileHealthTracker()
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
      const tracker = createTileHealthTracker()
      expect(tracker.shouldRecover(5000)).toBe(false)
    })

    it('returns true when all errors have expired from the window', () => {
      const tracker = createTileHealthTracker()
      tracker.recordError(1000)
      tracker.recordError(2000)
      tracker.recordError(3000)
      // 15s later — all errors expired
      expect(tracker.shouldRecover(15_000)).toBe(true)
    })

    it('returns false when recent errors remain in the window', () => {
      const tracker = createTileHealthTracker()
      tracker.recordError(1000)
      tracker.recordError(2000)
      tracker.recordError(3000)
      // Only 2s later — errors still in window
      expect(tracker.shouldRecover(5000)).toBe(false)
    })
  })
})
