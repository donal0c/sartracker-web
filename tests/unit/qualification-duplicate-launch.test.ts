import { describe, expect, it } from 'vitest'

import { parseArgs } from '../../scripts/qualification/duplicate-launch-probe.mjs'
import { validateDuplicateLaunchReceipt } from '../../scripts/qualification/duplicate-launch-receipts.mjs'

type JsonObject = Record<string, unknown>

const expected = {
  appPath: '/tmp/sartracker/SARTracker.AppImage',
  appSha256: 'a'.repeat(64),
  sourceHead: 'b'.repeat(40),
  evidencePath: '/tmp/sartracker-evidence',
  profilePath: '/tmp/sartracker-evidence/.profile-duplicate',
}

/** Creates one independent synthetic duplicate-launch report. */
function report(): JsonObject {
  return {
    schemaVersion: 1,
    proofKind: 'duplicate-launch-v1',
    contractId: 'C26',
    source: { expectedHead: expected.sourceHead, observedHead: expected.sourceHead, dirty: false },
    app: { path: expected.appPath, sha256: expected.appSha256, sizeBytes: 1234 },
    invocation: {
      app: '--app', evidence: '--evidence', expectedHead: '--expected-head',
      networkBlocked: true, userDataPath: expected.profilePath,
    },
    profile: {
      path: expected.profilePath, userDataPath: expected.profilePath,
      observedUserDataPaths: [expected.profilePath, expected.profilePath],
      removed: true, usedSystemUserProfile: false,
    },
    primary: {
      first: { pid: 101, ready: true, windowCount: 1, stderr: stderr() },
      firstExit: { exitCode: 0, signal: null },
      afterSecondary: { pageResponsive: true, windowCount: 1 },
      restart: { pid: 103, ready: true, windowCount: 1, stderr: stderr() },
      restartExit: { exitCode: 0, signal: null },
    },
    secondary: {
      pid: 102, started: true, exited: true, exitCode: 0, signal: null,
      singleInstanceRejected: true, windowCount: 0, missionWriteAttempted: false,
      stderr: stderr(),
    },
    persistence: {
      missionId: 'mission-duplicate-proof',
      initial: snapshot(),
      afterSecondary: snapshot(),
      afterRestart: snapshot(),
      authoritative: { mainProcesses: 1, missions: 1, missionCreatedAudits: 1, duplicateMissions: 0, duplicateMissionCreatedAudits: 0 },
    },
    network: { blocked: true, httpRequests: 0, httpsRequests: 0 },
  }
}

/** Creates one bounded process stderr fact record. */
function stderr() {
  return { sha256: 'c'.repeat(64), byteLength: 0, lines: [] }
}

/** Creates one exact mission/audit snapshot. */
function snapshot() {
  return { missionIds: ['mission-duplicate-proof'], auditTypes: ['mission_created'] }
}

/** Returns a deep mutable copy for deliberate forgery tests. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('C26 duplicate-launch receipt', () => {
  it('accepts only the exact three launch flags', () => {
    expect(parseArgs([
      '--app', expected.appPath,
      '--evidence', expected.evidencePath,
      '--expected-head', expected.sourceHead,
    ])).toEqual({
      appPath: expected.appPath,
      evidencePath: expected.evidencePath,
      expectedHead: expected.sourceHead,
    })
    expect(() => parseArgs(['--app', expected.appPath])).toThrow(/requires --app/iu)
    expect(() => parseArgs([
      '--app', expected.appPath, '--evidence', expected.evidencePath,
      '--expected-head', expected.sourceHead, '--extra', 'value',
    ])).toThrow(/unknown/iu)
  })

  it('accepts exact primary/secondary/restart and persistence facts', () => {
    expect(validateDuplicateLaunchReceipt(report(), expected)).toMatchObject({
      contractId: 'C26', status: 'PASS', valid: true, passed: true, releaseEligible: false,
      failureReasons: [],
    })
  })

  it.each([
    ['secondary did not exit as a rejected duplicate', (value: JsonObject) => {
      ;(value.secondary as JsonObject).singleInstanceRejected = false
    }],
    ['duplicate mission', (value: JsonObject) => {
      ;(value.persistence as JsonObject).authoritative = {
        mainProcesses: 1, missions: 2, missionCreatedAudits: 2, duplicateMissions: 1, duplicateMissionCreatedAudits: 1,
      }
    }],
    ['forged green process verdict', (value: JsonObject) => {
      ;(value.primary as JsonObject).afterSecondary = { pageResponsive: false, windowCount: 1 }
    }],
    ['source or artifact substitution', (value: JsonObject) => {
      ;(value.app as JsonObject).sha256 = 'd'.repeat(64)
    }],
    ['network or user profile escape', (value: JsonObject) => {
      ;(value.network as JsonObject).httpsRequests = 1
    }],
  ])('rejects %s', (_label, mutate) => {
    const mutated = copy(report())
    mutate(mutated)
    expect(validateDuplicateLaunchReceipt(mutated, expected).valid).toBe(false)
  })

  it('rejects missing or duplicated identity snapshots and profile cleanup', () => {
    const missing = copy(report())
    delete (missing.persistence as JsonObject).afterRestart
    expect(validateDuplicateLaunchReceipt(missing, expected).valid).toBe(false)

    const duplicate = copy(report())
    ;(duplicate.persistence as JsonObject).afterRestart = snapshot()
    ;((duplicate.persistence as JsonObject).afterRestart as JsonObject).missionIds = [
      'mission-duplicate-proof', 'mission-duplicate-proof',
    ]
    expect(validateDuplicateLaunchReceipt(duplicate, expected).valid).toBe(false)

    const unclean = copy(report())
    ;(unclean.profile as JsonObject).removed = false
    expect(validateDuplicateLaunchReceipt(unclean, expected).valid).toBe(false)
  })
})
