import { describe, expect, it } from 'vitest'

import {
  parseArchiveSecurityPackagedArgs,
  validateRetainedPackagedArchiveSecurityReceipt,
} from '../../scripts/qualification/archive-security-packaged-probe.mjs'

const HEAD = 'a'.repeat(40)

describe('packaged C21 archive-security wrapper', () => {
  it('requires the exact app, evidence, and expected-head binding', () => {
    expect(parseArchiveSecurityPackagedArgs([
      '--app', '/tmp/SAR Tracker.AppImage', '--evidence', '/tmp/c21-evidence', '--expected-head', HEAD,
    ])).toEqual({
      appPath: '/tmp/SAR Tracker.AppImage',
      evidenceDir: '/tmp/c21-evidence',
      expectedHead: HEAD,
    })
    expect(() => parseArchiveSecurityPackagedArgs(['--app', 'relative', '--evidence', '/tmp/e', '--expected-head', HEAD]))
      .toThrow(/absolute/u)
    expect(() => parseArchiveSecurityPackagedArgs(['--app', '/tmp/a', '--evidence', '/tmp/e', '--expected-head', 'main']))
      .toThrow(/40-character/u)
  })

  it('does not treat a forged package receipt as valid without retained report and screenshot', async () => {
    const result = await validateRetainedPackagedArchiveSecurityReceipt({
      schema: 'c21-packaged-archive-security-v1',
      sourceSha: HEAD,
      runtime: null,
    }, '/tmp/c21-nonexistent-evidence')
    expect(result).toMatchObject({ valid: false, passed: false, status: 'INVALID_EVIDENCE' })
    expect(result.failureReasons.join(' ')).toMatch(/report|evidence|runtime/u)
  })
})
