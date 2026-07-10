import { describe, expect, it } from 'vitest'

import {
  buildStorageKillProbeVerdict,
  parseStorageKillProbeArgs,
} from '../../build/electron-storage-diagnostics-kill-probe-lib.js'

describe('packaged storage diagnostics kill probe [DON-244]', () => {
  it('parses the packaged app, fixture, evidence, timeout, and Electron arguments', () => {
    expect(
      parseStorageKillProbeArgs([
        '--app',
        '/opt/sartracker.AppImage',
        '--fixture',
        '/fixtures/field.sqlite',
        '--evidence',
        '/evidence/kill-probe',
        '--timeout-ms',
        '180000',
        '--',
        '--no-sandbox',
        '--ozone-platform=x11',
      ]),
    ).toEqual({
      appPath: '/opt/sartracker.AppImage',
      fixturePath: '/fixtures/field.sqlite',
      evidenceDir: '/evidence/kill-probe',
      timeoutMs: 180_000,
      postRestartObservationMs: 35_000,
      extraArgs: ['--no-sandbox', '--ozone-platform=x11'],
    })
  })

  it('fails closed for missing inputs and invalid timeout values', () => {
    expect(() => parseStorageKillProbeArgs(['--fixture', '/f'])).toThrow('--app')
    expect(() => parseStorageKillProbeArgs(['--app', '/a'])).toThrow('--fixture')
    expect(() =>
      parseStorageKillProbeArgs(['--app', '/a', '--fixture', '/f', '--timeout-ms', '0']),
    ).toThrow('--timeout-ms')
  })

  it('passes only when the flushed validation marker survives restart and bundle export', () => {
    const verdict = buildStorageKillProbeVerdict({
      beforeKill: {
        activeOperation: { type: 'backup', stage: 'validation_started' },
      },
      afterRestart: {
        activeOperation: null,
        previousInterruptedOperation: { type: 'backup', stage: 'validation_started' },
      },
      runtimeLog: [
        '{"event":"storage_backup_validation_started"}',
        '{"event":"storage_previous_run_interrupted"}',
        '{"event":"storage_main_event_loop_summary"}',
      ].join('\n'),
      supportBundle: [
        '[storage-diagnostics]',
        'previous interrupted operation: backup validation_started',
        'validation fixture preset: field',
        'event loop latest maximum delay ms: 5120',
      ].join('\n'),
      forbiddenValues: ['Private Mission Name', '/home/operator/private.sqlite'],
    })

    expect(verdict).toEqual({ passed: true, failures: [] })
  })

  it('reports missing lifecycle evidence and sensitive leakage as blocking failures', () => {
    const verdict = buildStorageKillProbeVerdict({
      beforeKill: { activeOperation: null },
      afterRestart: { previousInterruptedOperation: null },
      runtimeLog: '',
      supportBundle: 'Private Mission Name',
      forbiddenValues: ['Private Mission Name'],
    })

    expect(verdict.passed).toBe(false)
    expect(verdict.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('before kill'),
        expect.stringContaining('after restart'),
        expect.stringContaining('runtime log'),
        expect.stringContaining('support bundle'),
        expect.stringContaining('forbidden value'),
      ]),
    )
  })
})
