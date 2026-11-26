import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMissionStore } from '../../src/features/mission/mission-store'
import { useStationaryAttentionStore } from '../../src/features/tracking/stationary-attention-store'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'
import { useTrackingHeadline } from '../../src/features/workspace/tracking-headline'

const START = Date.parse('2026-11-26T10:00:00.000Z')
const LINE = 'Not-moving warnings are off for 1 person: their trail is not being recorded'

const position: NormalizedTrackingPosition = {
  id: 'a', device_id: 'one', lat: 52, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: 4,
  timestamp: new Date(START).toISOString(), timestamp_source: 'fix', source: 'osmand', data_origin: 'live',
  cache_age_seconds: null, device_cache_stale: false,
}

let root: Root | null = null
let latest: ReturnType<typeof useTrackingHeadline> | null = null

/** Keeps the hook's latest value for the assertions. */
function record(headline: ReturnType<typeof useTrackingHeadline>): null {
  latest = headline
  return null
}

/** Renders the headline hook and returns a live view of its latest value. */
function renderHeadline(): { readonly current: ReturnType<typeof useTrackingHeadline> } {
  function Probe() {
    return record(useTrackingHeadline())
  }
  root = createRoot(document.createElement('div'))
  act(() => { root!.render(<Probe />) })
  return { get current() { return latest! } }
}

describe('the not-moving-off line appears after two minutes without a new update [DON-384]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    useTrackingStore.setState({
      snapshot: { devices: [], positions: [position], breadcrumbs: [] },
      status: { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null },
    })
    useStationaryAttentionStore.setState({ checkOffSinceByDevice: { one: START } })
  })
  afterEach(() => {
    act(() => { root?.unmount() })
    root = null
    vi.useRealTimers()
    useMissionStore.setState({ phase: 'idle' })
    useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState())
  })

  it('waits out the grace period, then says it once', () => {
    useMissionStore.setState({ phase: 'active' })
    const result = renderHeadline()
    expect(result.current.issues).not.toContain(LINE)
    act(() => { vi.advanceTimersByTime(119_000) })
    expect(result.current.issues).not.toContain(LINE)
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(result.current.issues).toContain(LINE)
    expect(result.current.problems).toContain('1 not-moving off')
  })

  it('says nothing before a mission is running', () => {
    const result = renderHeadline()
    act(() => { vi.advanceTimersByTime(10 * 60_000) })
    expect(result.current.issues).not.toContain(LINE)
  })
})
