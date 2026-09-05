import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  ArchiveEnvelopeError,
  normalizeArchiveCreateRequest,
  normalizeArchiveCreateResult,
  normalizeArchiveProgress,
  normalizeArchiveVerificationProofForIdentity,
} = require('../../electron/archive-envelope.cjs') as ArchiveEnvelopeModule
const { canonicalJson } = require('../../electron/archive-container.cjs') as {
  readonly canonicalJson: (value: unknown) => string
}
const { listArchiveInventoryForSchema } = require('../../electron/archive-inventory.cjs') as {
  readonly listArchiveInventoryForSchema: (
    schemaVersion: number,
  ) => readonly { readonly tableName: string }[]
}

type ArchiveEnvelopeModule = {
  readonly ArchiveEnvelopeError: new (...args: readonly unknown[]) => Error & {
    readonly code: string
  }
  readonly normalizeArchiveCreateRequest: (
    input: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>
  readonly normalizeArchiveCreateResult: (
    input: Readonly<Record<string, unknown>>,
    expected: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>
  readonly normalizeArchiveProgress: (
    input: Readonly<Record<string, unknown>>,
    operationId: string,
  ) => Readonly<Record<string, unknown>>
  readonly normalizeArchiveVerificationProofForIdentity: (
    input: Readonly<Record<string, unknown>>,
    expected: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>
}

const operationId = '11111111-1111-4111-8111-111111111111'
const archiveId = '22222222-2222-4222-8222-222222222222'
const requestEventId = '33333333-3333-4333-8333-333333333333'
const databasePath = path.resolve('/tmp/sartracker-envelope/mission-store.sqlite')
const archiveDirectory = path.resolve('/tmp/sartracker-envelope/archives')

/** Returns the exact bounded table ledger retained by independent verification. */
function verificationTables() {
  return listArchiveInventoryForSchema(13).map((declaration, index) => ({
    tableName: declaration.tableName,
    rowCount: index,
    contentSha256: createHash('sha256').update(declaration.tableName).digest('hex'),
  }))
}

/** Returns an exhaustive per-sample Replay ledger and its canonical digest. */
function verificationReplaySemantic() {
  const samples = Array.from({ length: 5 }, (_value, index) => ({
    selectedTime: `2026-08-29T1${index}:00:00.000Z`,
    semanticSha256: createHash('sha256').update(`replay-${index}`).digest('hex'),
    sampledOutingFilterCount: index,
    totalOutingFilterCount: index,
    sampledObjectCount: index + 1,
    totalObjectCount: index + 1,
    sampledTrackCount: index + 2,
    totalTrackCount: index + 2,
  }))
  const rawProof = {
    proof_version: 3,
    sample_count: samples.length,
    sample_strategy: 'mission-start-finish-fence-midpoints-exhaustive-pages-and-outing-filters-v3',
    samples: samples.map((sample) => ({
      selected_time: sample.selectedTime,
      semantic_sha256: sample.semanticSha256,
      sampled_outing_filter_count: sample.sampledOutingFilterCount,
      sampled_object_count: sample.sampledObjectCount,
      sampled_track_count: sample.sampledTrackCount,
      total_outing_filter_count: sample.totalOutingFilterCount,
      total_object_count: sample.totalObjectCount,
      total_track_count: sample.totalTrackCount,
    })),
  }
  return {
    sampled: true,
    matched: true,
    sampleCount: samples.length,
    sampleStrategy: rawProof.sample_strategy,
    baselineSha256: createHash('sha256').update(canonicalJson(rawProof)).digest('hex'),
    samples,
  }
}

/** Returns one complete serializable create-worker request. */
function createRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId,
    archiveId,
    databasePath,
    archiveDirectory,
    missionId: 'mission-alpha',
    requestEventRowid: 42,
    fenceRequestedAt: '2026-08-29T18:59:59.000Z',
    requestEventId,
    archiveKind: 'finalized',
    createdAt: '2026-08-29T19:00:00.000Z',
    schemaVersion: 13,
    inventoryVersion: 1,
    previousArchiveSha256: null,
    protectedFinalizationEpoch: null,
    passphrase: 'Four calm words 2026!',
    recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
    ...overrides,
  }
}

/** Returns the exact non-secret identity issued by the archive registry. */
function verificationIdentity(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    archiveId,
    archiveKind: 'finalized',
    archiveRelativePath: `${archiveId}.sararch`,
    missionId: 'mission-alpha',
    requestEventRowid: 42,
    requestEventId,
    creationOperationId: operationId,
    protectedFinalizationEpoch: null,
    createdAt: '2026-08-29T19:00:00.000Z',
    previousArchiveSha256: null,
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: 'a'.repeat(64),
    sizeBytes: 4096,
    frameCount: 8,
    headerSha256: 'b'.repeat(64),
    manifestSha256: 'c'.repeat(64),
    entryCount: 4,
    tableCount: 49,
    ...overrides,
  }
}

/** Returns one internally complete verification proof for its issued identity. */
function verificationProof(overrides: Readonly<Record<string, unknown>> = {}) {
  const identity = Object.fromEntries(
    Object.entries(verificationIdentity())
      .filter(([key]) => key !== 'entryCount' && key !== 'tableCount'),
  )
  const tables = verificationTables()
  return {
    proofVersion: 1,
    exhaustive: true,
    ...identity,
    frameCount: 8,
    headerSha256: 'b'.repeat(64),
    manifestSha256: 'c'.repeat(64),
    custodyFileIdentity: {
      changedTimeNanoseconds: '200',
      device: '1',
      inode: '2',
      linkCount: 1,
      modifiedTimeNanoseconds: '100',
      sizeBytes: 4096,
    },
    layers: {
      ciphertext: { exhaustive: true, matched: true },
      authenticatedFrames: { exhaustive: true, matched: true },
      entries: { exhaustive: true, matched: true, count: 4 },
      inventory: { exhaustive: true, matched: true, tableCount: 49 },
      gpxSourceBytes: {
        exhaustive: true,
        matched: true,
        recordCount: 0,
        exactBytesCount: 0,
        legacyHashOnlyCount: 0,
        legacyUnavailableCount: 0,
        failureUnavailableCount: 0,
        exactSourceCustodyComplete: true,
      },
      attachments: { exhaustive: true, matched: true, count: 0 },
    },
    tables,
    tableLedgerSha256: createHash('sha256').update(canonicalJson(tables)).digest('hex'),
    replaySemantic: verificationReplaySemantic(),
    durationMs: 500,
    plaintextSweepConfirmed: true,
    ...overrides,
  }
}

describe('archive worker envelope', () => {
  it('returns a closed immutable create request without changing the secret', () => {
    const normalized = normalizeArchiveCreateRequest(createRequest())
    expect(normalized).toEqual(createRequest())
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(() => normalizeArchiveCreateRequest({
      ...createRequest(),
      undeclared: true,
    })).toThrowError(expect.objectContaining({
      name: 'ArchiveEnvelopeError',
      code: 'ARCHIVE_ENVELOPE_INVALID_REQUEST',
    }))
  })

  it('rejects weak, unbounded and wrong-typed credentials before worker dispatch', () => {
    for (const passphrase of [
      'too short',
      'onlylowercaseletters',
      'A'.repeat(1_025),
      Buffer.alloc(32),
    ]) {
      expect(() => normalizeArchiveCreateRequest(createRequest({ passphrase })))
        .toThrow(ArchiveEnvelopeError)
    }
    for (const recoveryCode of [
      'too-short',
      'OOOOO-OOOOO-OOOOO-OOOOO-OOOOO-OOOOO-OOOOO-OOOOO',
      'A'.repeat(1_025),
      Buffer.alloc(32),
    ]) {
      expect(() => normalizeArchiveCreateRequest(createRequest({ recoveryCode })))
        .toThrow(ArchiveEnvelopeError)
    }
  })

  it('rejects path, identity, epoch, timestamp, chain and archive-kind substitution', () => {
    for (const overrides of [
      { operationId: '../escape' },
      { archiveId: 'not-a-uuid' },
      { databasePath: 'relative.sqlite' },
      { archiveDirectory: 'relative-archives' },
      { missionId: 'mission\u0000alpha' },
      { requestEventRowid: 0 },
      { archiveKind: 'unknown' },
      { createdAt: '29 August' },
      { previousArchiveSha256: 'A'.repeat(64) },
    ]) {
      expect(() => normalizeArchiveCreateRequest(createRequest(overrides)))
        .toThrow(ArchiveEnvelopeError)
    }
  })

  it('accepts only an exact identity-bound non-secret worker result', () => {
    const result = {
      type: 'complete',
      operationId,
      archiveId,
      missionId: 'mission-alpha',
      requestEventRowid: 42,
      requestEventId: '33333333-3333-4333-8333-333333333333',
      protectedFinalizationEpoch: null,
      archiveKind: 'finalized',
      containerVersion: 2,
      schemaVersion: 13,
      inventoryVersion: 1,
      temporaryRelativePath: `.staging/${operationId}/${archiveId}.sararch.tmp`,
      finalRelativePath: `${archiveId}.sararch`,
      ciphertextSha256: 'a'.repeat(64),
      sizeBytes: 4096,
      temporaryFileIdentity: {
        changedTimeNanoseconds: '4',
        device: '1',
        inode: '2',
        linkCount: 1,
        modifiedTimeNanoseconds: '3',
        sizeBytes: 4096,
      },
      frameCount: 8,
      headerSha256: 'd'.repeat(64),
      plaintextSweepConfirmed: true,
      slots: [
        { slotType: 'passphrase', slotId: 'passphrase-main' },
        { slotType: 'recovery', slotId: 'recovery-main' },
      ],
      manifestSummary: {
        entryCount: 4,
        tableCount: 49,
        inventorySha256: 'b'.repeat(64),
        manifestSha256: 'e'.repeat(64),
      },
      kdfDurationMs: 250,
    }
    const normalized = normalizeArchiveCreateResult(result, createRequest())
    expect(normalized).toEqual(result)
    expect(Object.isFrozen(normalized)).toBe(true)

    for (const mutation of [
      { missionId: 'mission-bravo' },
      { requestEventRowid: 43 },
      { temporaryRelativePath: '../outside.tmp' },
      { ciphertextSha256: 'c'.repeat(63) },
      { temporaryFileIdentity: {
        changedTimeNanoseconds: '4', device: '1', inode: '2', linkCount: 1,
        modifiedTimeNanoseconds: '3', sizeBytes: 4097,
      } },
      { recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567' },
      { slots: [{ slotType: 'machine', slotId: 'machine' }] },
    ]) {
      expect(() => normalizeArchiveCreateResult({ ...result, ...mutation }, createRequest()))
        .toThrow(ArchiveEnvelopeError)
    }
  })

  it('bounds and closes progress messages to the exact operation', () => {
    expect(normalizeArchiveProgress({
      type: 'progress',
      operationId,
      sequence: 4,
      phase: 'extract',
      unit: 'rows',
      completed: 50,
      total: 100,
      detail: 'positions',
    }, operationId)).toEqual({
      sequence: 4,
      phase: 'extract',
      unit: 'rows',
      completed: 50,
      total: 100,
      detail: 'positions',
    })
    expect(() => normalizeArchiveProgress({
      type: 'progress',
      operationId: archiveId,
      sequence: 1,
      phase: 'extract',
      unit: 'rows',
      completed: 1,
      total: 1,
      detail: 'positions',
    }, operationId)).toThrow(ArchiveEnvelopeError)
  })

  it('accepts only a proof bound to the exact registry-issued final path identity', () => {
    const proof = verificationProof()
    expect(normalizeArchiveVerificationProofForIdentity(
      proof,
      verificationIdentity(),
    )).toEqual(proof)

    for (const expectedMutation of [
      { requestEventId: undefined },
      { archiveRelativePath: `.staging/${operationId}/${archiveId}.sararch.tmp` },
      { archiveId: 'not-a-uuid' },
      { frameCount: 9 },
      { manifestSha256: 'e'.repeat(64) },
      { entryCount: 5 },
    ]) {
      expect(() => normalizeArchiveVerificationProofForIdentity(
        proof,
        verificationIdentity(expectedMutation),
      )).toThrow(ArchiveEnvelopeError)
    }
    expect(() => normalizeArchiveVerificationProofForIdentity(
      verificationProof({ archiveRelativePath: 'alternate.sararch' }),
      verificationIdentity(),
    )).toThrow(ArchiveEnvelopeError)
    for (const archiveRelativePath of [
      `.staging/${operationId}/${archiveId}.sararch.tmp`,
      `nested/${archiveId}.sararch`,
      '44444444-4444-4444-8444-444444444444.sararch',
    ]) {
      expect(() => normalizeArchiveVerificationProofForIdentity(
        verificationProof({ archiveRelativePath }),
        verificationIdentity({ archiveRelativePath }),
      )).toThrow(ArchiveEnvelopeError)
    }
  })

  it('rejects internally contradictory or structurally incomplete completeness proofs', () => {
    const base = verificationProof()
    const baseLayers = base.layers as Readonly<Record<string, unknown>>
    const baseGpx = baseLayers.gpxSourceBytes as Readonly<Record<string, unknown>>
    const baseTables = base.tables as readonly Readonly<Record<string, unknown>>[]
    const baseReplay = base.replaySemantic as Readonly<Record<string, unknown>>
    const baseSamples = baseReplay.samples as readonly Readonly<Record<string, unknown>>[]
    const mutations = [
      { frameCount: 1 },
      {
        custodyFileIdentity: {
          ...(base.custodyFileIdentity as Readonly<Record<string, unknown>>),
          sizeBytes: 4095,
        },
      },
      { layers: { ...baseLayers, entries: { exhaustive: true, matched: true, count: 0 } } },
      { layers: { ...baseLayers, inventory: { exhaustive: true, matched: true, tableCount: 0 } } },
      { layers: { ...baseLayers, attachments: { exhaustive: true, matched: true, count: 1 } } },
      {
        layers: {
          ...baseLayers,
          gpxSourceBytes: { ...baseGpx, recordCount: 1 },
        },
      },
      {
        layers: {
          ...baseLayers,
          gpxSourceBytes: {
            ...baseGpx,
            legacyHashOnlyCount: 1,
            recordCount: 1,
            exactSourceCustodyComplete: true,
          },
        },
      },
      { tables: baseTables.slice(0, -1) },
      { tables: [{ ...baseTables[0], rowCount: -1 }, ...baseTables.slice(1)] },
      { tableLedgerSha256: 'f'.repeat(64) },
      { replaySemantic: { ...baseReplay, samples: baseSamples.slice(0, -1) } },
      {
        replaySemantic: {
          ...baseReplay,
          samples: [
            { ...baseSamples[0], sampledTrackCount: 1, totalTrackCount: 2 },
            ...baseSamples.slice(1),
          ],
        },
      },
      { replaySemantic: { ...baseReplay, baselineSha256: 'f'.repeat(64) } },
    ]
    for (const mutation of mutations) {
      expect(() => normalizeArchiveVerificationProofForIdentity(
        { ...base, ...mutation },
        verificationIdentity(),
      )).toThrow(ArchiveEnvelopeError)
    }
  })
})
