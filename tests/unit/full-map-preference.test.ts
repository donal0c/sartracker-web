// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { persistFullMap, readStoredFullMap } from '../../src/features/workspace/full-map-preference'

/** Full map replaces Focus Mode, which was remembered across a reload or crash (DON-341). */
describe('full-map-preference', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to showing the panel when nothing is stored', () => {
    expect(readStoredFullMap()).toBe(false)
  })

  it('remembers Full map for reload and crash recovery', () => {
    persistFullMap(true)
    expect(readStoredFullMap()).toBe(true)
  })

  it('remembers Show panel after Full map', () => {
    persistFullMap(true)
    persistFullMap(false)
    expect(readStoredFullMap()).toBe(false)
  })

  it('keeps working when storage is locked down', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => persistFullMap(true)).not.toThrow()
    expect(readStoredFullMap()).toBe(false)
  })
})
