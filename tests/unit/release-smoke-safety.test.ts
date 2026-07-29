import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  fileSnapshotsMatch,
  hasBreadcrumbReconciliationWarning,
} from '../../build/release-smoke-lib.js'

describe('live breadcrumb reconciliation smoke guard [DON-260]', () => {
  it('distinguishes an active or failed reconciliation warning from healthy status', () => {
    expect(
      hasBreadcrumbReconciliationWarning(
        'Online. Breadcrumb history is reconciling for Rescue 12.',
      ),
    ).toBe(true)
    expect(
      hasBreadcrumbReconciliationWarning(
        'Online. Tracking breadcrumb reconciliation failed for Rescue 12.',
      ),
    ).toBe(true)
    expect(
      hasBreadcrumbReconciliationWarning(
        'Online. Breadcrumb history incomplete for Rescue 12; current fixes remain live.',
      ),
    ).toBe(true)
    expect(
      hasBreadcrumbReconciliationWarning(
        'Online. Breadcrumb history could not be loaded from mission storage.',
      ),
    ).toBe(true)
    expect(
      hasBreadcrumbReconciliationWarning(
        'Online. Current fixes loaded; loading breadcrumb history.',
      ),
    ).toBe(true)
    expect(hasBreadcrumbReconciliationWarning('Online. 32 devices. 8 fixes.')).toBe(false)
  })

  it('binds the live smoke to an exact executable digest and requires reconciliation completion', () => {
    const source = readFileSync(
      'scripts/release-smoke/breadcrumb-live-traccar-smoke.mjs',
      'utf8',
    )
    expect(source).toContain("requiredEnvironment('SMOKE_EXPECTED_APP_SHA256')")
    expect(source).toContain('await assertFileSha256(appPath, expectedAppSha256)')
    expect(source).toContain('await waitForReconciliation(page)')
    expect(source).toContain("reconciliationComplete: true")
  })

  it('keeps credentials and the throwaway profile outside evidence and always removes them', () => {
    const source = readFileSync(
      'scripts/release-smoke/breadcrumb-live-traccar-smoke.mjs',
      'utf8',
    )
    expect(source).toContain("mkdtemp(path.join(os.tmpdir(), 'sartracker-live-traccar-'))")
    expect(source).not.toContain("path.join(evidenceDir, 'user-data')")
    expect(source).toContain('await rm(userDataRoot, { recursive: true, force: true })')
    expect(source).toContain('await assertEvidenceIsSanitized(')
  })
})

describe('newer-schema immutability smoke guard [DON-260]', () => {
  const initial = {
    'mission-store.sqlite': {
      bytes: 4096,
      sha256: 'a'.repeat(64),
    },
    'mission-store.sqlite-wal': {
      bytes: 1024,
      sha256: 'b'.repeat(64),
    },
  }

  it('requires the complete mission-store file set and hashes to remain identical', () => {
    expect(fileSnapshotsMatch(initial, structuredClone(initial))).toBe(true)

    const sameSizeMutation = structuredClone(initial)
    sameSizeMutation['mission-store.sqlite'].sha256 = 'c'.repeat(64)
    expect(fileSnapshotsMatch(initial, sameSizeMutation)).toBe(false)

    const extraSidecar = {
      ...structuredClone(initial),
      'mission-store.sqlite-shm': {
        bytes: 32768,
        sha256: 'd'.repeat(64),
      },
    }
    expect(fileSnapshotsMatch(initial, extraSidecar)).toBe(false)
  })

  it('binds the refusal smoke to an exact executable and snapshots database sidecars', () => {
    const source = readFileSync(
      'scripts/release-smoke/newer-schema-refusal-smoke.mjs',
      'utf8',
    )
    expect(source).toContain("requiredEnvironment('SMOKE_EXPECTED_APP_SHA256')")
    expect(source).toContain('await assertFileSha256(appPath, expectedAppSha256)')
    expect(source).toContain('snapshotMissionStoreFiles(userDataDir)')
    expect(source).toContain('fileSnapshotsMatch(filesBefore, filesAfter)')
    expect(source).not.toContain('bytesAfter === bytesBefore')
  })
})
