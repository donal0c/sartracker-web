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
    readonly maxPendingFiles?: number
    readonly maxPendingBytes?: number
    readonly replayBatchSize?: number
    readonly retryDelayMs?: number
  }) => {
    readonly initialize: () => Promise<void>
    readonly deliver: (envelope: RejectionEnvelope) => Promise<{ readonly persisted: boolean }>
    readonly markEvidenceLoss: (missionId: string, reason: string) => Promise<void>
    readonly runWithHealthyEvidenceFence: <Result>(
      missionId: string,
      operationName: string,
      operation: () => Promise<Result>,
    ) => Promise<Result>
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

  it('retries failed projection in the same process without another delivery', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    let projectionAvailable = false
    const projected: string[] = []
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: (entry) => {
        if (!projectionAvailable) throw new Error('database unavailable')
        projected.push(entry.deliveryId)
      },
      retryDelayMs: 5,
    })
    await outbox.deliver(createEnvelope('delivery-background-retry'))

    projectionAvailable = true

    await vi.waitFor(() => expect(projected).toEqual(['delivery-background-retry']))
    await expect(outbox.health('mission-1')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: null,
    })
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

  it('clears durable storage degradation only after the failed envelope stages', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const faultInjection = { failStage: true }
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
      faultInjection,
    })
    await expect(outbox.deliver(createEnvelope('delivery-stage-fail'))).rejects.toThrow()

    faultInjection.failStage = false
    await expect(outbox.deliver(createEnvelope('delivery-stage-fail'))).resolves.toEqual({
      persisted: true,
    })
    await expect(outbox.health()).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: null,
    })
  })

  it('does not clear possible evidence loss from a writable health probe alone', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const faultInjection = { failStage: true }
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
      faultInjection,
    })
    await expect(outbox.deliver(createEnvelope('delivery-stage-fail'))).rejects.toThrow()

    faultInjection.failStage = false

    await expect(outbox.health('mission-1')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: 'outbox_storage_unavailable',
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

    await outbox.markEvidenceLoss('mission-1', 'renderer_pending_capacity_exhausted')

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await expect(restarted.health('mission-1')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: 'renderer_pending_capacity_exhausted',
    })
  })

  it('persists renderer teardown evidence loss across restart', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })

    await outbox.markEvidenceLoss('mission-1', 'renderer_pending_evidence_lost')

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await expect(restarted.health('mission-1')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: 'renderer_pending_evidence_lost',
    })
  })

  it('scopes durable degradation to the affected mission', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })

    await outbox.markEvidenceLoss('mission-1', 'renderer_pending_capacity_exhausted')

    await expect(outbox.health('mission-1')).resolves.toMatchObject({
      lastFailure: 'renderer_pending_capacity_exhausted',
    })
    await expect(outbox.health('mission-2')).resolves.toMatchObject({
      lastFailure: null,
    })
  })

  it('applies explicit file and byte backpressure before staging another envelope', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => { throw new Error('projection unavailable') },
      maxPendingFiles: 2,
      maxPendingBytes: 1_000_000,
    })

    await outbox.deliver(createEnvelope('delivery-1'))
    await outbox.deliver({ ...createEnvelope('delivery-2'), anomalyKey: 'source:2' })
    await expect(outbox.deliver({
      ...createEnvelope('delivery-3'),
      anomalyKey: 'source:3',
    })).rejects.toThrow(/capacity/iu)

    expect((await readdir(directoryPath)).filter((name) => name.endsWith('.json'))).toHaveLength(2)
    await expect(outbox.health('mission-1')).resolves.toMatchObject({
      pendingCount: 2,
      lastFailure: 'outbox_capacity_exhausted',
    })
  })

  it('bounds synchronous projection attempts per replay turn', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    let attempts = 0
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => {
        attempts += 1
        throw new Error('projection unavailable')
      },
      replayBatchSize: 2,
    })
    await outbox.deliver(createEnvelope('delivery-1'))
    await outbox.deliver({ ...createEnvelope('delivery-2'), anomalyKey: 'source:2' })
    await outbox.deliver({ ...createEnvelope('delivery-3'), anomalyKey: 'source:3' })

    attempts = 0
    await outbox.health('mission-1')

    expect(attempts).toBeLessThanOrEqual(2)
  })

  it('rotates replay past terminal records so later mission evidence cannot starve', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const terminal = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => {
        throw Object.assign(
          new Error('mission already finalized'),
          { code: 'LATE_EVIDENCE_AFTER_FINALIZATION' },
        )
      },
      replayBatchSize: 8,
      retryDelayMs: 60_000,
    })
    for (let index = 0; index < 8; index += 1) {
      await terminal.deliver({
        ...createEnvelope(`terminal-${index}`),
        missionId: 'mission-a',
        anomalyKey: `terminal:${index}`,
      })
    }
    terminal.dispose()

    const projected: string[] = []
    const replay = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: (envelope) => {
        if (envelope.missionId === 'mission-a') {
          throw Object.assign(new Error('mission already finalized'), {
            code: 'LATE_EVIDENCE_AFTER_FINALIZATION',
          })
        }
        projected.push(envelope.deliveryId)
      },
      replayBatchSize: 8,
      retryDelayMs: 60_000,
    })

    await replay.deliver({
      ...createEnvelope('valid-later'),
      missionId: 'mission-b',
      anomalyKey: 'valid:later',
    })
    await replay.health('mission-b')

    expect(projected).toEqual(['valid-later'])
    await expect(replay.health('mission-b')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: null,
    })
  })

  it('yields between failed projections so one replay turn stays responsive', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const staging = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => { throw new Error('projection unavailable') },
      replayBatchSize: 1,
    })
    for (let index = 0; index < 8; index += 1) {
      await staging.deliver({
        ...createEnvelope(`delivery-${index}`),
        anomalyKey: `source:${index}`,
      })
    }

    const timerGaps: number[] = []
    let lastTimerAt = performance.now()
    const timer = setInterval(() => {
      const current = performance.now()
      timerGaps.push(current - lastTimerAt)
      lastTimerAt = current
    }, 5)
    const replay = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => {
        const blockedUntil = performance.now() + 30
        while (performance.now() < blockedUntil) {
          // Deliberate synchronous projection fixture.
        }
        throw new Error('projection unavailable')
      },
      replayBatchSize: 8,
    })

    await replay.health('mission-1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    clearInterval(timer)

    expect(timerGaps.length).toBeGreaterThan(0)
    expect(Math.max(...timerGaps)).toBeLessThan(200)
  })

  it('applies byte backpressure independently of the pending-file count', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const first = createEnvelope('delivery-byte-1')
    const firstBytes = Buffer.byteLength(JSON.stringify(first), 'utf8')
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => { throw new Error('projection unavailable') },
      maxPendingFiles: 10,
      maxPendingBytes: firstBytes,
    })

    await outbox.deliver(first)
    await expect(outbox.deliver({
      ...createEnvelope('delivery-byte-2'),
      anomalyKey: 'source:byte-2',
    })).rejects.toThrow(/capacity/iu)
  })

  it('attributes a quarantined staged record to its mission without poisoning others', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const staging = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => { throw new Error('projection unavailable') },
    })
    await staging.deliver(createEnvelope('delivery-corrupt'))
    const [pendingName] = (await readdir(directoryPath)).filter((name) => name.endsWith('.json'))
    await writeFile(path.join(directoryPath, pendingName!), '{not-json', 'utf8')

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await restarted.initialize()

    await expect(restarted.health('mission-1')).resolves.toMatchObject({
      corruptCount: 1,
      lastFailure: 'outbox_corrupt_record',
    })
    await expect(restarted.health('mission-2')).resolves.toMatchObject({
      corruptCount: 0,
      lastFailure: null,
    })
  })

  it('serializes finalization fences ahead of later evidence delivery', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const sequence: string[] = []
    let releaseFence: (() => void) | undefined
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: () => { sequence.push('projected') },
    })
    const fenced = outbox.runWithHealthyEvidenceFence(
      'mission-1',
      'finalization',
      async () => {
        sequence.push('fence-started')
        await new Promise<void>((resolve) => { releaseFence = resolve })
        sequence.push('fence-finished')
        return 'finalized'
      },
    )
    await vi.waitFor(() => expect(sequence).toEqual(['fence-started']))

    const lateDelivery = outbox.deliver(createEnvelope('delivery-after-fence'))
    await Promise.resolve()
    expect(sequence).toEqual(['fence-started'])
    releaseFence?.()

    await expect(fenced).resolves.toBe('finalized')
    await expect(lateDelivery).resolves.toEqual({ persisted: true })
    expect(sequence).toEqual(['fence-started', 'fence-finished', 'projected'])
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
