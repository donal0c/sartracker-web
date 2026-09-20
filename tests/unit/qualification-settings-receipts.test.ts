import { describe, expect, it } from 'vitest'

import {
  SETTINGS_PROBE_DESCRIPTOR,
  validateSettingsContractEvidence,
} from '../../scripts/qualification/settings-receipts.mjs'

const SHA1 = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const ASAR_SHA256 = 'c'.repeat(64)
const EXECUTABLE_SHA256 = 'd'.repeat(64)
const BASE_URL_SHA256 = 'e'.repeat(64)
const FILE_SHA256 = 'f'.repeat(64)
const SECRET_A_SHA256 = '1'.repeat(64)
const SECRET_B_SHA256 = '2'.repeat(64)
const GENERATION_ONE = '11111111-1111-4111-8111-111111111111'
const GENERATION_TWO = '22222222-2222-4222-8222-222222222222'
const GENERATION_THREE = '33333333-3333-4333-8333-333333333333'

const expected = {
  proofMode: 'packaged-electron-disposable-settings',
  source: { expectedHead: SHA1, tree: TREE },
  artifact: {
    packagedApplicationArchiveSha256: ASAR_SHA256,
    packagedExecutableSha256: EXECUTABLE_SHA256,
  },
  workload: {
    profileId: 'synthetic-disposable-settings',
    providerType: 'traccar_http',
    baseUrlSha256: BASE_URL_SHA256,
  },
  process: { tier: 'packaged-electron-disposable-settings' },
}

/** Build a deterministic settings projection for a probe receipt fixture. */
function snapshot({
  fileSha256,
  generation,
  secretState,
  secretSha256 = null,
  secretPresent,
}: {
  fileSha256: string
  generation: string | null
  secretState: 'legacy' | 'present' | 'cleared'
  secretSha256?: string | null
  secretPresent: boolean
}) {
  return {
    settingsFile: {
      present: true,
      sha256: fileSha256,
      credentialGeneration: generation,
      dataSource: {
        providerType: 'traccar_http',
        authMode: 'basic',
        baseUrlSha256: BASE_URL_SHA256,
        emailSha256: FILE_SHA256,
        autoConnect: false,
        trackingCacheEnabled: true,
      },
    },
    credentialsFile: secretState === 'legacy'
      ? {
          present: false,
          sha256: null,
          version: 2,
          authMode: 'basic',
          generation: null,
          secretState,
          secretSha256: null,
        }
      : {
          present: true,
          sha256: fileSha256,
          version: 2,
          authMode: 'basic',
          generation,
          secretState,
          secretSha256,
        },
    view: {
      providerType: 'traccar_http',
      authMode: 'basic',
      baseUrlSha256: BASE_URL_SHA256,
      emailSha256: FILE_SHA256,
      autoConnect: false,
      trackingCacheEnabled: true,
      secretPresent,
    },
  }
}

/** Build a report-shaped fixture; this is synthetic unit-test data only. */
function report(overrides: Record<string, unknown> = {}) {
  const baseline = snapshot({
    fileSha256: FILE_SHA256,
    generation: null,
    secretState: 'legacy',
    secretPresent: true,
  })
  const afterSave = snapshot({
    fileSha256: 'a'.repeat(64),
    generation: GENERATION_ONE,
    secretState: 'present',
    secretSha256: SECRET_A_SHA256,
    secretPresent: true,
  })
  const afterClear = snapshot({
    fileSha256: 'b'.repeat(64),
    generation: GENERATION_TWO,
    secretState: 'cleared',
    secretPresent: false,
  })
  const afterReentry = snapshot({
    fileSha256: 'c'.repeat(64),
    generation: GENERATION_THREE,
    secretState: 'present',
    secretSha256: SECRET_B_SHA256,
    secretPresent: true,
  })
  return {
    schemaVersion: 1,
    proofKind: 'sartracker-settings-probe-v1',
    contractId: 'C16',
    source: { head: SHA1, tree: TREE, worktreeClean: true },
    buildIdentity: {
      packaged: true,
      appBasename: 'SARTracker.AppImage',
      asarSha256: ASAR_SHA256,
      executableSha256: EXECUTABLE_SHA256,
    },
    process: { tier: 'packaged-electron-disposable-settings' },
    workload: {
      profileId: 'synthetic-disposable-settings',
      providerType: 'traccar_http',
      baseUrlSha256: BASE_URL_SHA256,
      networkContactAttempted: false,
    },
    startup: {
      shellReached: true,
      runtimeFaultVisible: false,
      trackingWarning: {
        exactText: 'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.',
        actionable: true,
        actions: ['open-settings-workspace', 'settings-provider-secret'],
      },
      initialSettings: baseline.view,
    },
    sessions: {
      saveRestartReadback: {
        before: baseline,
        afterSave,
        afterRestart: afterSave,
      },
      clearSecretRestart: {
        before: afterSave,
        afterSave: afterClear,
        afterRestart: afterClear,
      },
      reentrySecretRestart: {
        before: afterClear,
        afterSave: afterReentry,
        afterRestart: afterReentry,
      },
    },
    urlCredentials: {
      attempted: true,
      rejected: true,
      saveDisabled: true,
      message: 'Provider URL must not include embedded credentials. Enter credentials in the authentication fields.',
    },
    custody: {
      rawSecretValuesIncluded: false,
      secretCanaryAbsent: true,
      legacyCiphertextCanaryAbsent: true,
    },
    result: 'fail',
    failures: ['embedded producer verdict is intentionally ignored'],
    ...overrides,
  }
}

describe('qualification C16 settings receipt validator', () => {
  it('publishes the exact packaged probe invocation and bounded coverage', () => {
    expect(SETTINGS_PROBE_DESCRIPTOR.contractIds).toEqual(['C16'])
    expect(SETTINGS_PROBE_DESCRIPTOR.cli.required).toEqual(['--app', '--evidence', '--expected-head'])
    expect(SETTINGS_PROBE_DESCRIPTOR.reportPath).toBe('receipt.json')
    expect(SETTINGS_PROBE_DESCRIPTOR.coverage.some((item) => item.includes('synthetic disposable profile'))).toBe(true)
    expect(SETTINGS_PROBE_DESCRIPTOR.uncoveredAxes.join('\n')).toMatch(/real provider|field|installed/iu)
  })

  it('recomputes save, restart, clear, re-entry and URL rejection predicates', () => {
    const result = validateSettingsContractEvidence('C16', report(), expected)
    expect(result.passed).toBe(true)
    expect(result.recomputedPredicates).toEqual({
      identity: true,
      startupRecovery: true,
      saveRestartReadback: true,
      clearSecretRestart: true,
      reentryRestart: true,
      urlCredentialRejection: true,
      custody: true,
    })
    expect(result.coverageComplete).toBe(false)
    expect(result.qualificationEligible).toBe(false)
    expect(result.releaseEligible).toBe(false)
  })

  it('ignores a forged producer verdict when a raw generation predicate fails', () => {
    const tampered = report() as { sessions: { saveRestartReadback: { afterRestart: { settingsFile: { credentialGeneration: string } } } } }
    tampered.sessions.saveRestartReadback.afterRestart.settingsFile.credentialGeneration = GENERATION_TWO
    const result = validateSettingsContractEvidence('C16', tampered, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/restart|generation|readback/iu)
  })

  it('rejects any raw-secret or canary custody claim', () => {
    const result = validateSettingsContractEvidence('C16', report({
      custody: { rawSecretValuesIncluded: true, secretCanaryAbsent: false, legacyCiphertextCanaryAbsent: true },
    }), expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/secret|canary|custody/iu)
  })

  it('rejects a URL credential acceptance and a missing startup action', () => {
    const result = validateSettingsContractEvidence('C16', report({
      startup: {
        ...report().startup,
        trackingWarning: {
          ...report().startup.trackingWarning,
          actions: ['open-settings-workspace'],
        },
      },
      urlCredentials: { attempted: true, rejected: false, saveDisabled: false, message: 'accepted' },
    }), expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/URL|credential|action/iu)
  })

  it('fails closed when expected source, artifact, workload or process facts do not bind', () => {
    expect(() => validateSettingsContractEvidence('C16', report(), {
      ...expected,
      source: { expectedHead: 'bad', tree: TREE },
    })).toThrow(/source|SHA|head/iu)

    expect(() => validateSettingsContractEvidence('C16', report(), {
      ...expected,
      process: { tier: 'small-ci-profile' },
    })).toThrow(/process|tier/iu)
  })

  it('rejects unsupported contract identifiers', () => {
    expect(() => validateSettingsContractEvidence('C15', report(), expected)).toThrow(/C16/iu)
  })
})
