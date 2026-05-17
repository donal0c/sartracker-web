import { describe, expect, it } from 'vitest'

import { isTileErrorEvent } from '../../src/features/map/is-tile-error-event'

describe('isTileErrorEvent', () => {
  // Maplibre fires `error` events for many situations, only some of which
  // mean a tile actually failed to load. Tile errors carry a `tile` property
  // on the event payload. Other errors (style errors, image errors,
  // canvas-source errors, generic Error.message-only errors) do not.
  // Counting those non-tile errors against the tile-health budget caused
  // the over-eager "tiles failed to load" badge in sartracker-web-2xp.

  it('treats events with a truthy tile property as tile errors', () => {
    const event = { type: 'error', error: new Error('Failed to fetch'), tile: { tileID: 'abc' } }
    expect(isTileErrorEvent(event)).toBe(true)
  })

  it('rejects events without a tile property', () => {
    const event = { type: 'error', error: new Error('style.json missing layer foo') }
    expect(isTileErrorEvent(event)).toBe(false)
  })

  it('rejects events with an explicitly null tile', () => {
    const event = { type: 'error', error: new Error('something else'), tile: null }
    expect(isTileErrorEvent(event)).toBe(false)
  })

  it('rejects events with an undefined tile', () => {
    const event = { type: 'error', error: new Error('source error'), tile: undefined }
    expect(isTileErrorEvent(event)).toBe(false)
  })

  it('handles entirely unknown payloads safely', () => {
    expect(isTileErrorEvent(null)).toBe(false)
    expect(isTileErrorEvent(undefined)).toBe(false)
    expect(isTileErrorEvent('error')).toBe(false)
    expect(isTileErrorEvent(42)).toBe(false)
    expect(isTileErrorEvent({})).toBe(false)
  })

  it('rejects events whose tile field is not an object', () => {
    expect(isTileErrorEvent({ type: 'error', tile: 'tile-id' })).toBe(false)
    expect(isTileErrorEvent({ type: 'error', tile: 0 })).toBe(false)
    expect(isTileErrorEvent({ type: 'error', tile: false })).toBe(false)
  })
})
