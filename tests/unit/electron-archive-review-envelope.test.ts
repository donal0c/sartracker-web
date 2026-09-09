import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

const {
  ARCHIVE_REVIEW_READ_METHODS,
  normalizeArchiveReviewCloseInput,
  normalizeArchiveReviewOpenInput,
  normalizeArchiveReviewPublicSession,
  normalizeArchiveReviewReadInput,
} = require('../../electron/archive-review-envelope.cjs') as {
  ARCHIVE_REVIEW_READ_METHODS: ReadonlySet<string>
  normalizeArchiveReviewOpenInput: (input: unknown) => Readonly<Record<string, unknown>>
  normalizeArchiveReviewCloseInput: (input: unknown) => Readonly<Record<string, unknown>>
  normalizeArchiveReviewPublicSession: (
    input: unknown,
    expected: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>
  normalizeArchiveReviewReadInput: (input: unknown) => Readonly<Record<string, unknown>>
}

const OPERATION_ID = '4df9ced7-acde-45dd-a95f-faf26de987d5'
const SESSION_ID = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
const ARCHIVE_ID = '13f8522c-d4b9-4320-839d-a54c6fdc47fe'
const MISSION_ID = 'mission-review-fixed'

describe('archive review envelopes', () => {
  it('accepts exactly one bounded non-machine credential without reflecting it', () => {
    const secret = 'Correct Horse Battery Staple 9!'
    expect(normalizeArchiveReviewOpenInput({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret,
    })).toEqual({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret,
    })

    expect(() => normalizeArchiveReviewOpenInput({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'machine',
      secret,
    })).toThrow(/passphrase or recovery/u)
    expect(() => normalizeArchiveReviewOpenInput({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'passphrase',
      secret,
      databasePath: '/tmp/leak.sqlite',
    })).toThrow(/unsupported fields/u)
  })

  it('enforces the frozen passphrase and canonical recovery-code rules at the main boundary', () => {
    for (const secret of [
      'short-A1!',
      'alllowercaseletters',
      'ALLUPPERCASELETTERS',
      'Valid-Looking9!\n',
    ]) {
      expect(() => normalizeArchiveReviewOpenInput({
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'passphrase',
        secret,
      })).toThrow(/credential|passphrase/iu)
    }

    const recoveryCode = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
    expect(normalizeArchiveReviewOpenInput({
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      containerVersion: 2,
      slotType: 'recovery',
      secret: recoveryCode,
    })).toMatchObject({ slotType: 'recovery', secret: recoveryCode })

    for (const secret of [
      recoveryCode.toLowerCase(),
      recoveryCode.replace('A', 'I'),
      recoveryCode.slice(0, -1),
      `${recoveryCode}\t`,
    ]) {
      expect(() => normalizeArchiveReviewOpenInput({
        operationId: OPERATION_ID,
        archiveId: ARCHIVE_ID,
        containerVersion: 2,
        slotType: 'recovery',
        secret,
      })).toThrow(/credential|recovery/iu)
    }
  })

  it('keeps the read boundary to a fixed allow-list with no mutation vocabulary', () => {
    expect([...ARCHIVE_REVIEW_READ_METHODS]).toEqual([
      'info',
      'listMissions',
      'readMissionReview',
      'cancelMissionReviewRead',
      'readMissionReplay',
      'readMissionReplayTrackChunk',
      'readMissionReplayObjectChunk',
      'readMissionReplayFilterPage',
      'cancelMissionReplay',
      'listMarkers',
      'listDevices',
      'listDrawings',
      'listHelicopters',
      'listGpxImports',
      'listGpxImportPage',
      'listSearchOperationPage',
      'listOutings',
      'listLayerCatalogMetadata',
      'listArchiveAttachmentPage',
      'openAttachment',
    ])
    expect([...ARCHIVE_REVIEW_READ_METHODS].some((method) =>
      /create|update|upsert|delete|retire|finalize|unlock|write/iu.test(method),
    )).toBe(false)

    expect(normalizeArchiveReviewReadInput({
      sessionId: SESSION_ID,
      requestId: OPERATION_ID,
      method: 'listMarkers',
      input: { missionId: MISSION_ID },
    })).toEqual({
      sessionId: SESSION_ID,
      requestId: OPERATION_ID,
      method: 'listMarkers',
      input: { missionId: MISSION_ID },
    })
    expect(() => normalizeArchiveReviewReadInput({
      sessionId: SESSION_ID,
      requestId: OPERATION_ID,
      method: 'upsertMarker',
      input: {},
    })).toThrow(/read-only/u)
    expect(() => normalizeArchiveReviewReadInput({
      sessionId: SESSION_ID,
      requestId: OPERATION_ID,
      method: 'recordMutationDenied',
      input: {},
    })).toThrow(/read-only/u)
  })

  it('returns explicit residual/custody metadata and no filesystem path', () => {
    const expected = {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      missionId: MISSION_ID,
      slotType: 'recovery',
    }
    const publicSession = normalizeArchiveReviewPublicSession({
      sessionId: SESSION_ID,
      archiveId: ARCHIVE_ID,
      missionId: MISSION_ID,
      containerVersion: 2,
      encrypted: true,
      verified: true,
      immutable: true,
      ciphertextSha256: 'a'.repeat(64),
      previousArchiveId: null,
      openedAt: '2026-08-30T09:00:00.000Z',
      plaintextResidual: 'permission_restricted_session_open',
    }, expected)

    expect(publicSession).toEqual({
      sessionId: SESSION_ID,
      archiveId: ARCHIVE_ID,
      missionId: MISSION_ID,
      containerVersion: 2,
      encrypted: true,
      verified: true,
      immutable: true,
      ciphertextSha256: 'a'.repeat(64),
      previousArchiveId: null,
      openedAt: '2026-08-30T09:00:00.000Z',
      plaintextResidual: 'permission_restricted_session_open',
    })
    expect(JSON.stringify(publicSession)).not.toMatch(/path|scratch|database/iu)
  })

  it('rejects security classifications that the preload would reject after IPC returns', () => {
    const expected = {
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      missionId: MISSION_ID,
      slotType: 'passphrase',
    }
    const base = {
      sessionId: SESSION_ID,
      archiveId: ARCHIVE_ID,
      missionId: MISSION_ID,
      immutable: true,
      previousArchiveId: null,
      openedAt: '2026-08-30T09:00:00.000Z',
      plaintextResidual: 'permission_restricted_session_open',
    }

    expect(() => normalizeArchiveReviewPublicSession({
      ...base,
      containerVersion: 2,
      encrypted: true,
      verified: true,
      ciphertextSha256: null,
    }, expected)).toThrow(/security classification|result.*invalid/iu)
    expect(() => normalizeArchiveReviewPublicSession({
      ...base,
      containerVersion: 1,
      encrypted: false,
      verified: false,
      ciphertextSha256: 'a'.repeat(64),
    }, expected)).toThrow(/security classification|result.*invalid/iu)
  })

  it('requires one exact sender-owned session identity for close', () => {
    expect(normalizeArchiveReviewCloseInput({ sessionId: SESSION_ID })).toEqual({
      sessionId: SESSION_ID,
    })
    expect(() => normalizeArchiveReviewCloseInput({
      sessionId: SESSION_ID,
      force: true,
    })).toThrow(/unsupported fields/u)
  })
})
