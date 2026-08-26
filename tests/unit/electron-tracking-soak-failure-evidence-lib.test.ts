import { describe, expect, it } from 'vitest'

import {
  createTrackingSoakFailureReport,
} from '../../build/electron-tracking-soak-failure-evidence-lib.js'

describe('tracking soak terminal failure evidence [DON-260]', () => {
  it('retains the allowlisted graceful-quit failure class', () => {
    const error = Object.assign(new Error('raw debugger path'), {
      trackingSoakLifecycleFailure: {
        failureClass: 'graceful_app_quit_failed',
      },
    })

    expect(createTrackingSoakFailureReport({
      profileName: 'ci',
      error,
      progress: { phase: 'closeout' },
    })).toMatchObject({
      failureClass: 'graceful_app_quit_failed',
      progress: { phase: 'closeout' },
    })
  })

  it('always reduces an unknown raw error to allowlisted progress and timing', () => {
    const report = createTrackingSoakFailureReport({
      recordedAt: '2026-08-11T02:57:36.000Z',
      profileName: 'extended',
      error: new Error(
        'provider secret for Device Alpha at 52.123456,-9.123456',
      ),
      progress: {
        phase: 'outward',
        direction: 'earlier',
        pageIndexFromLatest: 193,
        completedUiPageObservations: 194,
        completedDirectIpcQueries: 5,
        timing: {
          pageActionDurationMs: 850.1234,
          stableVerificationDurationMs: 1_250.4567,
          outwardTraversalDurationMs: 55_000.789,
        },
        rawDeviceName: 'Device Alpha',
      },
    })

    expect(report).toEqual({
      schemaVersion: 1,
      issue: 'DON-260',
      recordedAt: '2026-08-11T02:57:36.000Z',
      profileName: 'extended',
      passed: false,
      failureClass: 'unclassified_harness_error',
      progress: {
        phase: 'outward',
        direction: 'earlier',
        pageIndexFromLatest: 193,
        completedUiPageObservations: 194,
        completedDirectIpcQueries: 5,
        timing: {
          pageActionDurationMs: 850.123,
          stableVerificationDurationMs: 1_250.457,
          outwardTraversalDurationMs: 55_000.789,
        },
      },
    })
    expect(JSON.stringify(report)).not.toMatch(
      /provider secret|Device Alpha|52\.123456|-9\.123456|rawDeviceName/iu,
    )
  })

  it('retains only an allowlisted explicit gate class and specialized bounded envelope', () => {
    const error = Object.assign(new Error('raw terminal message'), {
      exactDotGateFailure: {
        failureClass: 'outward_traversal_limit',
      },
      exactDotPublicationFailure: {
        pageIndexFromLatest: 12,
        mismatchObservationCount: 3,
        expected: {
          valid: true,
          positionCount: 10_000,
          sha256: 'a'.repeat(64),
          range: {
            positionCount: 10_000,
            fromTimestamp: '2026-08-10T00:00:00.000Z',
            toTimestamp: '2026-08-10T01:00:00.000Z',
            firstSourcePositionId: 'private-id-1',
            lastSourcePositionId: 'private-id-2',
          },
        },
        firstMismatch: null,
        lastMismatch: null,
        rawDeviceName: 'Device Alpha',
        rawPath: '/private/operator/profile',
        coordinates: [-9.123456, 52.123456],
        secret: 'provider-secret',
      },
    })
    const report = createTrackingSoakFailureReport({
      recordedAt: '2026-08-11T02:57:36.000Z',
      profileName: 'extended',
      error,
      progress: { phase: 'outward' },
    })

    expect(report).toMatchObject({
      failureClass: 'outward_traversal_limit',
      exactDotPublicationFailure: {
        pageIndexFromLatest: 12,
        mismatchObservationCount: 3,
        expected: {
          valid: true,
          positionCount: 10_000,
          sha256: 'a'.repeat(64),
          range: {
            positionCount: 10_000,
            fromTimestamp: '2026-08-10T00:00:00.000Z',
            toTimestamp: '2026-08-10T01:00:00.000Z',
          },
        },
        firstMismatch: null,
        lastMismatch: null,
      },
    })
    expect(JSON.stringify(report)).not.toContain('raw terminal message')
    expect(JSON.stringify(report)).not.toMatch(
      /Device Alpha|private\/operator|private-id|9\.123456|52\.123456|provider-secret/iu,
    )
  })

  it('rebuilds current action evidence without losing bounded hit diagnostics', () => {
    const error = Object.assign(new Error('raw click secret'), {
      exactDotActionFailure: {
        action: 'earlier',
        pageIndexFromLatest: 12,
        failureClass: 'click_timeout_or_interception',
        first: {
          bbox: { x: -2, y: 3, width: 40, height: 20 },
          intercept: {
            tag: 'DIV',
            testId: 'devices-workspace',
            className: 'fixed inset-0',
            rawText: 'Device Alpha',
          },
        },
        last: null,
        coordinates: [-9.1, 52.1],
      },
    })

    const report = createTrackingSoakFailureReport({
      recordedAt: '2026-08-11T02:57:36.000Z',
      profileName: 'extended',
      error,
      progress: { phase: 'outward' },
    })

    expect(report).toMatchObject({
      failureClass: 'action_unavailable',
      exactDotActionFailure: {
        action: 'earlier',
        pageIndexFromLatest: 12,
        failureClass: 'click_timeout_or_interception',
        first: {
          bbox: { x: -2, y: 3, width: 40, height: 20 },
          intercept: {
            tag: 'div',
            testId: 'devices-workspace',
            className: 'fixed inset-0',
          },
        },
        last: null,
      },
    })
    expect(JSON.stringify(report)).not.toMatch(
      /raw click secret|Device Alpha|-9\.1|52\.1|rawText|coordinates/iu,
    )
  })

  it('classifies a closed renderer target and keeps only bounded lifecycle/guard state', () => {
    const report = createTrackingSoakFailureReport({
      recordedAt: '2026-08-11T02:57:36.000Z',
      profileName: 'extended',
      error: new Error('Target page, context or browser has been closed'),
      progress: {
        phase: 'tracking',
        launchNumber: 2,
        targetBatch: 896,
        currentBatch: 792,
      },
      rendererLifecycle: {
        pageCloseCount: 1,
        pageCrashCount: 0,
        browserDisconnectCount: 0,
        replacementPageCount: 0,
        mainFrameNavigationCount: 0,
        lastEvent: 'page_closed',
        rawUrl: 'https://private.invalid',
      },
      hostSleepGuard: {
        required: true,
        started: true,
        active: true,
        earlyExit: false,
        stopped: false,
        forced: false,
        pid: 12345,
      },
    })

    expect(report).toMatchObject({
      failureClass: 'browser_target_closed',
      progress: {
        phase: 'tracking',
        launchNumber: 2,
        targetBatch: 896,
        currentBatch: 792,
      },
      rendererLifecycle: {
        pageCloseCount: 1,
        pageCrashCount: 0,
        browserDisconnectCount: 0,
        replacementPageCount: 0,
        mainFrameNavigationCount: 0,
        lastEvent: 'page_closed',
      },
      hostSleepGuard: {
        required: true,
        started: true,
        active: true,
        earlyExit: false,
        stopped: false,
        forced: false,
      },
    })
    expect(JSON.stringify(report)).not.toMatch(/private\.invalid|12345|rawUrl|pid/iu)
  })

  it('classifies an unverified owned harness click without serializing raw errors', () => {
    const error = new Error('raw click target, route, and coordinates')
    Object.assign(error, {
      trackingSoakAuditFailure: {
        failureClass: 'owned_harness_click_unverified',
        rawTarget: 'private-device-name',
      },
    })

    const report = createTrackingSoakFailureReport({
      recordedAt: '2026-08-11T07:00:00.000Z',
      profileName: 'extended',
      error,
      progress: { phase: 'outward', pageIndexFromLatest: 42 },
    })

    expect(report).toMatchObject({
      failureClass: 'owned_harness_click_unverified',
      progress: { phase: 'outward', pageIndexFromLatest: 42 },
    })
    expect(JSON.stringify(report)).not.toMatch(
      /raw click|private-device|rawTarget|coordinates/iu,
    )
  })
})
