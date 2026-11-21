import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPollingManager, type TrackingPollerClient } from '../../src/features/tracking/polling-manager'
import {
  describeHistoryGapsForOperator,
  formatOperatorClockRange,
  listNamesBounded,
} from '../../src/features/tracking/history-gap-warning'
import type { BreadcrumbHistoryGap } from '../../src/features/tracking/breadcrumb-history-reconciler'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../src/features/tracking/tracking-types'

// DON-338 follow-up to piece 2: a history range Traccar cannot supply at any
// window size must be named to the operator (device, local time range, still
// retrying), raised when the 5-minute re-check finds it rather than at the
// next poll, and cleared when the range is filled.

const ZONE = 'Europe/Dublin'
const NOW_MS = Date.parse('2026-11-21T12:00:00.000Z') // 12:00 in Dublin (GMT)

/** Builds one gap record as the reconciler publishes it. */
function gap(deviceId: string, deviceName: string, from: string, to: string): BreadcrumbHistoryGap {
  return {
    deviceId,
    deviceName,
    from,
    to,
    reason: 'oversized',
    phase: 'anti_entropy',
    attempts: 3,
    lastError: 'Traccar response is too large.',
  }
}

describe('[DON-338] history gap wording', () => {
  it('formats a same-day range as local clock minutes, widened to cover the whole gap', () => {
    expect(formatOperatorClockRange(
      '2026-11-21T10:05:30.000Z',
      '2026-11-21T10:34:10.000Z',
      NOW_MS,
      ZONE,
    )).toBe('10:05–10:35')
  })

  it('adds the date when the range is not today or crosses midnight', () => {
    expect(formatOperatorClockRange(
      '2026-11-20T10:05:00.000Z',
      '2026-11-20T10:35:00.000Z',
      NOW_MS,
      ZONE,
    )).toBe('20/11/2026 10:05–10:35')
    expect(formatOperatorClockRange(
      '2026-11-20T23:50:00.000Z',
      '2026-11-21T00:20:00.000Z',
      NOW_MS,
      ZONE,
    )).toBe('20/11/2026 23:50–21/11/2026 00:20')
  })

  it('shows the UTC offset on both ends when the clocks go back inside the range', () => {
    // 00:50Z is 01:50 IST; 01:10Z is 01:10 GMT. Without offsets this would
    // read "01:50–01:10", a range that runs backwards.
    expect(formatOperatorClockRange(
      '2026-10-25T00:50:00.000Z',
      '2026-10-25T01:10:00.000Z',
      Date.parse('2026-10-25T12:00:00.000Z'),
      ZONE,
    )).toBe('01:50 (UTC+1)–01:10 (UTC+0)')
  })

  it('shows the UTC offset on both ends when the clocks go forward inside the range', () => {
    // 00:50Z is 00:50 GMT; 01:10Z is 02:10 IST: twenty minutes, not eighty.
    expect(formatOperatorClockRange(
      '2026-03-29T00:50:00.000Z',
      '2026-03-29T01:10:00.000Z',
      Date.parse('2026-03-29T12:00:00.000Z'),
      ZONE,
    )).toBe('00:50 (UTC+0)–02:10 (UTC+1)')
  })

  it('shows offsets with the date when a range across a clock change is not today', () => {
    expect(formatOperatorClockRange(
      '2026-10-25T00:50:00.000Z',
      '2026-10-25T01:10:00.000Z',
      NOW_MS,
      ZONE,
    )).toBe('25/10/2026 01:50 (UTC+1)–01:10 (UTC+0)')
  })

  it('names one gap in plain words', () => {
    expect(describeHistoryGapsForOperator(
      [gap('1', 'Alpha', '2026-11-21T10:05:00.000Z', '2026-11-21T10:35:00.000Z')],
      NOW_MS,
      ZONE,
    )).toBe(
      'Breadcrumb history incomplete for Alpha: 10:05–10:35 could not be loaded from Traccar and is missing from the map; still retrying.',
    )
  })

  it('names the first three ranges and counts the rest, never dropping them silently', () => {
    expect(describeHistoryGapsForOperator(
      [
        gap('1', 'Alpha', '2026-11-21T09:00:00.000Z', '2026-11-21T09:10:00.000Z'),
        gap('1', 'Alpha', '2026-11-21T10:05:00.000Z', '2026-11-21T10:35:00.000Z'),
        gap('2', 'Bravo', '2026-11-21T11:00:00.000Z', '2026-11-21T11:20:00.000Z'),
        gap('3', 'Charlie', '2026-11-21T08:00:00.000Z', '2026-11-21T08:05:00.000Z'),
        gap('4', 'Delta', '2026-11-21T08:00:00.000Z', '2026-11-21T08:05:00.000Z'),
      ],
      NOW_MS,
      ZONE,
    )).toBe(
      'Breadcrumb history incomplete for Alpha: 09:00–09:10, 10:05–10:35; Bravo: 11:00–11:20; and 2 more ranges could not be loaded from Traccar and are missing from the map; still retrying.',
    )
  })

  it('bounds a long device list with a count', () => {
    expect(listNamesBounded(['A', 'B'])).toBe('A, B')
    expect(listNamesBounded(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A, B, C, D, E and 2 more')
  })
})

describe('[DON-338] history gap warning through the real poller and reconciler', () => {
  const START_MS = Date.parse('2026-11-21T08:00:00.000Z')
  const POLL_START_MS = Date.parse('2026-11-21T11:00:00.000Z')
  const BAD_FROM_MS = Date.parse('2026-11-21T09:05:00.000Z')
  const BAD_TO_MS = Date.parse('2026-11-21T09:06:00.000Z')
  const DEVICE: NormalizedTrackingDevice = {
    device_id: '1',
    name: 'Alpha',
    status: 'online',
    last_seen: null,
    unique_id: 'alpha',
    category: null,
  }
  const TOO_LARGE =
    "Error invoking remote method 'sartracker:traccar-http-request': Error: Traccar response is too large."

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(POLL_START_MS)
  })
  afterEach(() => { vi.useRealTimers() })

  /** Starts a poller whose history fetches fail per `server`, polling every 30 minutes. */
  function startPoller(
    server: { mode: 'ok' | 'gap' | 'down'; hold?: Promise<void> },
    mission: { pollingMode: 'active' | 'paused'; currentFixesDown: boolean } = { pollingMode: 'active', currentFixesDown: false },
  ) {
    const onStatusChange = vi.fn()
    const getCanonicalBreadcrumbs = vi.fn(async () => ({
      positions: [] as readonly NormalizedTrackingPosition[],
      totalObservedByDevice: {},
      selectionMetadataByDevice: {},
    }))
    const onPollDiagnostic = vi.fn()
    const onSnapshot = vi.fn()
    const client: TrackingPollerClient = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn().mockResolvedValue([DEVICE]),
      // One unreadable roster row: its warning must survive history updates.
      getDevicesWithReport: vi.fn().mockResolvedValue({ accepted: [DEVICE], complete: false, rejectedCount: 1 }),
      getCurrentPositions: vi.fn(async () => {
        if (mission.currentFixesDown) throw new Error('current positions unavailable')
        return [] as readonly NormalizedTrackingPosition[]
      }),
      getBreadcrumbs: vi.fn(async (_deviceId: string, from: Date, to: Date) => {
        if (server.hold !== undefined) await server.hold
        const fromMs = from.getTime()
        const toMs = to.getTime()
        if (server.mode === 'gap' && fromMs <= BAD_TO_MS && toMs >= BAD_FROM_MS) {
          throw new Error(TOO_LARGE)
        }
        if (server.mode === 'down' && toMs - fromMs > 5 * 60 * 1000) {
          throw new Error('history endpoint unavailable')
        }
        return [] as readonly NormalizedTrackingPosition[]
      }),
    }
    const poller = createPollingManager(client, {
      // No poll between the re-checks we observe: the warning must come from
      // the re-check's own progress.
      intervalMs: 30 * 60 * 1000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getPollingMode: () => mission.pollingMode,
      getInitialBreadcrumbFrom: () => new Date(START_MS),
      getInitialBreadcrumbs: async () => [],
      persistHistoryChunk: vi.fn().mockResolvedValue({ changed: false }),
      getCanonicalBreadcrumbs,
      onPollDiagnostic,
      onSnapshot,
      onStatusChange,
      now: () => new Date(Date.now()),
    })
    const latest = () => onStatusChange.mock.calls.at(-1)?.[0] as {
      readonly mode: string
      readonly warning: string | null
      readonly warningCodes?: readonly string[]
    } | undefined
    const all = () => onStatusChange.mock.calls.map((call) => (call as unknown as [{
      readonly mode: string
      readonly warning: string | null
    }])[0])
    /** Initial-phase reconciliation outcomes reported as diagnostics. */
    const initialOutcomes = () => onPollDiagnostic.mock.calls
      .map((call) => call[0] as { readonly kind: string; readonly outcome?: string; readonly reconciliationPhase?: string })
      .filter((event) => event.kind === 'breadcrumb_reconciliation' && event.reconciliationPhase === 'initial')
      .map((event) => event.outcome)
    /** Snapshots published with a tracking-cache write (forced history flushes). */
    const cacheWritingHistoryFlushes = () => onSnapshot.mock.calls
      .filter((call) => (call[1] as { readonly suppressTrackingCache?: boolean } | undefined)?.suppressTrackingCache === false)
      .length
    return { poller, latest, all, getCanonicalBreadcrumbs, initialOutcomes, cacheWritingHistoryFlushes }
  }

  it('raises a re-check failure when the re-check publishes, not at the next poll, then clears it', async () => {
    const server: { mode: 'ok' | 'gap' | 'down' } = { mode: 'ok' }
    const { poller, latest } = startPoller(server)
    poller.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(latest()?.warning ?? '').not.toContain('Breadcrumb history incomplete')

    server.mode = 'down'
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(latest()?.mode).toBe('online')
    expect(latest()?.warning ?? '').toContain('Breadcrumb history incomplete for Alpha')
    expect(latest()?.warningCodes).toContain('history_incomplete')

    server.mode = 'ok'
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(latest()?.warning ?? '').not.toContain('Breadcrumb history incomplete')
    poller.stop()
  })

  it('names the device and missing local time range of an unfetchable gap, and clears it once filled', async () => {
    const server: { mode: 'ok' | 'gap' | 'down' } = { mode: 'gap' }
    const { poller, latest } = startPoller(server)
    poller.start()
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)

    const warning = latest()?.warning ?? ''
    expect(warning).toMatch(
      /Breadcrumb history incomplete for Alpha: \d\d:\d\d–\d\d:\d\d could not be loaded from Traccar and is missing from the map; still retrying\./u,
    )
    expect(warning).toContain('09:')
    expect(warning).toContain('DEVICE ROSTER INCOMPLETE')
    expect(latest()?.warningCodes).toContain('history_incomplete')

    server.mode = 'ok'
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(latest()?.warning ?? '').not.toContain('Breadcrumb history incomplete')
    expect(latest()?.warning ?? '').toContain('DEVICE ROSTER INCOMPLETE')
    poller.stop()
  })

  const GAP_WHILE_PAUSED =
    /^Live refresh suspended while mission is paused\. DEVICE ROSTER INCOMPLETE — 1 device entry from Traccar could not be read, so a tracker may be missing from the map\. Check the device list in Traccar\. Breadcrumb history incomplete for Alpha: \d\d:\d\d–\d\d:\d\d could not be loaded from Traccar and is missing from the map; retries resume when live tracking resumes\.$/u

  it('keeps the gap and roster warnings on the paused status while the trail stays on the map', async () => {
    const server: { mode: 'ok' | 'gap' | 'down' } = { mode: 'gap' }
    const mission: { pollingMode: 'active' | 'paused'; currentFixesDown: boolean } = { pollingMode: 'active', currentFixesDown: false }
    const { poller, latest } = startPoller(server, mission)
    poller.start()
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(latest()?.warning ?? '').toContain('Breadcrumb history incomplete for Alpha')

    mission.pollingMode = 'paused'
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(latest()?.mode).toBe('idle')
    expect(latest()?.warning ?? '').toMatch(GAP_WHILE_PAUSED)
    expect(latest()?.warningCodes).toEqual(['mission_paused', 'roster_unavailable', 'history_incomplete'])
    poller.stop()
  })

  it('keeps the gap and roster warnings on the offline status', async () => {
    const server: { mode: 'ok' | 'gap' | 'down' } = { mode: 'gap' }
    const mission: { pollingMode: 'active' | 'paused'; currentFixesDown: boolean } = { pollingMode: 'active', currentFixesDown: false }
    const { poller, latest } = startPoller(server, mission)
    poller.start()
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)

    mission.currentFixesDown = true
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(latest()?.mode).toBe('offline')
    expect(latest()?.warning ?? '').toMatch(
      /^OFFLINE MODE — no current positions received for this mission\. DEVICE ROSTER INCOMPLETE — 1 device entry from Traccar could not be read, so a tracker may be missing from the map\. Check the device list in Traccar\. Breadcrumb history incomplete for Alpha: \d\d:\d\d–\d\d:\d\d could not be loaded from Traccar and is missing from the map; still retrying\.$/u,
    )
    expect(latest()?.warningCodes).toEqual(['offline_no_positions', 'roster_unavailable', 'history_incomplete'])
    poller.stop()
  })

  it('never publishes "online" when a re-check in flight at pause settles, and reports the gap on resume', async () => {
    const server: { mode: 'ok' | 'gap' | 'down'; hold?: Promise<void> } = { mode: 'ok' }
    const mission: { pollingMode: 'active' | 'paused'; currentFixesDown: boolean } = { pollingMode: 'active', currentFixesDown: false }
    const { poller, latest, all } = startPoller(server, mission)
    poller.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(latest()?.mode).toBe('online')

    let release = (): void => undefined
    server.mode = 'gap'
    server.hold = new Promise<void>((resolve) => { release = resolve })
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    const beforePause = all().length

    // Paused before any poll has seen it: the settling re-check is the only
    // possible publisher, and the reconciler stops reporting once paused.
    mission.pollingMode = 'paused'
    server.hold = undefined
    release()
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(all().slice(beforePause).filter((status) => status.mode === 'online')).toEqual([])

    // On resume the re-check runs again and names the gap.
    mission.pollingMode = 'active'
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(latest()?.mode).toBe('online')
    expect(latest()?.warning ?? '').toMatch(/Breadcrumb history incomplete for Alpha: .* still retrying\./u)
    poller.stop()
  })

  it('keeps an already published paused status when a re-check in flight at pause settles', async () => {
    const server: { mode: 'ok' | 'gap' | 'down'; hold?: Promise<void> } = { mode: 'ok' }
    const mission: { pollingMode: 'active' | 'paused'; currentFixesDown: boolean } = { pollingMode: 'active', currentFixesDown: false }
    const { poller, latest, all } = startPoller(server, mission)
    poller.start()
    await vi.advanceTimersByTimeAsync(1_000)

    let release = (): void => undefined
    server.mode = 'gap'
    server.hold = new Promise<void>((resolve) => { release = resolve })
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)

    mission.pollingMode = 'paused'
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(latest()?.mode).toBe('idle')
    const pausedAt = all().length

    server.hold = undefined
    release()
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(all().slice(pausedAt).filter((status) => status.mode === 'online')).toEqual([])
    expect(latest()?.mode).toBe('idle')
    expect(latest()?.warning ?? '').toMatch(/^Live refresh suspended while mission is paused\./u)
    poller.stop()
  })

  it('reloads the canonical trail once every window is tried despite a permanent gap, and again when it fills', async () => {
    const server: { mode: 'ok' | 'gap' | 'down'; hold?: Promise<void> } = { mode: 'gap' }
    const { poller, latest, getCanonicalBreadcrumbs, initialOutcomes } = startPoller(server)
    poller.start()
    // Initial catch-up ends with one range Traccar can never serve; the
    // 5-minute re-check has not run yet.
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    expect(latest()?.warning ?? '').toMatch(/Breadcrumb history incomplete for Alpha: \d\d:\d\d–\d\d:\d\d could not be loaded/u)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)
    // A gapped history is never reported complete.
    expect(initialOutcomes()).not.toContain('complete')

    server.mode = 'ok'
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(latest()?.warning ?? '').not.toContain('Breadcrumb history incomplete')
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(2)
    expect(initialOutcomes().at(-1)).toBe('complete')
    poller.stop()
  })

  it('still flushes the trail and tracking cache after each 5-minute re-check sweep while a gap stays open', async () => {
    const server: { mode: 'ok' | 'gap' | 'down'; hold?: Promise<void> } = { mode: 'gap' }
    const { poller, latest, cacheWritingHistoryFlushes } = startPoller(server)
    poller.start()
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    const afterCatchUp = cacheWritingHistoryFlushes()
    expect(afterCatchUp).toBeGreaterThan(0)

    // The re-check sweeps every device; the gap is still unfillable.
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(latest()?.warning ?? '').toContain('Breadcrumb history incomplete for Alpha')
    expect(cacheWritingHistoryFlushes()).toBeGreaterThan(afterCatchUp)
    poller.stop()
  })
})
