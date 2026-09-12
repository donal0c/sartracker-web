import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createElectronMissionStore } from '../../src/infrastructure/mission-store/electron-mission-store'

const result = {
  positions: [{ id: 'fix-1', mission_id: 'mission-a', device_id: '1', lat: 53.123456789,
    lon: -9.123456789, timestamp: '2026-09-11T09:00:00.123Z', source_position_id: 'source-1',
    timestamp_source: 'fix', name: 'Rescue 🧭', altitude: null }],
  deviceTotals: [{ device_id: '1', total: 17 }],
  deviceSelections: [{ device_id: '1', geometryErrorBoundMetres: 1.25,
    targetGeometryErrorSatisfied: true, timeBucketWidthMs: null, spatialBucketWidthDegrees: null }],
  droppedPositionCount: 2,
}
const manifest = {
  version: 1,
  snapshotId: 'snapshot-a',
  missionId: 'mission-a',
  positionCount: 1,
  deviceTotalCount: 1,
  deviceSelectionCount: 1,
  droppedPositionCount: 2,
}
const lines = [
  JSON.stringify({ kind: 'position', value: result.positions[0] }),
  JSON.stringify({ kind: 'deviceTotal', value: result.deviceTotals[0] }),
  JSON.stringify({ kind: 'deviceSelection', value: result.deviceSelections[0] }),
].map((line) => `${line}\n`)

/** Installs the raw four-channel transport and unrelated mission-store methods. */
function createHarness(overrides: Record<string, unknown> = {}) {
  const raw = {
    info: vi.fn().mockResolvedValue({ schema_version: 3 }),
    listOutings: vi.fn().mockResolvedValue([]),
    listMissionParticipants: vi.fn().mockResolvedValue([]),
    startBreadcrumbQuery: vi.fn().mockResolvedValue(manifest),
    readBreadcrumbQueryFrame: vi.fn(async ({ sequence }: { sequence: number }) => ({
      snapshotId: manifest.snapshotId,
      sequence,
      payload: lines[sequence],
      done: sequence === lines.length - 1,
    })),
    finishBreadcrumbQuery: vi.fn().mockResolvedValue(undefined),
    cancelBreadcrumbQuery: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  Object.defineProperty(window, 'sartrackerElectron', {
    configurable: true,
    value: { missionStore: raw },
  })
  return { raw, store: createElectronMissionStore() }
}

describe('electron mission store adapter', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
  })

  it('delegates unrelated methods and uses the raw session transport for list and cancel', async () => {
    const { raw, store } = createHarness()

    await expect(store.info()).resolves.toEqual({ schema_version: 3 })
    await expect(
      store.listBreadcrumbPositions?.('mission-a', 5_000, 'request-a'),
    ).resolves.toEqual(result)
    await expect(store.cancelBreadcrumbQuery?.('request-a')).resolves.toBe(true)
    await expect(store.listOutings?.('mission-a')).resolves.toEqual([])
    await expect(store.listMissionParticipants?.('mission-a')).resolves.toEqual([])

    expect(raw.info).toHaveBeenCalledWith()
    expect(raw.startBreadcrumbQuery).toHaveBeenCalledWith({
      missionId: 'mission-a',
      perDeviceLimit: 5_000,
      requestId: 'request-a',
    })
    expect(raw.readBreadcrumbQueryFrame.mock.calls.map(([input]) => input)).toEqual(
      [0, 1, 2].map((sequence) => ({
        requestId: 'request-a',
        snapshotId: 'snapshot-a',
        sequence,
      })),
    )
    expect(raw.finishBreadcrumbQuery).toHaveBeenCalledWith({
      requestId: 'request-a',
      snapshotId: 'snapshot-a',
    })
    expect(raw.cancelBreadcrumbQuery).toHaveBeenCalledWith({ requestId: 'request-a' })
    expect(raw.listOutings).toHaveBeenCalledWith('mission-a')
    expect(raw.listMissionParticipants).toHaveBeenCalledWith('mission-a')
  })

  it('cancels custody when a stale snapshot frame is returned', async () => {
    const { raw, store } = createHarness({
      readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({
        snapshotId: 'stale-snapshot',
        sequence: 0,
        payload: lines.join(''),
        done: true,
      }),
    })

    await expect(
      store.listBreadcrumbPositions?.('mission-a', 5_000, 'request-a'),
    ).rejects.toThrow(/Invalid breadcrumb query frame/u)
    expect(raw.finishBreadcrumbQuery).not.toHaveBeenCalled()
    expect(raw.cancelBreadcrumbQuery).toHaveBeenCalledWith({
      requestId: 'request-a',
      snapshotId: 'snapshot-a',
    })
  })
})
