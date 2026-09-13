import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronMissionStore } from '../../src/infrastructure/mission-store/electron-mission-store'
import { createBreadcrumbRecordDecoder } from '../../src/infrastructure/mission-store/breadcrumb-query-client'

const result = {
  positions: [{ id: 'fix-1', mission_id: 'mission-a', device_id: '1', lat: 53.123456789,
    lon: -9.123456789, timestamp: '2026-09-11T09:00:00.123Z', source_position_id: 'source-1',
    timestamp_source: 'fix', name: 'Rescue 🧭', altitude: null }],
  deviceTotals: [{ device_id: '1', total: 17 }],
  deviceSelections: [{ device_id: '1', geometryErrorBoundMetres: 1.25,
    targetGeometryErrorSatisfied: true, timeBucketWidthMs: null, spatialBucketWidthDegrees: null }],
  droppedPositionCount: 2,
}
const { encodeBreadcrumbFrames } = createRequire(import.meta.url)('../../electron/breadcrumb-query-transport.cjs') as {
  encodeBreadcrumbFrames: (value: unknown) => Iterable<{ payload: string; done: boolean }>
}
const manifest = { version: 1, snapshotId: 'snapshot-a', missionId: 'mission-a', positionCount: 1, deviceTotalCount: 1, deviceSelectionCount: 1, droppedPositionCount: 2 }
const lines = [
  JSON.stringify({ kind: 'position', value: result.positions[0] }),
  JSON.stringify({ kind: 'deviceTotal', value: result.deviceTotals[0] }),
  JSON.stringify({ kind: 'deviceSelection', value: result.deviceSelections[0] }),
].map((line) => `${line}\n`)

/** Installs the raw transport without the obsolete whole-result method. */
function createHarness(overrides: Record<string, unknown> = {}) {
  const raw = {
    startBreadcrumbQuery: vi.fn().mockResolvedValue(manifest),
    readBreadcrumbQueryFrame: vi.fn(async ({ sequence }: { sequence: number }) => ({
      snapshotId: 'snapshot-a', sequence, payload: lines[sequence], done: sequence === lines.length - 1,
    })),
    finishBreadcrumbQuery: vi.fn().mockResolvedValue(undefined),
    cancelBreadcrumbQuery: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  Object.defineProperty(window, 'sartrackerElectron', { configurable: true, value: { missionStore: raw } })
  return { raw, store: createElectronMissionStore() }
}

describe('bounded breadcrumb client', () => {
  beforeEach(() => { Reflect.deleteProperty(window, 'sartrackerElectron') })

  it('preserves the query failure when frame teardown also rejects cancellation', async () => {
    const failure = new Error('Canonical transfer failed')
    const { raw, store } = createHarness({
      readBreadcrumbQueryFrame: vi.fn().mockRejectedValue(failure),
      cancelBreadcrumbQuery: vi.fn().mockRejectedValue(new Error('Invalid IPC sender')),
    })
    await expect(store.listBreadcrumbPositions!('mission-a', 5_000, 'teardown')).rejects.toBe(failure)
    expect(raw.cancelBreadcrumbQuery).toHaveBeenCalledOnce()
  })

  it('assembles unchanged rows, yields between frames, and waits for clean worker finish', async () => {
    let finish!: () => void
    let taskRan = false
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const stream = lines.join('')
    const split = stream.indexOf('🧭') + 1
    const payloads = [stream.slice(0, split), stream.slice(split, split + 20), stream.slice(split + 20)]
    const { raw, store } = createHarness({
      readBreadcrumbQueryFrame: vi.fn(async ({ sequence }: { sequence: number }) => {
        if (sequence === 0) setTimeout(() => { taskRan = true }, 0)
        else expect(taskRan).toBe(true)
        return { snapshotId: 'snapshot-a', sequence, payload: payloads[sequence], done: sequence === 2 }
      }),
      finishBreadcrumbQuery: vi.fn(() => finished),
    })
    let published = false
    const query = store.listBreadcrumbPositions!('mission-a', 5_000, 'request-a').then((value) => {
      published = true
      return value
    })
    await vi.waitFor(() => expect(raw.finishBreadcrumbQuery).toHaveBeenCalledWith({ requestId: 'request-a', snapshotId: 'snapshot-a' }))
    expect(published).toBe(false)
    finish()
    await expect(query).resolves.toEqual(result)
    expect(raw.startBreadcrumbQuery).toHaveBeenCalledWith({ missionId: 'mission-a', perDeviceLimit: 5_000, requestId: 'request-a' })
    expect(raw.readBreadcrumbQueryFrame.mock.calls.map(([input]) => input)).toEqual(
      [0, 1, 2].map((sequence) => ({ requestId: 'request-a', snapshotId: 'snapshot-a', sequence })),
    )
    expect(raw.cancelBreadcrumbQuery).not.toHaveBeenCalled()
  })

  it('accepts the explicit empty terminal frame and generates a request id when omitted', async () => {
    const start = vi.fn().mockResolvedValue({ ...manifest, positionCount: 0, deviceTotalCount: 0, deviceSelectionCount: 0, droppedPositionCount: 0 })
    const { raw, store } = createHarness({ startBreadcrumbQuery: start,
      readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: '', done: true }),
    })
    await expect(store.listBreadcrumbPositions!('mission-a', 5_000)).resolves.toEqual({ positions: [], deviceTotals: [], deviceSelections: [], droppedPositionCount: 0 })
    expect(start.mock.calls[0]?.[0].requestId).toEqual(expect.any(String))
    expect(start.mock.calls[0]?.[0].requestId.length).toBeGreaterThan(0)
    expect(raw.readBreadcrumbQueryFrame).toHaveBeenCalledOnce()
  })

  it('reports transferred rows truthfully while keeping them private until finish', async () => {
    const { store } = createHarness()
    const progress = vi.fn()
    const unsubscribe = store.subscribeBreadcrumbQueryProgress!('progress', progress)
    const query = store.listBreadcrumbPositions!('mission-a', 5_000, 'progress')
    await query
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { receivedPositions: 0, totalPositions: 1 },
      { receivedPositions: 1, totalPositions: 1 },
    ])
    unsubscribe()
  })

  it('treats progress listener failures as advisory and keeps the transfer alive', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const progress = vi.fn(() => { throw new Error('listener-private-detail') })
      const { raw, store } = createHarness()
      store.subscribeBreadcrumbQueryProgress!('listener-failure', progress)
      await expect(store.listBreadcrumbPositions!('mission-a', 5_000, 'listener-failure')).resolves.toEqual(result)
      expect(raw.finishBreadcrumbQuery).toHaveBeenCalledWith({ requestId: 'listener-failure', snapshotId: 'snapshot-a' })
      expect(warning).toHaveBeenCalledWith('Breadcrumb query progress listener failed; transfer continues.')
      expect(warning.mock.calls.flat()).not.toContain('listener-private-detail')
    } finally {
      warning.mockRestore()
    }
  })

  it('preserves non-finite legacy optional scalars, signed zero and tag-like literal strings', async () => {
    const expected = { ...result, positions: [{ ...result.positions[0], altitude: Infinity,
      accuracy: -Infinity, speed: NaN, battery: -0, name: '{"exceptionalNumbers":[["speed","NaN"]]}' }] }
    const frames = [...encodeBreadcrumbFrames(expected)]
    const { store } = createHarness({ readBreadcrumbQueryFrame: vi.fn(async ({ sequence }: { sequence: number }) =>
      ({ ...frames[sequence], sequence, snapshotId: 'snapshot-a' })) })
    const actual = await store.listBreadcrumbPositions!('mission-a', 5_000, 'numbers')
    expect(actual).toEqual(expected)
    expect(Object.is(actual.positions[0]!.battery, -0)).toBe(true)
  })

  it('bounds individual parse records while preserving a large escaped string and split surrogates', async () => {
    const name = '"\\\n🧭\ud800'.repeat(170_000)
    const expected = { ...result, positions: [{ ...result.positions[0], name }] }
    const frames = [...encodeBreadcrumbFrames(expected)]
    for (const line of frames.map((frame) => frame.payload).join('').split('\n')) {
      expect(line.length).toBeLessThanOrEqual(16_384)
    }
    const { store } = createHarness({ readBreadcrumbQueryFrame: vi.fn(async ({ sequence }: { sequence: number }) =>
      ({ ...frames[sequence], sequence, snapshotId: 'snapshot-a' })) })
    await expect(store.listBreadcrumbPositions!('mission-a', 5_000, 'large-string')).resolves.toEqual(expected)
  })

  it('rejects endless fragmented rows and declared oversized strings before reconstruction', () => {
    const accept = vi.fn()
    const decoder = createBreadcrumbRecordDecoder(accept)
    expect(() => decoder.acceptLine(JSON.stringify({ kind: 'rowStart', rowKind: 'position', fieldCount: Number.MAX_SAFE_INTEGER }))).toThrow(/field count/i)

    decoder.acceptLine(JSON.stringify({ kind: 'rowStart', rowKind: 'position', fieldCount: 1 }))
    expect(() => decoder.acceptLine(JSON.stringify({ kind: 'stringStart', key: 'name', length: Number.MAX_SAFE_INTEGER }))).toThrow(/string field/i)
    expect(accept).not.toHaveBeenCalled()
  })

  it('rejects declared aggregate string data before assigning the next field', () => {
    const accept = vi.fn()
    const decoder = createBreadcrumbRecordDecoder(accept, { maxRowStringCodeUnits: 4 })
    decoder.acceptLine(JSON.stringify({ kind: 'rowStart', rowKind: 'position', fieldCount: 2 }))
    decoder.acceptLine(JSON.stringify({ kind: 'stringStart', key: 'a', length: 3 }))
    decoder.acceptLine(JSON.stringify({ kind: 'stringChunk', offset: 0, value: 'abc' }))
    expect(() => decoder.acceptLine(JSON.stringify({ kind: 'stringStart', key: 'b', length: 2 }))).toThrow(/aggregate.*string/i)
    expect(accept).not.toHaveBeenCalled()
  })

  it('rejects fields beyond the declared row field count before assignment', () => {
    const accept = vi.fn()
    const decoder = createBreadcrumbRecordDecoder(accept)
    decoder.acceptLine(JSON.stringify({ kind: 'rowStart', rowKind: 'position', fieldCount: 1 }))
    decoder.acceptLine(JSON.stringify({ kind: 'field', value: { first: 'value' } }))
    expect(() => decoder.acceptLine(JSON.stringify({ kind: 'field', value: { second: 'value' } }))).toThrow(/field count/i)
    expect(accept).not.toHaveBeenCalled()
  })

  it('enforces the aggregate string budget for direct scalar fields too', () => {
    const accept = vi.fn()
    const decoder = createBreadcrumbRecordDecoder(accept, { maxRowStringCodeUnits: 4 })
    decoder.acceptLine(JSON.stringify({ kind: 'rowStart', rowKind: 'position', fieldCount: 2 }))
    decoder.acceptLine(JSON.stringify({ kind: 'field', value: { a: 'abc' } }))
    expect(() => decoder.acceptLine(JSON.stringify({ kind: 'field', value: { b: 'def' } }))).toThrow(/aggregate.*string/i)
    expect(accept).not.toHaveBeenCalled()
  })

  it('distinguishes malformed position mission identity from a valid row for another mission', async () => {
    const malformedPosition = Object.fromEntries(Object.entries(result.positions[0]!).filter(([key]) => key !== 'mission_id'))
    const frameFor = (position: unknown) => ({ snapshotId: 'snapshot-a', sequence: 0,
      payload: [JSON.stringify({ kind: 'position', value: position }) + '\n', lines[1], lines[2]].join(''), done: true })
    const malformed = createHarness({ readBreadcrumbQueryFrame: vi.fn().mockResolvedValue(frameFor(malformedPosition)) })
    await expect(malformed.store.listBreadcrumbPositions!('mission-a', 5_000, 'missing-mission')).rejects.toThrow(/missing or invalid mission_id/i)

    const wrongMission = createHarness({ readBreadcrumbQueryFrame: vi.fn().mockResolvedValue(frameFor({ ...result.positions[0], mission_id: 'mission-b' })) })
    await expect(wrongMission.store.listBreadcrumbPositions!('mission-a', 5_000, 'wrong-mission')).rejects.toThrow(/belongs to another mission/i)
  })

  it.each(['missing fragment', 'duplicate fragment', 'wrong offset', 'missing field', 'unfinished row'])(
    'rejects malformed fragmented records: %s', (failure) => {
      const accept = vi.fn()
      const decoder = createBreadcrumbRecordDecoder(accept)
      decoder.acceptLine(JSON.stringify({ kind: 'rowStart', rowKind: 'position', fieldCount: failure === 'missing field' ? 2 : 1 }))
      decoder.acceptLine(JSON.stringify({ kind: 'stringStart', key: 'name', length: 4 }))
      decoder.acceptLine(JSON.stringify({ kind: 'stringChunk', offset: 0, value: 'ab' }))
      expect(() => {
        if (failure === 'duplicate fragment') decoder.acceptLine(JSON.stringify({ kind: 'stringChunk', offset: 0, value: 'ab' }))
        if (failure === 'wrong offset') decoder.acceptLine(JSON.stringify({ kind: 'stringChunk', offset: 3, value: 'cd' }))
        if (failure === 'missing field' || failure === 'unfinished row') decoder.acceptLine(JSON.stringify({ kind: 'stringChunk', offset: 2, value: 'cd' }))
        if (failure !== 'unfinished row') decoder.acceptLine(JSON.stringify({ kind: 'rowEnd' }))
        decoder.finish()
      }).toThrow()
      expect(accept).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['wrong snapshot', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'stale', sequence: 0, payload: lines.join(''), done: true }) }],
    ['wrong mission manifest', { startBreadcrumbQuery: vi.fn().mockResolvedValue({ ...manifest, missionId: 'mission-b' }) }],
    ['unsupported manifest', { startBreadcrumbQuery: vi.fn().mockResolvedValue({ ...manifest, version: 2 }) }],
    ['fractional count', { startBreadcrumbQuery: vi.fn().mockResolvedValue({ ...manifest, positionCount: 1.5 }) }],
    ['negative dropped count', { startBreadcrumbQuery: vi.fn().mockResolvedValue({ ...manifest, droppedPositionCount: -1 }) }],
    ['duplicate frame', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: lines[0], done: false }) }],
    ['missing frame', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 1, payload: lines[0], done: false }) }],
    ['oversized frame', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: ' '.repeat(32_769), done: true }) }],
    ['non-boolean done', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: lines.join(''), done: 'true' }) }],
    ['empty nonterminal frame', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: '', done: false }) }],
    ['truncated JSON', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: '{"kind":', done: true }) }],
    ['missing record', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: lines[0], done: true }) }],
    ['extra record', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: lines.join('') + lines[0], done: true }) }],
    ['wrong order', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: lines[1] + lines[0] + lines[2], done: true }) }],
    ['unknown kind', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: '{"kind":"other","value":{}}\n', done: true }) }],
    ['null row', { readBreadcrumbQueryFrame: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: '{"kind":"position","value":null}\n', done: true }) }],
    ['read failure', { readBreadcrumbQueryFrame: vi.fn().mockRejectedValue(new Error('read failed')) }],
    ['finish failure', { finishBreadcrumbQuery: vi.fn().mockRejectedValue(new Error('worker failed')) }],
  ])('rejects %s without partial publication and cancels custody', async (label, overrides) => {
    const { raw, store } = createHarness(overrides)
    await expect(store.listBreadcrumbPositions!('mission-a', 5_000, 'bad-request')).rejects.toThrow()
    expect(raw.cancelBreadcrumbQuery).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'bad-request' }))
    if (label !== 'finish failure') expect(raw.finishBreadcrumbQuery).not.toHaveBeenCalled()
  })

  it('keeps cancellation authoritative when an outstanding frame resolves later', async () => {
    let deliver!: (frame: unknown) => void
    const frame = new Promise((resolve) => { deliver = resolve })
    const { raw, store } = createHarness({ readBreadcrumbQueryFrame: vi.fn(() => frame) })
    const query = store.listBreadcrumbPositions!('mission-a', 5_000, 'cancel-me')
    const rejected = expect(query).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(raw.readBreadcrumbQueryFrame).toHaveBeenCalledOnce())
    await expect(store.cancelBreadcrumbQuery!('cancel-me')).resolves.toBe(true)
    deliver({ sequence: 0, payload: lines.join(''), done: true })
    await rejected
    expect(raw.finishBreadcrumbQuery).not.toHaveBeenCalled()
  })

  it('includes the active snapshot identity when public cancellation occurs after start', async () => {
    let deliver!: (frame: unknown) => void
    const frame = new Promise((resolve) => { deliver = resolve })
    const { raw, store } = createHarness({ readBreadcrumbQueryFrame: vi.fn(() => frame) })
    const query = store.listBreadcrumbPositions!('mission-a', 5_000, 'snapshot-cancel')
    await vi.waitFor(() => expect(raw.readBreadcrumbQueryFrame).toHaveBeenCalledOnce())
    await expect(store.cancelBreadcrumbQuery!('snapshot-cancel')).resolves.toBe(true)
    expect(raw.cancelBreadcrumbQuery.mock.calls[0]?.[0]).toEqual({ requestId: 'snapshot-cancel', snapshotId: 'snapshot-a' })
    deliver({ snapshotId: 'snapshot-a', sequence: 0, payload: '', done: true })
    await expect(query).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('exposes raw frame reads in preload with no old whole-result escape', async () => {
    const invoke = vi.fn().mockResolvedValue({ snapshotId: 'snapshot-a', sequence: 0, payload: '', done: true })
    let exposed!: { missionStore: Record<string, (input: unknown) => Promise<unknown>> }
    runInNewContext(readFileSync('electron/preload.cjs', 'utf8'), {
      process: { platform: 'linux' }, TextEncoder, window: { addEventListener: vi.fn() },
      require: () => ({
        contextBridge: { exposeInMainWorld: (_name: string, bridge: typeof exposed) => { exposed = bridge } },
        ipcRenderer: { invoke, on: vi.fn(), send: vi.fn(), sendSync: vi.fn(), removeListener: vi.fn() },
      }),
    })
    expect(exposed.missionStore.listBreadcrumbPositions).toBeUndefined()
    for (const [method, channel, input] of [
      ['startBreadcrumbQuery', 'start-breadcrumb-query', { missionId: 'mission-a', perDeviceLimit: 5_000, requestId: 'request-a' }],
      ['readBreadcrumbQueryFrame', 'read-breadcrumb-query-frame', { requestId: 'request-a', sequence: 0 }],
      ['finishBreadcrumbQuery', 'finish-breadcrumb-query', { requestId: 'request-a' }],
      ['cancelBreadcrumbQuery', 'cancel-breadcrumb-query', { requestId: 'request-a' }],
    ] as const) {
      await exposed.missionStore[method]!(input)
      expect(invoke).toHaveBeenLastCalledWith(`sartracker:mission-store:${channel}`, input)
    }
  })
})
