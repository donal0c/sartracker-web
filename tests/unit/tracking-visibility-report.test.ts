// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'

import { clearTrackingVisibleOnMap, reportTrackingVisibleOnMap } from '../../src/features/map/tracking-visibility-report'

const read = () => (window as Window & { __SARTRACKER_TRACKING_VISIBLE__?: boolean }).__SARTRACKER_TRACKING_VISIBLE__

afterEach(() => clearTrackingVisibleOnMap())

it('sets, updates and deletes the tracking visibility report [DON-353]', () => {
  expect(read()).toBeUndefined()
  reportTrackingVisibleOnMap(true)
  expect(read()).toBe(true)
  reportTrackingVisibleOnMap(false)
  expect(read()).toBe(false)
  clearTrackingVisibleOnMap()
  expect('__SARTRACKER_TRACKING_VISIBLE__' in window).toBe(false)
})
