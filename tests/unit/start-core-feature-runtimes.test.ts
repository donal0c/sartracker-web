import { describe, expect, it, vi } from 'vitest'

import {
  startCoreFeatureRuntimes,
  type CoreFeatureRuntimeMissionStore,
} from '../../src/features/runtime/start-core-feature-runtimes'
import type { MarkerAttachmentBoundary } from '../../src/infrastructure/marker-attachment-store/marker-attachment-boundary'

describe('startCoreFeatureRuntimes', () => {
  it('registers the eight feature controllers in the documented order', async () => {
    const callOrder: string[] = []

    const startMissionRuntime = vi.fn(async () => {
      callOrder.push('mission')
      return { __id: 'mission' } as never
    })
    const startMissionGovernanceRuntime = vi.fn(async () => {
      callOrder.push('governance')
      return { __id: 'governance' } as never
    })
    const startOutingRuntime = vi.fn(async () => {
      callOrder.push('outing')
      return { __id: 'outing' } as never
    })
    const startParticipantRuntime = vi.fn(async () => {
      callOrder.push('participant')
      return { __id: 'participant' } as never
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
      startOutingRuntime,
      startParticipantRuntime,
      startMarkerRuntime,
      startDrawingRuntime,
      startHelicopterRuntime,
      startGpxRuntime,
    })

    expect(callOrder).toEqual([
      'mission',
      'governance',
      'outing',
      'participant',
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
    const startOutingRuntime = vi.fn(async () => ({}) as never)
    const startParticipantRuntime = vi.fn(async () => ({}) as never)
    const startMarkerRuntime = vi.fn(async () => ({}) as never)
    const startDrawingRuntime = vi.fn(async () => ({}) as never)
    const startHelicopterRuntime = vi.fn(async () => ({}) as never)
    const startGpxRuntime = vi.fn(async () => ({}) as never)

    await startCoreFeatureRuntimes({
      missionStore,
      attachmentAdapter,
      startMissionRuntime,
      startMissionGovernanceRuntime,
      startOutingRuntime,
      startParticipantRuntime,
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
    expect(startOutingRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ outingStore: missionStore }),
    )
    expect(startParticipantRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ participantStore: missionStore }),
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

  it('keeps outing and participant runtimes inert when the internal flag is off', async () => {
    const startOutingRuntime = vi.fn(async () => ({}) as never)
    const startParticipantRuntime = vi.fn(async () => ({}) as never)

    const handles = await startCoreFeatureRuntimes({
      missionStore: createMissionStoreStub(),
      attachmentAdapter: createAttachmentStub(),
      missionModelEnabled: false,
      startMissionRuntime: vi.fn(async () => ({}) as never),
      startMissionGovernanceRuntime: vi.fn(async () => ({}) as never),
      startOutingRuntime,
      startParticipantRuntime,
      startMarkerRuntime: vi.fn(async () => ({}) as never),
      startDrawingRuntime: vi.fn(async () => ({}) as never),
      startHelicopterRuntime: vi.fn(async () => ({}) as never),
      startGpxRuntime: vi.fn(async () => ({}) as never),
    })

    expect(startOutingRuntime).not.toHaveBeenCalled()
    expect(startParticipantRuntime).not.toHaveBeenCalled()
    expect(handles.outingRuntimeController).toBeNull()
    expect(handles.participantRuntimeController).toBeNull()
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
    createOuting: vi.fn(),
    endOuting: vi.fn(),
    renameOuting: vi.fn(),
    editOutingBoundaries: vi.fn(),
    listOutings: vi.fn(async () => []),
    readOutingFixSummary: vi.fn(async () => ({
      outings: [],
      unassigned_accepted_fix_count: 0,
      total_accepted_fix_count: 0,
    })),
    cancelOutingFixSummary: vi.fn(async () => false),
    selectMissionParticipants: vi.fn(async () => []),
    addMissionParticipant: vi.fn(),
    removeMissionParticipant: vi.fn(),
    listMissionParticipants: vi.fn(async () => []),
    recordGroupMembershipEvents: vi.fn(async () => []),
    listGroupMembershipEvents: vi.fn(async () => []),
    listParticipantBackfillCheckpoints: vi.fn(async () => []),
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
