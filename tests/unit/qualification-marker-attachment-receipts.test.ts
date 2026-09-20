import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { validateMarkerAttachmentReceipt } from '../../scripts/qualification/marker-attachment-receipts.mjs'

const sourceHead = 'a'.repeat(40)
const sourceTree = 'b'.repeat(40)
const executableSha256 = 'c'.repeat(64)
const archiveSha256 = 'd'.repeat(64)
const attachmentFileName = 'same-name.txt'
const originalBytes = Buffer.from('C12 original attachment bytes', 'utf8')
const replacementBytes = Buffer.from('C12 replacement attachment bytes', 'utf8')

const expected = {
  proofMode: 'packaged-electron-marker-attachment',
  source: { expectedHead: sourceHead, tree: sourceTree },
  artifact: {
    packagedExecutableSha256: executableSha256,
    packagedApplicationArchiveSha256: archiveSha256,
  },
  workload: {
    markerKinds: ['ipp_lkp', 'clue', 'hazard', 'casualty'],
    attachmentFileName,
  },
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function marker(type: string, index: number) {
  const auditEvents = [
    { id: `event-${index}-created`, eventType: 'marker_created', timestamp: '2026-09-19T10:00:00.000Z' },
    { id: `event-${index}-updated`, eventType: 'marker_updated', timestamp: '2026-09-19T10:00:01.000Z' },
    { id: `event-${index}-retired`, eventType: 'marker_deleted', timestamp: '2026-09-19T10:00:02.000Z' },
  ]
  return {
    type,
    markerId: `marker-${index}`,
    lifecycle: ['created', 'updated', 'retired'],
    versionOperations: ['created', 'updated', 'retired'],
    versionCount: 3,
    auditEvents,
    activeAfterRetire: false,
    updatedIdMatches: true,
  }
}

function report() {
  return {
    schemaVersion: 1,
    schema: 'sartracker-marker-attachment-probe-v1',
    proofMode: expected.proofMode,
    developmentTestHarness: false,
    proofTier: 'packaged-electron',
    source: { head: sourceHead, tree: sourceTree },
    artifact: { executableSha256, archiveSha256 },
    mission: { missionId: 'mission-c12', finished: true, activeMarkerCountAfterRetire: 0 },
    markers: expected.workload.markerKinds.map(marker),
    attachments: [
      {
        version: 'original',
        fileName: attachmentFileName,
        storedBasename: '11111111-1111-4111-8111-111111111111-same-name.txt',
        stored: { bytes: originalBytes.byteLength, sha256: sha256(originalBytes) },
        archive: {
          entryName: 'attachments/00000001-11111111-1111-4111-8111-111111111111-same-name.txt',
          sourceBasename: '11111111-1111-4111-8111-111111111111-same-name.txt',
          bytes: originalBytes.byteLength,
          sha256: sha256(originalBytes),
        },
        restored: {
          basename: '00000001-11111111-1111-4111-8111-111111111111-same-name.txt',
          sourceBasename: '11111111-1111-4111-8111-111111111111-same-name.txt',
          entryName: 'attachments/00000001-11111111-1111-4111-8111-111111111111-same-name.txt',
          bytes: originalBytes.byteLength,
          sha256: sha256(originalBytes),
        },
      },
      {
        version: 'replacement',
        fileName: attachmentFileName,
        storedBasename: '22222222-2222-4222-8222-222222222222-same-name.txt',
        stored: { bytes: replacementBytes.byteLength, sha256: sha256(replacementBytes) },
        archive: {
          entryName: 'attachments/00000002-22222222-2222-4222-8222-222222222222-same-name.txt',
          sourceBasename: '22222222-2222-4222-8222-222222222222-same-name.txt',
          bytes: replacementBytes.byteLength,
          sha256: sha256(replacementBytes),
        },
        restored: {
          basename: '00000002-22222222-2222-4222-8222-222222222222-same-name.txt',
          sourceBasename: '22222222-2222-4222-8222-222222222222-same-name.txt',
          entryName: 'attachments/00000002-22222222-2222-4222-8222-222222222222-same-name.txt',
          bytes: replacementBytes.byteLength,
          sha256: sha256(replacementBytes),
        },
      },
    ],
    archive: {
      finalized: true,
      containerVersion: 2,
      immutable: true,
      verified: true,
      review: {
        opened: true,
        closed: true,
        immutable: true,
        attachmentReferences: [
          { attachmentPath: '11111111-1111-4111-8111-111111111111-same-name.txt', referenceKind: 'marker_version', referenceId: 'version-1' },
          { attachmentPath: '22222222-2222-4222-8222-222222222222-same-name.txt', referenceKind: 'marker_version', referenceId: 'version-2' },
          { attachmentPath: '11111111-1111-4111-8111-111111111111-same-name.txt', referenceKind: 'marker_attachment_ingested', referenceId: 'event-1' },
          { attachmentPath: '22222222-2222-4222-8222-222222222222-same-name.txt', referenceKind: 'marker_attachment_ingested', referenceId: 'event-2' },
        ],
      },
    },
  }
}

describe('independent packaged marker and attachment receipt', () => {
  it('recomputes every marker lifecycle and same-name attachment custody predicate', () => {
    expect(validateMarkerAttachmentReceipt(report(), expected)).toMatchObject({
      passed: true,
      status: 'PASS',
      predicates: {
        identity: true,
        markerLifecycles: true,
        attachmentBytes: true,
        archiveCustody: true,
      },
    })
  })

  it('rejects forged producer verdicts and altered attachment bytes', () => {
    const changed = report()
    changed.attachments[1].stored.sha256 = sha256(Buffer.from('altered', 'utf8'))
    expect(validateMarkerAttachmentReceipt({ ...changed, verdict: { passed: true } }, expected).passed).toBe(false)
  })

  it('rejects forged inline bytes and out-of-order raw audit lifecycle events', () => {
    const inlineBytes = report()
    inlineBytes.attachments[0].contentBase64 = originalBytes.toString('base64')
    expect(validateMarkerAttachmentReceipt(inlineBytes, expected).passed).toBe(false)

    const reordered = report()
    reordered.markers[0].auditEvents.reverse()
    expect(validateMarkerAttachmentReceipt(reordered, expected).passed).toBe(false)
  })

  it('rejects stored, archive, or restored byte custody mismatches independently', () => {
    for (const field of ['stored', 'archive', 'restored'] as const) {
      const changed = report()
      if (field === 'restored') changed.attachments[0][field].sha256 = sha256(Buffer.from('changed', 'utf8'))
      else changed.attachments[0][field].bytes += 1
      expect(validateMarkerAttachmentReceipt(changed, expected).passed).toBe(false)
    }
  })

  it('rejects a missing marker kind, incomplete lifecycle, or absent superseded archive reference', () => {
    const missingKind = report()
    missingKind.markers = missingKind.markers.slice(1)
    expect(validateMarkerAttachmentReceipt(missingKind, expected).passed).toBe(false)

    const incomplete = report()
    incomplete.markers[0].versionOperations = ['created', 'updated']
    expect(validateMarkerAttachmentReceipt(incomplete, expected).passed).toBe(false)

    const noArchiveReplacement = report()
    noArchiveReplacement.archive.review.attachmentReferences = [
      noArchiveReplacement.archive.review.attachmentReferences[0],
    ]
    expect(validateMarkerAttachmentReceipt(noArchiveReplacement, expected).passed).toBe(false)
  })

  it('binds the receipt to the immutable source and observed package identity', () => {
    const changedSource = report()
    changedSource.source.head = 'e'.repeat(40)
    expect(validateMarkerAttachmentReceipt(changedSource, expected).passed).toBe(false)

    const changedArtifact = report()
    changedArtifact.artifact.archiveSha256 = 'f'.repeat(64)
    expect(validateMarkerAttachmentReceipt(changedArtifact, expected).passed).toBe(false)
  })
})
