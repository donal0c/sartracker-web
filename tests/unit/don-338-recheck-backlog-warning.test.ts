import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPollingManager, type TrackingHistoryChunkPersistenceInput, type TrackingPollerClient } from '../../src/features/tracking/polling-manager'
import { describeRecheckBacklogForOperator } from '../../src/features/tracking/history-gap-warning'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../src/features/tracking/tracking-types'

// [DON-338] When a device's 5-minute re-check runs out of budget it keeps a
// backlog: late-uploaded positions in those ranges may not be on the map yet.
// With no gap or failure there was no warning at all. A backlog that clears
// within a tick or two is normal, so the warning waits until the same device
// has been behind for two re-check intervals.

const ZONE = 'Europe/Dublin'
const NOW_MS = Date.parse('2026-11-21T12:00:00.000Z')

describe('[DON-338] re-check backlog wording', () => {
  it('names the device and range in plain words', () => {
    expect(describeRecheckBacklogForOperator(
      [{ deviceId: '1', deviceName: 'Alpha', from: '2026-11-21T08:00:00.000Z', to: '2026-11-21T11:00:00.000Z' }],
      NOW_MS,
      ZONE,
    )).toBe(
      'Breadcrumb history re-check is running behind for Alpha: 08:00–11:00; late-uploaded positions from that time may not be on the map yet. The re-check continues by itself.',
    )
  })

  it('bounds many ranges and words the paused case truthfully', () => {
    expect(describeRecheckBacklogForOperator(
      [
        { deviceId: '1', deviceName: 'Alpha', from: '2026-11-21T08:00:00.000Z', to: '2026-11-21T09:00:00.000Z' },
        { deviceId: '2', deviceName: 'Bravo', from: '2026-11-21T08:00:00.000Z', to: '2026-11-21T09:00:00.000Z' },
        { deviceId: '3', deviceName: 'Charlie', from: '2026-11-21T08:00:00.000Z', to: '2026-11-21T09:00:00.000Z' },
        { deviceId: '4', deviceName: 'Delta', from: '2026-11-21T08:00:00.000Z', to: '2026-11-21T09:00:00.000Z' },
      ],
      NOW_MS,
      ZONE,
      'suspended',
    )).toBe(
      'Breadcrumb history re-check is running behind for Alpha: 08:00–09:00; Bravo: 08:00–09:00; Charlie: 08:00–09:00; and 1 more range; late-uploaded positions from those times may not be on the map yet. The re-check continues when live tracking resumes.',
    )
    expect(describeRecheckBacklogForOperator([], NOW_MS, ZONE)).toBeNull()
  })
})

describe('[DON-338] re-check backlog warning through the real poller and reconciler', () => {
  // A day of history: more than one slow tick can re-read.
  const START_MS = Date.parse('2026-11-20T08:00:00.000Z')
  const POLL_START_MS = Date.parse('2026-11-21T11:00:00.000Z')
  const DEVICE: NormalizedTrackingDevice = {
    device_id: '1',
    name: 'Alpha',
    status: 'online',
    last_seen: null,
    unique_id: 'alpha',
    category: null,
  }
  const BEHIND = /^Breadcrumb history re-check is running behind for Alpha: [^;]+(; and \d+ more ranges?)?; late-uploaded positions from (that time|those times) may not be on the map yet\. The re-check continues by itself\.$/u

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(POLL_START_MS)
  })
  afterEach(() => { vi.useRealTimers() })

  /** Starts a poller whose history requests take `server.delayMs` each. */
  function startPoller(server: { delayMs: number }, mission: { pollingMode: 'active' | 'paused' }) {
    const onStatusChange = vi.fn()
    const onPollDiagnostic = vi.fn()
    const client: TrackingPollerClient = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn().mockResolvedValue([DEVICE]),
      getCurrentPositions: vi.fn().mockResolvedValue([] as readonly NormalizedTrackingPosition[]),
      getBreadcrumbs: vi.fn(async () => {
        if (server.delayMs > 0) await new Promise((resolve) => { setTimeout(resolve, server.delayMs) })
        return [] as readonly NormalizedTrackingPosition[]
      }),
    }
    const poller = createPollingManager(client, {
      intervalMs: 60 * 60 * 1000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getPollingMode: () => mission.pollingMode,
      getInitialBreadcrumbFrom: () => new Date(START_MS),
      getInitialBreadcrumbs: async () => [],
      // Answers as the store does: every observation sent was kept [DON-338].
      persistHistoryChunk: vi.fn(async (input: TrackingHistoryChunkPersistenceInput) => ({ changed: false, keptPositions: input.positions })),
      onSnapshot: vi.fn(),
      onStatusChange,
      onPollDiagnostic,
      now: () => new Date(Date.now()),
    })
    const latest = () => onStatusChange.mock.calls.at(-1)?.[0] as {
      readonly mode: string
      readonly warning: string | null
      readonly warningCodes?: readonly string[]
    } | undefined
    const recheckDiagnostics = () => onPollDiagnostic.mock.calls
      .map((call) => call[0] as { readonly kind: string; readonly reconciliationPhase?: string; readonly recheckBacklog?: readonly unknown[] })
      .filter((event) => event.kind === 'breadcrumb_reconciliation' && event.reconciliationPhase === 'anti_entropy')
    return { poller, latest, recheckDiagnostics }
  }

  it('warns only once a device stays behind for two re-check intervals, and clears when it catches up', async () => {
    const server = { delayMs: 0 }
    const mission: { pollingMode: 'active' | 'paused' } = { pollingMode: 'active' }
    const { poller, latest, recheckDiagnostics } = startPoller(server, mission)
    poller.start()
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(latest()?.warning ?? '').not.toContain('running behind')

    // Every re-check request now takes 4 minutes: each tick's budget runs out.
    server.delayMs = 4 * 60 * 1000
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(recheckDiagnostics().some((event) => (event.recheckBacklog?.length ?? 0) > 0)).toBe(true)
    // Behind for less than two intervals: normal, no warning yet.
    expect(latest()?.warning ?? '').not.toContain('running behind')

    await vi.advanceTimersByTimeAsync(12 * 60 * 1000)
    expect(latest()?.mode).toBe('online')
    expect(latest()?.warning ?? '').toMatch(BEHIND)
    expect(latest()?.warningCodes).toContain('history_recheck_behind')

    server.delayMs = 0
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(latest()?.warning ?? '').not.toContain('running behind')
    poller.stop()
  })

  it('keeps the backlog warning on the paused status in its suspended wording', async () => {
    const server = { delayMs: 0 }
    const mission: { pollingMode: 'active' | 'paused' } = { pollingMode: 'active' }
    const { poller, latest } = startPoller(server, mission)
    poller.start()
    await vi.advanceTimersByTimeAsync(60 * 1000)
    server.delayMs = 4 * 60 * 1000
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
    expect(latest()?.warning ?? '').toMatch(BEHIND)

    mission.pollingMode = 'paused'
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(latest()?.mode).toBe('idle')
    expect(latest()?.warning ?? '').toMatch(
      /^Live refresh suspended while mission is paused\. Breadcrumb history re-check is running behind for Alpha: .* The re-check continues when live tracking resumes\.$/u,
    )
    poller.stop()
  })
})
