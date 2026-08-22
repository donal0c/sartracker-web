import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  createIngestAnomalyOutbox,
} = require('../../electron/ingest-anomaly-outbox.cjs') as {
  readonly createIngestAnomalyOutbox: (options: {
    readonly directoryPath: string
    readonly projectEnvelope: (envelope: RejectionEnvelope) => void | Promise<void>
    readonly platform?: NodeJS.Platform
    readonly faultInjection?: {
      readonly failStage?: boolean
      readonly failRemovalAfterProjection?: boolean
    }
  }) => {
    readonly initialize: () => Promise<void>
    readonly deliver: (envelope: RejectionEnvelope) => Promise<{ readonly persisted: boolean }>
    readonly markEvidenceLoss: (reason: string) => Promise<void>
    readonly health: (missionId?: string) => Promise<{
      readonly pendingCount: number
      readonly corruptCount: number
      readonly lastFailure: string | null
    }>
  }
}

type RejectionEnvelope = {
  readonly deliveryId: string
  readonly missionId: string
  readonly anomalyKey: string
  readonly deviceId: string | null
  readonly sourcePositionId: string | null
  readonly reasonClass: string
  readonly receivedAt: string
  readonly canonicalEvidence: Readonly<Record<string, unknown>>
}

describe('durable ingest anomaly outbox [DON-268]', () => {
  let directoryPath: string | null = null

  afterEach(async () => {
    if (directoryPath !== null) {
      await rm(directoryPath, { recursive: true, force: true })
    }
  })

  it('stages before projection and replays after restart when projection fails', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const envelope = createEnvelope('delivery-a')
    const failing = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => {
        throw new Error('database unavailable')
      },
    })

    await expect(failing.deliver(envelope)).resolves.toEqual({ persisted: true })
    expect((await readdir(directoryPath)).filter((name) => name.endsWith('.json'))).toHaveLength(1)

    const projected: RejectionEnvelope[] = []
    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: (entry) => projected.push(entry),
    })
    await restarted.initialize()

    expect(projected).toEqual([envelope])
    expect((await readdir(directoryPath)).filter((name) => name.endsWith('.json'))).toHaveLength(0)
  })

  it('durably stages later unique envelopes while an earlier projection remains unavailable', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    let projectionAvailable = false
    const projected: string[] = []
    const sameProcess = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: (entry) => {
        if (!projectionAvailable) throw new Error('database unavailable')
        projected.push(entry.deliveryId)
      },
    })
    await expect(sameProcess.deliver(createEnvelope('delivery-a'))).resolves.toEqual({
      persisted: true,
    })
    projectionAvailable = true
    await expect(sameProcess.deliver({
      ...createEnvelope('delivery-b'),
      anomalyKey: 'source:456',
      sourcePositionId: '456',
      canonicalEvidence: { source_position_id: '456' },
    })).resolves.toEqual({ persisted: true })

    expect(new Set(projected)).toEqual(new Set(['delivery-a', 'delivery-b']))
    expect((await readdir(directoryPath)).filter((name) => name.endsWith('.json'))).toHaveLength(0)
  })

  it('does not let one envelope-specific projection failure block later evidence', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const projected: string[] = []
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: (entry) => {
        if (entry.deliveryId === 'poison-a') throw new Error('invalid mission reference')
        projected.push(entry.deliveryId)
      },
    })

    await outbox.deliver(createEnvelope('poison-a'))
    await outbox.deliver({
      ...createEnvelope('later-b'),
      anomalyKey: 'source:456',
      sourcePositionId: '456',
    })

    expect(projected).toContain('later-b')
    await expect(outbox.health()).resolves.toMatchObject({
      pendingCount: 1,
      lastFailure: 'ledger_projection_failed',
    })
  })

  it('removes an envelope only after projection commits and safely replays a removal failure', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const committedDeliveryIds = new Set<string>()
    const project = vi.fn((entry: RejectionEnvelope) => {
      committedDeliveryIds.add(entry.deliveryId)
    })
    const interrupted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: project,
      faultInjection: { failRemovalAfterProjection: true },
    })

    await expect(interrupted.deliver(createEnvelope('delivery-b'))).rejects.toThrow(
      /removal after projection/iu,
    )
    expect(committedDeliveryIds).toEqual(new Set(['delivery-b']))

    const replayed = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: (entry) => committedDeliveryIds.add(entry.deliveryId),
    })
    await replayed.initialize()
    expect(committedDeliveryIds).toEqual(new Set(['delivery-b']))
    expect((await replayed.health()).pendingCount).toBe(0)
  })

  it('quarantines corrupt records and keeps degraded health persistent', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    await writeFile(path.join(directoryPath, 'corrupt.json'), '{not-json', 'utf8')
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })

    await outbox.initialize()

    expect(await outbox.health()).toMatchObject({
      pendingCount: 0,
      corruptCount: 1,
      lastFailure: 'outbox_corrupt_record',
    })
    expect(await readdir(directoryPath)).toContain('corrupt.json.corrupt')
  })

  it('reports an honest storage failure without retaining an unbounded memory queue', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
      faultInjection: { failStage: true },
    })

    await expect(outbox.deliver(createEnvelope('delivery-c'))).rejects.toThrow(
      /durable outbox write failed/iu,
    )
    await expect(outbox.health()).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: 'outbox_storage_unavailable',
    })

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await expect(restarted.health()).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: 'outbox_storage_unavailable',
    })
  })

  it('clears durable storage degradation only after a later stage succeeds', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const faultInjection = { failStage: true }
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
      faultInjection,
    })
    await expect(outbox.deliver(createEnvelope('delivery-stage-fail'))).rejects.toThrow()

    faultInjection.failStage = false
    await expect(outbox.deliver(createEnvelope('delivery-stage-recovered'))).resolves.toEqual({
      persisted: true,
    })
    await expect(outbox.health()).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: null,
    })
  })

  it('persists invalid-envelope degradation instead of reporting healthy after restart', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })

    await expect(outbox.deliver({
      ...createEnvelope('delivery-invalid'),
      reasonClass: '',
    })).rejects.toThrow(/reasonClass/iu)

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await expect(restarted.health()).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: 'outbox_invalid_envelope',
    })
  })

  it('persists an explicit evidence-loss marker across restart', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })

    await outbox.markEvidenceLoss('renderer_pending_capacity_exhausted')

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await expect(restarted.health('mission-1')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: 'renderer_pending_capacity_exhausted',
    })
  })

  it('uses Windows-safe staged filenames and skips unsupported directory fsync', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      platform: 'win32',
      projectEnvelope: () => {
        throw new Error('projection unavailable')
      },
    })

    await expect(outbox.deliver(createEnvelope('rejection:unsafe-colon'))).resolves.toEqual({
      persisted: true,
    })

    const pendingFiles = (await readdir(directoryPath)).filter((name) => name.endsWith('.json'))
    expect(pendingFiles).toHaveLength(1)
    expect(pendingFiles[0]).toMatch(/^[a-f0-9]{16}-[a-f0-9]{64}\.json$/u)
  })

  function createEnvelope(deliveryId: string): RejectionEnvelope {
    return {
      deliveryId,
      missionId: 'mission-1',
      anomalyKey: 'source:123',
      deviceId: 'tracker-1',
      sourcePositionId: '123',
      reasonClass: 'invalid_coordinates',
      receivedAt: '2026-08-22T10:00:00.000Z',
      canonicalEvidence: {
        source_position_id: '123',
        device_id: 'tracker-1',
        latitude: 200,
      },
    }
  }
})
