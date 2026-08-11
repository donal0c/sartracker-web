import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMissionStore } from '../../src/features/mission/mission-store'
import { useActiveMissionDevicesStore } from '../../src/features/tracking/active-mission-devices-store'
import { useExactBreadcrumbDotStore } from '../../src/features/tracking/exact-breadcrumb-dot-store'
import { useTrackingStyleStore } from '../../src/features/tracking/tracking-style-store'

type ExactDotRuntimeModule = {
  readonly startExactBreadcrumbDotRuntime: (missionStore: {
    readonly listExactBreadcrumbDotPage: (
      input: unknown,
      requestId?: string,
    ) => Promise<unknown>
    readonly cancelExactBreadcrumbDotQuery: (requestId: string) => Promise<boolean>
  }) => () => void
}

describe('exact breadcrumb-dot runtime request ownership', () => {
  afterEach(() => {
    useMissionStore.setState(useMissionStore.getInitialState())
    useActiveMissionDevicesStore.setState(useActiveMissionDevicesStore.getInitialState())
    useExactBreadcrumbDotStore.setState(useExactBreadcrumbDotStore.getInitialState())
    useTrackingStyleStore.setState(useTrackingStyleStore.getInitialState())
    vi.restoreAllMocks()
  })

  it('uses a fresh renderer-session request namespace after a renderer reload', async () => {
    useMissionStore.setState({
      phase: 'active',
      currentMission: {
        id: 'mission-a',
        name: 'Mission A',
        status: 'active',
        start_time: '2026-08-10T10:00:00.000Z',
        pause_time: null,
        finish_time: null,
        paused_seconds: 0,
        notes: null,
        schema_version: 1,
      },
    })
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    const requestIds: string[] = []
    const missionStore = {
      listExactBreadcrumbDotPage: vi.fn((_input: unknown, requestId?: string) => {
        if (requestId !== undefined) {
          requestIds.push(requestId)
        }
        return new Promise<never>(() => undefined)
      }),
      cancelExactBreadcrumbDotQuery: vi.fn().mockResolvedValue(true),
    }

    const firstModule = await loadRuntimeModule('renderer-a')
    const stopFirst = firstModule.startExactBreadcrumbDotRuntime(missionStore)
    await vi.waitFor(() => expect(requestIds).toHaveLength(1))
    stopFirst()

    const secondModule = await loadRuntimeModule('renderer-b')
    const stopSecond = secondModule.startExactBreadcrumbDotRuntime(missionStore)
    await vi.waitFor(() => expect(requestIds).toHaveLength(2))
    stopSecond()

    expect(requestIds[0]).toMatch(/^exact-dot-renderer-[a-f0-9]{32}-\d+-1$/u)
    expect(requestIds[1]).toMatch(/^exact-dot-renderer-[a-f0-9]{32}-\d+-1$/u)
    expect(requestIds[1]).not.toBe(requestIds[0])
  })

  it('preserves nullable source identity separately from stable stored-row identity', async () => {
    useMissionStore.setState({
      phase: 'active',
      currentMission: {
        id: 'mission-a',
        name: 'Mission A',
        status: 'active',
        start_time: '2026-08-10T10:00:00.000Z',
        pause_time: null,
        finish_time: null,
        paused_seconds: 0,
        notes: null,
        schema_version: 1,
      },
    })
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    const missionStore = {
      listExactBreadcrumbDotPage: vi.fn().mockResolvedValue({
        positions: [
          createStoredPosition('stored-source-row', 'source-8941'),
          createStoredPosition('stored-legacy-row', null),
        ],
        totalPositionCount: 2,
        pagePositionCount: 2,
        fromTimestamp: '2026-08-10T10:00:00.000Z',
        toTimestamp: '2026-08-10T10:00:05.000Z',
        hasEarlier: false,
        hasLater: false,
        earlierCursor: null,
        laterCursor: null,
      }),
      cancelExactBreadcrumbDotQuery: vi.fn().mockResolvedValue(true),
    }
    const runtime = await loadRuntimeModule('identity-semantics')

    const stop = runtime.startExactBreadcrumbDotRuntime(missionStore)
    await vi.waitFor(() => expect(useExactBreadcrumbDotStore.getState().state.status).toBe('ready'))
    const state = useExactBreadcrumbDotStore.getState().state

    expect(state).toEqual(expect.objectContaining({
      status: 'ready',
      positions: [
        expect.objectContaining({
          id: 'source-8941',
          source_position_id: 'source-8941',
        }),
        expect.objectContaining({
          id: 'stored-legacy-row',
          source_position_id: null,
        }),
      ],
    }))
    stop()
  })
})

async function loadRuntimeModule(rendererSession: string): Promise<ExactDotRuntimeModule> {
  const modulePath =
    `../../src/features/tracking/start-exact-breadcrumb-dot-runtime.ts?${rendererSession}`
  return import(/* @vite-ignore */ modulePath) as Promise<ExactDotRuntimeModule>
}

function createStoredPosition(id: string, sourcePositionId: string | null) {
  return {
    id,
    source_position_id: sourcePositionId,
    device_id: 'device-1',
    lat: 52.1,
    lon: -9.7,
    timestamp: sourcePositionId === null
      ? '2026-08-10T10:00:05.000Z'
      : '2026-08-10T10:00:00.000Z',
    data_origin: 'live',
  }
}
