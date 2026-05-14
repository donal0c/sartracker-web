import { describe, expect, it, vi } from 'vitest'

import {
  startCoreFeatureRuntimes,
  type CoreFeatureRuntimeMissionStore,
} from '../../src/features/runtime/start-core-feature-runtimes'
import type { MarkerAttachmentBoundary } from '../../src/infrastructure/marker-attachment-store/marker-attachment-boundary'

describe('startCoreFeatureRuntimes', () => {
  it('registers the six feature controllers in the documented order', async () => {
    const callOrder: string[] = []

    const startMissionRuntime = vi.fn(async () => {
      callOrder.push('mission')
      return { __id: 'mission' } as never
    })
    const startMissionGovernanceRuntime = vi.fn(async () => {
      callOrder.push('governance')
      return { __id: 'governance' } as never
    })
    const startMarkerRuntime = vi.fn(async () => {
      callOrder.push('marker')
      return { __id: 'marker' } as never
    })
    const startDrawingRuntime = vi.fn(async () => {
      callOrder.push('drawing')
      return { __id: 'drawing' } as never
    })
    const startHelicopterRuntime = vi.fn(async () => {
      callOrder.push('helicopter')
      return { __id: 'helicopter' } as never
    })
    const startGpxRuntime = vi.fn(async () => {
      callOrder.push('gpx')
      return { __id: 'gpx' } as never
    })

    await startCoreFeatureRuntimes({
      missionStore: createMissionStoreStub(),
      attachmentAdapter: createAttachmentStub(),
      startMissionRuntime,
      startMissionGovernanceRuntime,
      startMarkerRuntime,
      startDrawingRuntime,
      startHelicopterRuntime,
      startGpxRuntime,
    })

    expect(callOrder).toEqual([
      'mission',
      'governance',
      'marker',
      'drawing',
      'helicopter',
      'gpx',
    ])
  })

  it('passes the mission store to all six controllers', async () => {
    const missionStore = createMissionStoreStub()
    const attachmentAdapter = createAttachmentStub()
    const startMissionRuntime = vi.fn(async () => ({}) as never)
    const startMissionGovernanceRuntime = vi.fn(async () => ({}) as never)
    const startMarkerRuntime = vi.fn(async () => ({}) as never)
    const startDrawingRuntime = vi.fn(async () => ({}) as never)
    const startHelicopterRuntime = vi.fn(async () => ({}) as never)
    const startGpxRuntime = vi.fn(async () => ({}) as never)

    await startCoreFeatureRuntimes({
      missionStore,
      attachmentAdapter,
      startMissionRuntime,
      startMissionGovernanceRuntime,
      startMarkerRuntime,
      startDrawingRuntime,
      startHelicopterRuntime,
      startGpxRuntime,
    })

    expect(startMissionRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ missionStore }),
    )
    expect(startMissionGovernanceRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ missionStore }),
    )
    expect(startMarkerRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        markerStore: missionStore,
        attachmentStore: attachmentAdapter,
      }),
    )
    expect(startDrawingRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ drawingStore: missionStore }),
    )
    expect(startHelicopterRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ helicopterStore: missionStore }),
    )
    expect(startGpxRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ gpxStore: missionStore }),
    )
  })

  it('omits watchSource entirely when no gpxWatchSource is provided', async () => {
    const startGpxRuntime = vi.fn(async () => ({}) as never)

    await startCoreFeatureRuntimes({
      missionStore: createMissionStoreStub(),
      attachmentAdapter: createAttachmentStub(),
      startMissionRuntime: vi.fn(async () => ({}) as never),
      startMissionGovernanceRuntime: vi.fn(async () => ({}) as never),
      startMarkerRuntime: vi.fn(async () => ({}) as never),
      startDrawingRuntime: vi.fn(async () => ({}) as never),
      startHelicopterRuntime: vi.fn(async () => ({}) as never),
      startGpxRuntime,
    })

    const call = startGpxRuntime.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call).toBeDefined()
    expect('watchSource' in call).toBe(false)
  })

  it('forwards a real gpxWatchSource to the GPX runtime when provided', async () => {
    const startGpxRuntime = vi.fn(async () => ({}) as never)
    const gpxWatchSource = { listDirectoryFiles: vi.fn(async () => []) }

    await startCoreFeatureRuntimes({
      missionStore: createMissionStoreStub(),
      attachmentAdapter: createAttachmentStub(),
      gpxWatchSource,
      startMissionRuntime: vi.fn(async () => ({}) as never),
      startMissionGovernanceRuntime: vi.fn(async () => ({}) as never),
      startMarkerRuntime: vi.fn(async () => ({}) as never),
      startDrawingRuntime: vi.fn(async () => ({}) as never),
      startHelicopterRuntime: vi.fn(async () => ({}) as never),
      startGpxRuntime,
    })

    expect(startGpxRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ watchSource: gpxWatchSource }),
    )
  })

  it('returns a callable disposer for the registered core runtimes', async () => {
    const handles = await startCoreFeatureRuntimes({
      missionStore: createMissionStoreStub(),
      attachmentAdapter: createAttachmentStub(),
      startMissionRuntime: vi.fn(async () => ({}) as never),
      startMissionGovernanceRuntime: vi.fn(async () => ({}) as never),
      startMarkerRuntime: vi.fn(async () => ({}) as never),
      startDrawingRuntime: vi.fn(async () => ({}) as never),
      startHelicopterRuntime: vi.fn(async () => ({}) as never),
      startGpxRuntime: vi.fn(async () => ({}) as never),
    })

    expect(typeof handles.dispose).toBe('function')
    expect(() => handles.dispose()).not.toThrow()
  })
})

function createMissionStoreStub(): CoreFeatureRuntimeMissionStore {
  return {
    createMission: vi.fn(),
    listMissions: vi.fn(),
    getRecoverableMission: vi.fn(async () => null),
    pauseMission: vi.fn(),
    resumeMission: vi.fn(),
    finishMission: vi.fn(),
    finalizeMission: vi.fn(),
    unlockFinalizedMission: vi.fn(),
    listMarkers: vi.fn(),
    upsertMarker: vi.fn(),
    deleteMarker: vi.fn(),
    listDrawings: vi.fn(),
    upsertDrawing: vi.fn(),
    deleteDrawing: vi.fn(),
    listHelicopters: vi.fn(),
    upsertHelicopter: vi.fn(),
    deleteHelicopter: vi.fn(),
    listGpxImports: vi.fn(),
    upsertGpxImport: vi.fn(),
    deleteGpxImport: vi.fn(),
  } as unknown as CoreFeatureRuntimeMissionStore
}

function createAttachmentStub(): MarkerAttachmentBoundary {
  return {
    ingest: vi.fn(async () => ({ storedPath: '', fileName: '' })),
  }
}
