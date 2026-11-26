import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMissionStore } from '../../src/features/mission/mission-store'
import { useStationaryAttentionStore } from '../../src/features/tracking/stationary-attention-store'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'
import type { NormalizedTrackingPosition, TrackingConnectionStatus, TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import { useTrackingHeadline } from '../../src/features/workspace/tracking-headline'

const START = Date.parse('2026-11-26T10:00:00.000Z')
const LINE = 'Not-moving warnings are off for 1 person: their trail is not being recorded'
const online: TrackingConnectionStatus = { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null }

function fix(id: string, minutes: number): NormalizedTrackingPosition {
  return {
    id, device_id: 'one', lat: 52, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: 4,
    timestamp: new Date(START + minutes * 60_000).toISOString(), timestamp_source: 'fix', source: 'osmand',
    data_origin: 'live', cache_age_seconds: null, device_cache_stale: false,
  }
}

const device = { device_id: 'one', name: 'one', status: 'online', last_seen: null, unique_id: null, category: null } as const

let root: Root | null = null
let latest: ReturnType<typeof useTrackingHeadline> | null = null

/** Keeps the hook's latest value for the assertions. */
function record(headline: ReturnType<typeof useTrackingHeadline>): null {
  latest = headline
  return null
}

/** Publishes a snapshot the way the runtime does, through the tracking store. */
function publish(kept: readonly NormalizedTrackingPosition[], current: NormalizedTrackingPosition): void {
  const snapshot: TrackingSnapshot = { devices: [device], positions: [current], breadcrumbs: kept }
  act(() => {
    useTrackingStore.setState({ snapshot })
    useStationaryAttentionStore.getState().applySnapshot(snapshot, 'mission-1')
  })
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

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('the not-moving-off line, driven through the stores [DON-384]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    useTrackingStore.setState({ status: online })
    useMissionStore.setState({ phase: 'active' })
  })
  afterEach(() => {
    act(() => { root?.unmount() })
    root = null
    vi.useRealTimers()
    useMissionStore.setState({ phase: 'idle' })
    useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState())
  })

  it('appears after two minutes with one kept fix, even with an unsaved newer live fix, and says it once', () => {
    const result = renderHeadline()
    publish([fix('a', 0)], fix('b', 1))
    advance(119_000)
    expect(result.current.issues).not.toContain(LINE)
    advance(2_000)
    expect(result.current.issues.filter((issue) => issue === LINE)).toHaveLength(1)
    expect(result.current.problems).toContain('1 not-moving off')
  })

  it('clears when a second fix is kept', () => {
    const result = renderHeadline()
    publish([fix('a', 0)], fix('a', 0))
    advance(121_000)
    expect(result.current.issues).toContain(LINE)
    publish([fix('a', 0), fix('b', 1)], fix('b', 1))
    expect(result.current.issues).not.toContain(LINE)
  })

  it('is not delayed when the wall clock is set back', () => {
    const result = renderHeadline()
    publish([fix('a', 0)], fix('a', 0))
    vi.setSystemTime(START - 60 * 60_000)
    advance(121_000)
    expect(result.current.issues).toContain(LINE)
  })

  it('stays quiet while paused, and restarts the wait on resume', () => {
    const result = renderHeadline()
    publish([fix('a', 0)], fix('a', 0))
    act(() => { useMissionStore.setState({ phase: 'paused' }) })
    advance(10 * 60_000)
    expect(result.current.issues).not.toContain(LINE)
    act(() => { useMissionStore.setState({ phase: 'active' }) })
    advance(119_000)
    expect(result.current.issues).not.toContain(LINE)
    advance(2_000)
    expect(result.current.issues).toContain(LINE)
  })

  it('stays quiet while tracking is not connected', () => {
    const result = renderHeadline()
    publish([fix('a', 0)], fix('a', 0))
    act(() => { useTrackingStore.setState({ status: { ...online, mode: 'offline' } }) })
    advance(10 * 60_000)
    expect(result.current.issues).not.toContain(LINE)
  })

  it('waits two refreshes on a five-minute refresh interval', () => {
    useStationaryAttentionStore.getState().setPollInterval(5 * 60_000)
    const result = renderHeadline()
    publish([fix('a', 0)], fix('a', 0))
    advance(9 * 60_000)
    expect(result.current.issues).not.toContain(LINE)
    advance(61_000)
    expect(result.current.issues).toContain(LINE)
  })

  it('says nothing before a mission is running', () => {
    act(() => { useMissionStore.setState({ phase: 'idle' }) })
    const result = renderHeadline()
    publish([fix('a', 0)], fix('a', 0))
    advance(10 * 60_000)
    expect(result.current.issues).not.toContain(LINE)
  })
})
