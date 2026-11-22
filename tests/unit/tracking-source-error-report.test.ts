// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'

import {
  reportTrackingSourceErrors,
  TRACKING_SOURCE_ERROR_REPORT_LIMIT,
} from '../../src/features/map/tracking-source-error-report'

type Listener = (event: unknown) => void

/** A minimal evented map, like MapLibre's: on/off, and a source error re-fired with its id. */
function fakeMap() {
  const listeners = new Set<Listener>()
  return {
    on: (_type: 'error', listener: Listener) => { listeners.add(listener) },
    off: (_type: 'error', listener: Listener) => { listeners.delete(listener) },
    fire: (event: unknown) => { for (const listener of listeners) listener(event) },
    listenerCount: () => listeners.size,
  }
}

const read = () => (window as Window & { __SARTRACKER_TRACKING_SOURCE_ERRORS__?: string[] }).__SARTRACKER_TRACKING_SOURCE_ERRORS__

let stop: (() => void) | null = null
afterEach(() => { stop?.(); stop = null })

it('starts empty, records only tracking-source errors, and is removed on stop [DON-353]', () => {
  const map = fakeMap()
  stop = reportTrackingSourceErrors(map)
  expect(read()).toEqual([])
  map.fire({ sourceId: 'basemap', error: new Error('tile 404') })
  map.fire({ error: new Error('style failed') })
  map.fire({ sourceId: 'tracking', error: new Error('worker rejected the update') })
  expect(read()).toEqual(['worker rejected the update'])
  stop()
  stop = null
  expect('__SARTRACKER_TRACKING_SOURCE_ERRORS__' in window).toBe(false)
  expect(map.listenerCount()).toBe(0)
})

it('keeps only the latest entries, so a looping error cannot grow memory [DON-353]', () => {
  const map = fakeMap()
  stop = reportTrackingSourceErrors(map)
  for (let index = 0; index < TRACKING_SOURCE_ERROR_REPORT_LIMIT + 5; index += 1) {
    map.fire({ sourceId: 'tracking', error: new Error(`error ${index}`) })
  }
  const errors = read() ?? []
  expect(errors).toHaveLength(TRACKING_SOURCE_ERROR_REPORT_LIMIT)
  expect(errors.at(-1)).toBe(`error ${TRACKING_SOURCE_ERROR_REPORT_LIMIT + 4}`)
})

it('a recreated map gets a fresh report, and stopping the old one leaves it alone [DON-353]', () => {
  const first = fakeMap()
  const stopFirst = reportTrackingSourceErrors(first)
  first.fire({ sourceId: 'tracking', error: new Error('old map') })
  const second = fakeMap()
  stop = reportTrackingSourceErrors(second)
  expect(read()).toEqual([])
  stopFirst()
  expect(read()).toEqual([])
  first.fire({ sourceId: 'tracking', error: new Error('after teardown') })
  second.fire({ sourceId: 'tracking', error: new Error('new map') })
  expect(read()).toEqual(['new map'])
})

it('records an error without a message as text rather than dropping it [DON-353]', () => {
  const map = fakeMap()
  stop = reportTrackingSourceErrors(map)
  map.fire({ sourceId: 'tracking' })
  expect(read()).toEqual(['unknown error'])
})
