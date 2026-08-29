import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { registerMissionReplayQueryIpcHandlers } = require(
  '../../electron/mission-replay-query-ipc.cjs',
) as {
  readonly registerMissionReplayQueryIpcHandlers: (input: {
    readonly ipcMain: {
      readonly handle: (
        channel: string,
        handler: (event: unknown, ...args: readonly unknown[]) => unknown,
      ) => void
    }
    readonly readChannels: {
      readonly state: string
      readonly trackChunk: string
      readonly objectChunk: string
      readonly filterPage?: string
    }
    readonly cancelChannel: string
    readonly missionStore: {
      readonly readMissionReplay: (query: unknown, requestId: string) => Promise<unknown>
      readonly readMissionReplayFilterPage: (query: unknown, requestId: string) => Promise<unknown>
      readonly readMissionReplayTrackChunk: (
        query: unknown,
        requestId: string,
      ) => Promise<unknown>
      readonly readMissionReplayObjectChunk: (
        query: unknown,
        requestId: string,
      ) => Promise<unknown>
      readonly readMissionReplayFilterPage?: (
        query: unknown,
        requestId: string,
      ) => Promise<unknown>
      readonly cancelMissionReplay: (requestId: string) => Promise<boolean>
    }
    readonly validateIpcSender: (event: unknown) => void
  }) => void
}

describe('Mission Replay query IPC ownership [DON-278]', () => {
  it('loads in Electron sandboxed preload and projects Replay without local require access', async () => {
    const preload = readFileSync('electron/preload.cjs', 'utf8')
    const invoke = vi.fn().mockResolvedValue({ tracks: [] })
    let exposedBridge: Record<string, unknown> | undefined

    expect(() => runInNewContext(preload, {
      TextEncoder,
      require: (specifier: string) => {
        if (specifier !== 'electron') {
          throw new Error(`Sandboxed preload cannot require ${specifier}.`)
        }
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, bridge: Record<string, unknown>) => {
              exposedBridge = bridge
            },
          },
          ipcRenderer: {
            invoke,
            on: vi.fn(),
            removeListener: vi.fn(),
            send: vi.fn(),
          },
        }
      },
      window: { addEventListener: vi.fn() },
    })).not.toThrow()

    const missionStore = exposedBridge?.missionStore as {
      readonly readMissionReplay: (query: unknown, requestId: string) => Promise<unknown>
      readonly readMissionReplayTrackChunk: (query: unknown, requestId: string) => Promise<unknown>
      readonly readMissionReplayObjectChunk: (query: unknown, requestId: string) => Promise<unknown>
      readonly readMissionReplayFilterPage: (query: unknown, requestId: string) => Promise<unknown>
      readonly cancelMissionReplay: (requestId: string) => Promise<unknown>
      readonly upsertMarker: (input: unknown) => Promise<unknown>
      readonly upsertDrawing: (input: unknown) => Promise<unknown>
      readonly deleteMarker: (markerId: unknown) => Promise<unknown>
      readonly deleteDrawing: (drawingId: unknown) => Promise<unknown>
      readonly listGpxImportPage: (input: unknown) => Promise<unknown>
      readonly importGpxEvidencePaths: (input: unknown) => Promise<unknown>
      readonly assignGpxImportToOuting: (input: unknown) => Promise<unknown>
      readonly listGpxImportIssues: (input: unknown) => Promise<unknown>
      readonly listGpxImportRevisionPage: (input: unknown) => Promise<unknown>
      readonly updateGpxImportPresentation: (input: unknown) => Promise<unknown>
      readonly upsertSearchArea: (input: unknown) => Promise<unknown>
      readonly upsertSearchAssignment: (input: unknown) => Promise<unknown>
      readonly upsertSearchPass: (input: unknown) => Promise<unknown>
      readonly listSearchOperationPage: (input: unknown) => Promise<unknown>
    }
    expect(missionStore).not.toHaveProperty('listSearchAreas')
    expect(missionStore).not.toHaveProperty('listSearchAssignments')
    expect(missionStore).not.toHaveProperty('listSearchPasses')
    await missionStore.readMissionReplay({
      missionId: 'mission-1',
      selectedTime: '2026-08-28T12:00:00Z',
      trackLimit: 100,
      rendererControlledBlob: 'x'.repeat(64 * 1024 * 1024),
    }, 'bounded-query')

    expect(invoke).toHaveBeenCalledWith(
      'sartracker:mission-store:read-mission-replay',
      {
        missionId: 'mission-1',
        selectedTime: '2026-08-28T12:00:00Z',
        trackLimit: 100,
      },
      'bounded-query',
    )
    await missionStore.readMissionReplayFilterPage({
      missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00Z', trackLimit: 100,
      filterKind: 'outing', filterSearch: 'Team', filterLimit: 100,
      rendererControlledBlob: 'x'.repeat(64 * 1024 * 1024),
    }, 'bounded-filter-query')
    expect(invoke).toHaveBeenLastCalledWith(
      'sartracker:mission-store:read-mission-replay-filter-page',
      {
        missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00Z', trackLimit: 100,
        filterKind: 'outing', filterSearch: 'Team', filterLimit: 100,
      },
      'bounded-filter-query',
    )
    await missionStore.readMissionReplayTrackChunk({
      missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00Z',
      trackLimit: 100, cursor: 'bounded-cursor',
    }, 'bounded-track-query')
    expect(invoke).toHaveBeenLastCalledWith(
      'sartracker:mission-store:read-mission-replay-track-chunk',
      {
        missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00Z',
        trackLimit: 100, cursor: 'bounded-cursor',
      },
      'bounded-track-query',
    )
    await missionStore.readMissionReplayObjectChunk({
      missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00Z',
      objectLimit: 100, objectCursor: 'bounded-object-cursor', replayGeneration: 1,
    }, 'bounded-object-query')
    expect(invoke).toHaveBeenLastCalledWith(
      'sartracker:mission-store:read-mission-replay-object-chunk',
      {
        missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00Z',
        objectLimit: 100, objectCursor: 'bounded-object-cursor', replayGeneration: 1,
      },
      'bounded-object-query',
    )
    await missionStore.cancelMissionReplay('bounded-cancel-query')
    expect(invoke).toHaveBeenLastCalledWith(
      'sartracker:mission-store:cancel-mission-replay',
      'bounded-cancel-query',
    )

    const replayQuery = {
      missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00Z', trackLimit: 100,
    }
    const requestIdCalls: readonly ((requestId: string) => Promise<unknown>)[] = [
      (requestId) => missionStore.readMissionReplay(replayQuery, requestId),
      (requestId) => missionStore.readMissionReplayTrackChunk(replayQuery, requestId),
      (requestId) => missionStore.readMissionReplayObjectChunk(replayQuery, requestId),
      (requestId) => missionStore.readMissionReplayFilterPage({
        ...replayQuery, filterKind: 'outing', filterLimit: 100,
      }, requestId),
      (requestId) => missionStore.cancelMissionReplay(requestId),
    ]
    const invocationCountBeforeRequestIdAttacks = invoke.mock.calls.length
    const invalidRequestIds = [
      '', '../request', 42 as unknown as string, 'x'.repeat(64 * 1024 * 1024),
    ]
    for (const invalidRequestId of invalidRequestIds) {
      for (const call of requestIdCalls) {
        expect(() => call(invalidRequestId)).toThrow(/Replay request ID is invalid/u)
      }
    }
    expect(invoke).toHaveBeenCalledTimes(invocationCountBeforeRequestIdAttacks)

    const invocationCountBeforeUtf8Attacks = invoke.mock.calls.length
    expect(() => missionStore.readMissionReplay({
      missionId: 'é'.repeat(101),
      selectedTime: '2026-08-28T12:00:00Z',
      trackLimit: 100,
    }, 'bounded-utf8-query')).toThrow(/Mission replay missionId is invalid/u)
    expect(() => missionStore.readMissionReplay({
      missionId: 'mission-1',
      selectedTime: '2026-08-28T12:00:00Z',
      outingIds: ['é'.repeat(101)],
      trackLimit: 100,
    }, 'bounded-utf8-filter')).toThrow(/Mission replay outingIds is invalid/u)
    expect(invoke).toHaveBeenCalledTimes(invocationCountBeforeUtf8Attacks)

    await missionStore.upsertMarker({
      mission_id: 'mission-1',
      type: 'clue',
      name: 'Bounded clue',
      description: 'Visible evidence',
      lat: 52,
      lon: -9.7,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 0,
      rendererControlledBlob: 'x'.repeat(64 * 1024 * 1024),
    })
    const markerPayload = invoke.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(markerPayload).toMatchObject({
      mission_id: 'mission-1', type: 'clue', name: 'Bounded clue', description: 'Visible evidence',
    })
    expect(markerPayload).not.toHaveProperty('rendererControlledBlob')

    const accumulatedTreatment = 'Treatment evidence.\n\n'.repeat(500)
    await missionStore.upsertMarker({
      mission_id: 'mission-1',
      type: 'casualty',
      name: 'Casualty Alpha',
      condition: 'Stable',
      treatment: accumulatedTreatment,
      evacuation_priority: 'Priority 2',
      lat: 52,
      lon: -9.7,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 0,
    })
    expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ treatment: accumulatedTreatment })
    await expect(missionStore.upsertMarker({
      mission_id: 'mission-1',
      type: 'casualty',
      name: 'Oversized treatment',
      treatment: 'x'.repeat(512 * 1_024 + 1),
      lat: 52,
      lon: -9.7,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 0,
    })).rejects.toThrow(/marker treatment.*invalid/i)

    await expect(missionStore.upsertMarker({
      mission_id: 'mission-1',
      type: 'clue',
      name: 'Oversized clue',
      description: 'x'.repeat(512 * 1024 + 1),
      lat: 52,
      lon: -9.7,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 0,
    })).rejects.toThrow(/marker description.*invalid/i)

    await expect(missionStore.upsertDrawing({
      mission_id: 'mission-1',
      type: 'line',
      name: 'Oversized line',
      display_order: 0,
      geometry_json: 'x'.repeat(512 * 1024 + 1),
    })).rejects.toThrow(/drawing geometry.*invalid/i)

    await expect(missionStore.deleteMarker('m'.repeat(64 * 1024 * 1024)))
      .rejects.toThrow(/marker identity.*invalid/i)
    await expect(missionStore.deleteDrawing('d'.repeat(64 * 1024 * 1024)))
      .rejects.toThrow(/drawing identity.*invalid/i)
    expect(invoke).not.toHaveBeenCalledWith(
      'sartracker:mission-store:delete-marker',
      expect.anything(),
    )
    expect(invoke).not.toHaveBeenCalledWith(
      'sartracker:mission-store:delete-drawing',
      expect.anything(),
    )

    const oversizedUnknown = 'x'.repeat(32 * 1024 * 1024)
    await missionStore.listGpxImportPage({
      missionId: 'mission-1', limit: 25, rendererControlledBlob: oversizedUnknown,
    })
    expect(invoke).toHaveBeenLastCalledWith(
      'sartracker:mission-store:list-gpx-import-page',
      { missionId: 'mission-1', limit: 25 },
    )
    await missionStore.upsertSearchPass({
      mission_id: 'mission-1', search_area_id: 'area-1', assignment_id: 'assignment-1',
      started_at: '2026-08-28T10:00:00.000Z', ended_at: '2026-08-28T10:30:00.000Z',
      outcome: 'partial', coordinator_name: 'Coordinator', rendererControlledBlob: oversizedUnknown,
    })
    expect(invoke.mock.calls.at(-1)?.[1]).not.toHaveProperty('rendererControlledBlob')
    await missionStore.listSearchOperationPage({
      missionId: 'mission-1', kind: 'passes', search: 'Team', limit: 25,
      rendererControlledBlob: oversizedUnknown,
    })
    expect(invoke).toHaveBeenLastCalledWith(
      'sartracker:mission-store:list-search-operation-page',
      { missionId: 'mission-1', kind: 'passes', search: 'Team', limit: 25 },
    )
    await expect(missionStore.importGpxEvidencePaths({
      missionId: 'mission-1', paths: ['/field/' + 'x'.repeat(5_000)],
    })).rejects.toThrow(/GPX evidence paths.*invalid/i)
    await expect(missionStore.upsertSearchPass({
      mission_id: 'mission-1', search_area_id: 'area-1', assignment_id: 'assignment-1',
      started_at: '2026-08-28T10:00:00.000Z', ended_at: '2026-08-28T10:30:00.000Z',
      outcome: 'partial', coordinator_name: 'Coordinator',
      advisory_coverage_json: 'x'.repeat(512 * 1024 + 1),
    })).rejects.toThrow(/Search pass advisory coverage.*invalid/i)

    const boundedCalls: readonly [
      (input: unknown) => Promise<unknown>,
      Readonly<Record<string, unknown>>,
    ][] = [
      [missionStore.assignGpxImportToOuting, {
        import_id: 'gpx-1', outing_id: 'outing-1', assigned_by: 'Coordinator',
      }],
      [missionStore.listGpxImportIssues, { missionId: 'mission-1', limit: 25 }],
      [missionStore.listGpxImportRevisionPage, { importId: 'gpx-1', limit: 25 }],
      [missionStore.updateGpxImportPresentation, {
        id: 'gpx-1', mission_id: 'mission-1', display_name: 'Team track',
      }],
      [missionStore.upsertSearchArea, {
        mission_id: 'mission-1', name: 'Area Alpha', status: 'active',
        geometry_json: '{"type":"Polygon","coordinates":[]}', updated_by: 'Coordinator',
      }],
      [missionStore.upsertSearchAssignment, {
        mission_id: 'mission-1', search_area_id: 'area-1', outing_id: 'outing-1',
        team_id: 'Team Alpha', participant_ids: ['participant-1'], updated_by: 'Coordinator',
      }],
    ]
    for (const [call, input] of boundedCalls) {
      await call({ ...input, rendererControlledBlob: oversizedUnknown })
      expect(invoke.mock.calls.at(-1)?.[1]).not.toHaveProperty('rendererControlledBlob')
    }
    const listGpxDirectoryPaths = exposedBridge?.listGpxDirectoryPaths as (path: string) => Promise<unknown>
    expect(() => listGpxDirectoryPaths('/field/' + 'x'.repeat(5_000)))
      .toThrow(/GPX directory path.*invalid/i)
  })

  it('projects renderer queries before main dispatch and preload worker cloning', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const missionStore = {
      readMissionReplay: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayTrackChunk: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayObjectChunk: vi.fn().mockResolvedValue({ objects: [] }),
      cancelMissionReplay: vi.fn().mockResolvedValue(false),
    }
    registerMissionReplayQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannels: { state: 'state', trackChunk: 'trackChunk', objectChunk: 'objectChunk' },
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 12 })

    await handlers.get('state')?.({ sender }, {
      missionId: 'mission-1',
      selectedTime: '2026-08-28T12:00:00Z',
      trackLimit: 100,
      rendererControlledBlob: 'x'.repeat(1024 * 1024),
    }, 'bounded-query')

    expect(missionStore.readMissionReplay).toHaveBeenCalledWith({
      missionId: 'mission-1',
      selectedTime: '2026-08-28T12:00:00.000Z',
      trackLimit: 100,
      objectLimit: 100,
      deviceIds: null,
      outingIds: null,
      timezone: 'Europe/Dublin',
    }, '12:mission-replay:bounded-query')
  })

  it('owns bounded Replay filter-choice page IPC on the same cancellable worker lane', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const readMissionReplayFilterPage = vi.fn().mockResolvedValue({
      filterKind: 'outing', entries: ['outing-1'], totalCount: 1, nextCursor: null,
    })
    const missionStore = {
      readMissionReplay: vi.fn(),
      readMissionReplayTrackChunk: vi.fn(),
      readMissionReplayObjectChunk: vi.fn(),
      readMissionReplayFilterPage,
      cancelMissionReplay: vi.fn().mockResolvedValue(false),
    }
    registerMissionReplayQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannels: {
        state: 'state', trackChunk: 'trackChunk', objectChunk: 'objectChunk',
        filterPage: 'filterPage',
      },
      cancelChannel: 'cancel', missionStore, validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 18 })

    await handlers.get('filterPage')?.({ sender }, {
      missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00Z', trackLimit: 100,
      filterKind: 'outing', filterSearch: 'Team', filterLimit: 100,
      rendererControlledBlob: 'x'.repeat(1024 * 1024),
    }, 'filter-page-1')

    expect(readMissionReplayFilterPage).toHaveBeenCalledWith(expect.objectContaining({
      missionId: 'mission-1', selectedTime: '2026-08-28T12:00:00.000Z',
      filterKind: 'outing', filterSearch: 'Team', filterLimit: 100,
    }), '18:mission-replay:filter-page-1')
  })

  it.each([
    ['state', 'readMissionReplay', 'destroyed'],
    ['state', 'readMissionReplay', 'render-process-gone'],
    ['trackChunk', 'readMissionReplayTrackChunk', 'destroyed'],
    ['trackChunk', 'readMissionReplayTrackChunk', 'render-process-gone'],
    ['objectChunk', 'readMissionReplayObjectChunk', 'destroyed'],
    ['objectChunk', 'readMissionReplayObjectChunk', 'render-process-gone'],
  ] as const)(
    'cancels a renderer-owned %s worker through %s on %s without exposing its request ID',
    async (channel, methodName, teardownEvent) => {
      const handlers = new Map<
        string,
        (event: unknown, ...args: readonly unknown[]) => unknown
      >()
      let rejectQuery: (error: Error) => void = () => undefined
      const query = new Promise((_resolve, reject) => {
        rejectQuery = reject
      })
      const readMissionReplay = vi.fn().mockReturnValue(query)
      const readMissionReplayTrackChunk = vi.fn().mockReturnValue(query)
      const readMissionReplayObjectChunk = vi.fn().mockReturnValue(query)
      const cancelMissionReplay = vi.fn().mockImplementation(async (requestId: string) => {
        if (requestId === '41:mission-replay:request-1') {
          rejectQuery(new Error('destroyed Replay worker terminated'))
          return true
        }
        return false
      })
      const missionStore = {
        readMissionReplay,
        readMissionReplayTrackChunk,
        readMissionReplayObjectChunk,
        cancelMissionReplay,
      }
      registerMissionReplayQueryIpcHandlers({
        ipcMain: { handle: (registeredChannel, handler) => {
          handlers.set(registeredChannel, handler)
        } },
        readChannels: {
          state: 'state',
          trackChunk: 'trackChunk',
          objectChunk: 'objectChunk',
        },
        cancelChannel: 'cancel',
        missionStore,
        validateIpcSender: vi.fn(),
      })
      const senderA = Object.assign(new EventEmitter(), { id: 41 })
      const senderB = Object.assign(new EventEmitter(), { id: 42 })
      const input = {
        missionId: 'mission-1',
        selectedTime: '2026-08-28T12:00:00Z',
        trackLimit: 100,
        ...(channel === 'objectChunk' ? { replayGeneration: 0 } : {}),
      }
      const expectedInput = expect.objectContaining({
        missionId: 'mission-1',
        selectedTime: '2026-08-28T12:00:00.000Z',
        trackLimit: 100,
      })

      const readResult = Promise.resolve(
        handlers.get(channel)?.({ sender: senderA }, input, 'request-1'),
      )
      const readRejection = expect(readResult).rejects.toThrow(/terminated/u)
      expect(missionStore[methodName]).toHaveBeenCalledWith(
        expectedInput,
        '41:mission-replay:request-1',
      )
      expect(senderA.listenerCount('destroyed')).toBe(1)
      expect(senderA.listenerCount('render-process-gone')).toBe(1)

      await expect(
        handlers.get('cancel')?.({ sender: senderB }, 'request-1'),
      ).resolves.toBe(false)
      expect(cancelMissionReplay).toHaveBeenLastCalledWith(
        '42:mission-replay:request-1',
      )

      senderA.emit(teardownEvent)
      await readRejection
      expect(cancelMissionReplay).toHaveBeenCalledWith(
        '41:mission-replay:request-1',
      )
      expect(senderA.listenerCount('destroyed')).toBe(0)
      expect(senderA.listenerCount('render-process-gone')).toBe(0)
    },
  )

  it('removes renderer lifecycle listeners after every Replay read completes', async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: readonly unknown[]) => unknown
    >()
    const missionStore = {
      readMissionReplay: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayTrackChunk: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayObjectChunk: vi.fn().mockResolvedValue({ objects: [] }),
      cancelMissionReplay: vi.fn().mockResolvedValue(false),
    }
    registerMissionReplayQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannels: {
        state: 'state',
        trackChunk: 'trackChunk',
        objectChunk: 'objectChunk',
      },
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 77 })

    for (const channel of ['state', 'trackChunk', 'objectChunk']) {
      await handlers.get(channel)?.(
        { sender },
        {
          missionId: 'mission-1',
          selectedTime: '2026-08-28T12:00:00Z',
          trackLimit: 100,
          ...(channel === 'objectChunk' ? { replayGeneration: 0 } : {}),
        },
        `request-${channel}`,
      )
      expect(sender.listenerCount('destroyed')).toBe(0)
      expect(sender.listenerCount('render-process-gone')).toBe(0)
    }

    sender.emit('destroyed')
    expect(missionStore.cancelMissionReplay).not.toHaveBeenCalled()
  })

  it('rejects invalid renderer and request identities before starting Replay work', async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: readonly unknown[]) => unknown
    >()
    const missionStore = {
      readMissionReplay: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayTrackChunk: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayObjectChunk: vi.fn().mockResolvedValue({ objects: [] }),
      cancelMissionReplay: vi.fn().mockResolvedValue(false),
    }
    registerMissionReplayQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannels: {
        state: 'state',
        trackChunk: 'trackChunk',
        objectChunk: 'objectChunk',
      },
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })

    await expect(
      handlers.get('state')?.(
        { sender: Object.assign(new EventEmitter(), { id: -1 }) },
        { missionId: 'mission-1' },
        'request-1',
      ),
    ).rejects.toThrow(/sender ID is invalid/u)
    await expect(
      handlers.get('state')?.(
        { sender: Object.assign(new EventEmitter(), { id: 1 }) },
        { missionId: 'mission-1' },
        '../request',
      ),
    ).rejects.toThrow(/request ID is invalid/u)
    expect(missionStore.readMissionReplay).not.toHaveBeenCalled()
  })
})
