import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  createIngestAnomalyOutbox,
  INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS,
} = require('../../electron/ingest-anomaly-outbox.cjs') as {
  readonly INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS: number
  readonly createIngestAnomalyOutbox: (options: {
    readonly directoryPath: string
    readonly projectEnvelope: (envelope: RejectionEnvelope) => void | Promise<void>
    readonly faultInjection?: {
      readonly failStage?: boolean
      readonly failRemovalAfterProjection?: boolean
    }
  }) => {
    readonly initialize: () => Promise<void>
    readonly deliver: (envelope: RejectionEnvelope) => Promise<{ readonly persisted: boolean }>
    readonly health: () => Promise<{
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

    await expect(failing.deliver(envelope)).rejects.toThrow(/ledger projection failed/iu)
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
    expect(INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS).toBeGreaterThan(0)
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
