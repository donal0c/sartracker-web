import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  countDescendantElectronRenderers,
  createNewerSchemaRefusalExpectation,
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
    expect(source).toContain('optionalPositiveIntegerEnvironment(')
    expect(source).toContain("'SMOKE_RECONCILIATION_TIMEOUT_MS'")
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
    expect(source).toContain("requiredEnvironment('SMOKE_NEWER_SCHEMA_VERSION')")
    expect(source).toContain("requiredEnvironment('SMOKE_SUPPORTED_SCHEMA_VERSION')")
    expect(source).toContain('createNewerSchemaRefusalExpectation(')
    expect(source).toContain('await assertFileSha256(appPath, expectedAppSha256)')
    expect(source).toContain('snapshotMissionStoreFiles(userDataDir)')
    expect(source).toContain('fileSnapshotsMatch(filesBefore, filesAfter)')
    expect(source).toContain('dialogWindowId !== null')
    expect(source).toContain('await dismissErrorDialog(dialogWindowId)')
    expect(source).toMatch(/'mousemove',\s*'--window',\s*windowId/u)
    expect(source).not.toContain("['key', '--window', dialogWindowId, 'Return']")
    expect(source).toContain('processExit?.code === 1')
    expect(source).toContain('rendererProcessEvidence.maximum === 0')
    expect(source).toContain('rendererCdpSnapshot.pageCount === 0')
    expect(source).toContain('expectedMessagePresent')
    expect(source).toContain('filesUnchanged')
    expect(source).not.toContain('bytesAfter === bytesBefore')
    expect(source).not.toContain('newer mission store schema 6')
    expect(source).not.toContain('supports schema 5')
  })

  it('builds a fail-closed artifact-scoped newer-schema expectation', () => {
    expect(createNewerSchemaRefusalExpectation('8', '7')).toEqual({
      newerSchemaVersion: 8,
      supportedSchemaVersion: 7,
      expectedMessage:
        'Cannot open mission store created by newer mission store schema 8; this build supports schema 7.',
    })
    expect(() => createNewerSchemaRefusalExpectation('', '7')).toThrow(
      /newer schema version/iu,
    )
    expect(() => createNewerSchemaRefusalExpectation('8', '7.5')).toThrow(
      /supported schema version/iu,
    )
    expect(() => createNewerSchemaRefusalExpectation('7', '7')).toThrow(
      /must be newer/iu,
    )
    expect(() => createNewerSchemaRefusalExpectation('6', '7')).toThrow(
      /must be newer/iu,
    )
  })

  it('detects renderer processes anywhere below an AppImage wrapper process', () => {
    const processes = [
      { pid: 100, parentPid: 1, command: '/tmp/SAR.AppImage' },
      { pid: 101, parentPid: 100, command: '/tmp/.mount_SAR/app' },
      { pid: 102, parentPid: 101, command: '/tmp/.mount_SAR/app --type=gpu-process' },
      {
        pid: 103,
        parentPid: 101,
        command: '/tmp/.mount_SAR/app --type=renderer --lang=en-GB',
      },
      {
        pid: 104,
        parentPid: 999,
        command: '/other/electron --type=renderer',
      },
    ]

    expect(countDescendantElectronRenderers(processes, 100)).toBe(1)
    expect(countDescendantElectronRenderers(processes, 999)).toBe(1)
    expect(countDescendantElectronRenderers(processes, 102)).toBe(0)
  })
})
