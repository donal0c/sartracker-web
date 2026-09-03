import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises')
const {
  createIngestAnomalyOutbox,
} = require('../../electron/ingest-anomaly-outbox.cjs') as {
  readonly createIngestAnomalyOutbox: (options: {
    readonly directoryPath: string
    readonly projectEnvelope: (envelope: RejectionEnvelope) => void | Promise<void>
    readonly assertMissionMutationAllowed?: (missionId: string) => void | Promise<void>
    readonly platform?: NodeJS.Platform
    readonly faultInjection?: {
      readonly failStage?: boolean
      readonly failRemovalAfterProjection?: boolean
      failRendererStageAfterScopeCount?: number
    }
    readonly maxPendingFiles?: number
    readonly maxPendingBytes?: number
    readonly replayBatchSize?: number
    readonly retryDelayMs?: number
  }) => {
    readonly initialize: () => Promise<void>
    readonly dispose: () => void
    readonly deliver: (envelope: RejectionEnvelope) => Promise<{ readonly persisted: boolean }>
    readonly markEvidenceLoss: (missionId: string, reason: string) => Promise<void>
    readonly stageRendererEvidenceUncertainty: (
      missionId: string,
      incidentId: string,
      scopeReason: string,
    ) => Promise<void>
    readonly resolveRendererEvidenceUncertainty: (
      missionId: string,
      incidentId: string,
      outcome: 'drained' | 'lost',
    ) => Promise<void>
    readonly stageRendererEvidenceIncident: (
      scopes: readonly {
        readonly missionId: string
        readonly scopeReason: string
      }[],
      incidentId: string,
    ) => Promise<void>
    readonly resolveRendererEvidenceIncidents: (
      incidentId: string | null,
      outcome: 'drained' | 'lost',
    ) => Promise<void>
    readonly readEvidenceLossAcknowledgementCandidate: (missionId: string) => Promise<{
      readonly token: string
      readonly reasons: readonly string[]
    }>
    readonly runWithHealthyEvidenceFence: <Result>(
      missionId: string,
      operationName: string,
      operation: () => Promise<Result>,
      options?: { readonly acknowledgedLossToken?: string },
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

  it('does not recreate its app-addressable directory after disposal wins startup', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-dispose-'))
    const outboxDirectory = path.join(directoryPath, 'ingest-anomaly-outbox')
    const outbox = createIngestAnomalyOutbox({
      directoryPath: outboxDirectory,
      projectEnvelope: vi.fn(),
    })

    const initialization = outbox.initialize()
    outbox.dispose()
    await initialization

    await expect(readdir(directoryPath)).resolves.toEqual([])
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

  it('persists accepted mission-write evidence loss across restart', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })

    await outbox.markEvidenceLoss('mission-1', 'mission_persistence_failed')

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await expect(restarted.health('mission-1')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: 'mission_persistence_failed',
    })
  })

  it('retracts a late-clean renderer drain without consuming the acknowledged loss generation [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await outbox.markEvidenceLoss('mission-1', 'renderer_pending_evidence_lost')
    const acknowledgedOccurrence = await outbox.readEvidenceLossAcknowledgementCandidate(
      'mission-1',
    )

    await outbox.stageRendererEvidenceUncertainty(
      'mission-1',
      'request-slow-clean-drain',
      'finished_unfinalized_mission',
    )
    await expect(outbox.health('mission-1')).resolves.toMatchObject({
      lastFailure: 'renderer_pending_evidence_lost',
    })
    await expect(
      outbox.readEvidenceLossAcknowledgementCandidate('mission-1'),
    ).rejects.toThrow(/isolated mission evidence loss/iu)

    await outbox.resolveRendererEvidenceUncertainty(
      'mission-1',
      'request-slow-clean-drain',
      'drained',
    )

    await expect(outbox.readEvidenceLossAcknowledgementCandidate('mission-1')).resolves.toEqual(
      acknowledgedOccurrence,
    )
    const marker = JSON.parse(
      await fsPromises.readFile(
        path.join(
          directoryPath,
          `degraded-health-${createHash('sha256').update('mission-1').digest('hex').slice(0, 16)}.json.marker`,
        ),
        'utf8',
      ),
    ) as { readonly rendererEvidenceContexts?: Record<string, unknown> }
    expect(marker.rendererEvidenceContexts).toEqual({})
  })

  it('rechecks mutation permission after async setup before resolving renderer evidence [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    let phase: 'stage' | 'resolve' = 'stage'
    let resolveChecks = 0
    const recoveryError = Object.assign(new Error('custody recovery required'), {
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
      assertMissionMutationAllowed: () => {
        if (phase === 'resolve') {
          resolveChecks += 1
          if (resolveChecks > 1) throw recoveryError
        }
      },
    })
    await outbox.stageRendererEvidenceUncertainty(
      'mission-1',
      'request-race-check',
      'finished_unfinalized_mission',
    )
    phase = 'resolve'
    await expect(outbox.resolveRendererEvidenceUncertainty(
      'mission-1',
      'request-race-check',
      'drained',
    )).rejects.toMatchObject({
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })
    await expect(outbox.health('mission-1')).resolves.toMatchObject({
      lastFailure: 'renderer_evidence_pending',
    })
  })

  it('does not downgrade a recovery race during envelope staging into storage degradation [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    let checks = 0
    const recoveryError = Object.assign(new Error('custody recovery required'), {
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
      assertMissionMutationAllowed: () => {
        checks += 1
        if (checks > 1) throw recoveryError
      },
    })

    await expect(outbox.deliver(createEnvelope('recovery-race'))).rejects.toMatchObject({
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })
    expect(checks).toBe(2)
    await expect(readdir(directoryPath)).resolves.not.toContain('recovery-race.json')
    await expect(outbox.health('mission-1')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: null,
    })
  })

  it('promotes unresolved renderer uncertainty to permanent loss exactly once after restart [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const staging = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await staging.stageRendererEvidenceUncertainty(
      'mission-1',
      'request-process-lost',
      'active_mission',
    )

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await restarted.initialize()
    await expect(restarted.health('mission-1')).resolves.toMatchObject({
      lastFailure: 'renderer_pending_evidence_lost',
    })
    const first = await restarted.readEvidenceLossAcknowledgementCandidate('mission-1')

    const restartedAgain = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await restartedAgain.initialize()
    await expect(
      restartedAgain.readEvidenceLossAcknowledgementCandidate('mission-1'),
    ).resolves.toEqual(first)
  })

  it('uses one durable incident record to recover a partial multi-mission stage after a later clean drain [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const faultInjection = { failRendererStageAfterScopeCount: 1 }
    const staging = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
      faultInjection,
    })

    await expect(staging.stageRendererEvidenceIncident([
      { missionId: 'mission-a', scopeReason: 'active_mission' },
      { missionId: 'mission-b', scopeReason: 'paused_recoverable_mission' },
    ], 'request-partial-incident')).rejects.toThrow(/renderer.*stage/iu)
    expect((await readdir(directoryPath)).filter((name) =>
      name.startsWith('renderer-evidence-incident-'))).toHaveLength(1)

    faultInjection.failRendererStageAfterScopeCount = Number.POSITIVE_INFINITY
    await staging.resolveRendererEvidenceIncidents(null, 'drained')

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await restarted.initialize()
    await expect(restarted.health('mission-a')).resolves.toMatchObject({ lastFailure: null })
    await expect(restarted.health('mission-b')).resolves.toMatchObject({ lastFailure: null })
    expect((await readdir(directoryPath)).filter((name) =>
      name.startsWith('renderer-evidence-incident-'))).toHaveLength(0)
  })

  it('does not retain volatile incident ownership when the durable incident write fails [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await outbox.initialize()
    const originalRename = fsPromises.rename
    const rename = vi.spyOn(fsPromises, 'rename').mockImplementation(async (source, destination) => {
      if (path.basename(String(destination)).startsWith('renderer-evidence-incident-')) {
        throw new Error('injected incident rename failure')
      }
      return originalRename(source, destination)
    })

    try {
      await expect(outbox.stageRendererEvidenceIncident([
        { missionId: 'mission-a', scopeReason: 'active_mission' },
      ], 'request-write-failed')).rejects.toThrow(/incident rename failure/iu)
    } finally {
      rename.mockRestore()
    }

    await expect(outbox.resolveRendererEvidenceIncidents(null, 'drained')).resolves.toEqual([])
    await expect(outbox.health('mission-a')).resolves.toMatchObject({ lastFailure: null })
  })

  it('promotes only scopes owned by a surviving durable renderer incident and does so once [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const staging = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await staging.stageRendererEvidenceIncident([
      { missionId: 'mission-a', scopeReason: 'active_mission' },
      { missionId: 'mission-b', scopeReason: 'finished_unfinalized_mission' },
    ], 'request-process-lost-bulk')

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await restarted.initialize()
    const firstA = await restarted.readEvidenceLossAcknowledgementCandidate('mission-a')
    const firstB = await restarted.readEvidenceLossAcknowledgementCandidate('mission-b')

    const restartedAgain = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await restartedAgain.initialize()
    await expect(restartedAgain.readEvidenceLossAcknowledgementCandidate('mission-a'))
      .resolves.toEqual(firstA)
    await expect(restartedAgain.readEvidenceLossAcknowledgementCandidate('mission-b'))
      .resolves.toEqual(firstB)
  })

  it('retains evidence loss while an exact durable acknowledgement token permits lifecycle closure [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await outbox.markEvidenceLoss('mission-1', 'renderer_pending_evidence_lost')

    const candidate = await outbox.readEvidenceLossAcknowledgementCandidate('mission-1')
    expect(candidate.reasons).toEqual(['renderer_pending_evidence_lost'])
    await expect(outbox.runWithHealthyEvidenceFence(
      'mission-1',
      'finalization',
      async () => 'finalized',
      { acknowledgedLossToken: candidate.token },
    )).resolves.toBe('finalized')
    await expect(outbox.health('mission-1')).resolves.toMatchObject({
      lastFailure: 'renderer_pending_evidence_lost',
    })

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    const restartedCandidate = await restarted.readEvidenceLossAcknowledgementCandidate(
      'mission-1',
    )
    expect(restartedCandidate).toEqual(candidate)
  })

  it('refuses loss acknowledgement while the mission still has pending durable evidence', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await outbox.markEvidenceLoss('mission-1', 'renderer_pending_evidence_lost')
    const missionPrefix = createHash('sha256').update('mission-1').digest('hex').slice(0, 16)
    await writeFile(path.join(directoryPath, `${missionPrefix}-pending.json`), '{}', 'utf8')

    await expect(
      outbox.readEvidenceLossAcknowledgementCandidate('mission-1'),
    ).rejects.toThrow(/isolated mission evidence loss/iu)
  })

  it('invalidates an earlier acknowledgement when another evidence-loss occurrence is recorded [DON-276]', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await outbox.markEvidenceLoss('mission-1', 'renderer_pending_evidence_lost')
    const earlier = await outbox.readEvidenceLossAcknowledgementCandidate('mission-1')

    await outbox.markEvidenceLoss('mission-1', 'renderer_pending_evidence_lost')
    const later = await outbox.readEvidenceLossAcknowledgementCandidate('mission-1')

    expect(later.token).not.toBe(earlier.token)
    await expect(outbox.runWithHealthyEvidenceFence(
      'mission-1',
      'archive',
      async () => 'archived',
      { acknowledgedLossToken: earlier.token },
    )).rejects.toMatchObject({
      code: 'EVIDENCE_HEALTH_BLOCKED',
      message: expect.stringMatching(/evidence health/iu),
    })
  })

  it('rejects renderer teardown when the evidence-loss marker cannot become durable', async () => {
    directoryPath = await mkdtemp(path.join(tmpdir(), 'sartracker-ingest-outbox-'))
    const outbox = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await outbox.initialize()
    const originalRename = fsPromises.rename
    const rename = vi.spyOn(fsPromises, 'rename').mockImplementation(async (source, destination) => {
      if (String(destination).endsWith('.json.marker')) {
        throw new Error('injected health-marker rename failure')
      }
      return originalRename(source, destination)
    })

    try {
      await expect(
        outbox.markEvidenceLoss('mission-1', 'renderer_pending_evidence_lost'),
      ).rejects.toThrow(/health-marker rename failure/iu)
      await expect(outbox.health('mission-1')).resolves.toMatchObject({
        lastFailure: 'renderer_pending_evidence_lost',
      })
      expect((await readdir(directoryPath)).some((name) => name.endsWith('.tmp'))).toBe(false)
    } finally {
      rename.mockRestore()
    }

    const restarted = createIngestAnomalyOutbox({
      directoryPath,
      projectEnvelope: vi.fn(),
    })
    await expect(restarted.health('mission-1')).resolves.toMatchObject({
      pendingCount: 0,
      lastFailure: null,
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
