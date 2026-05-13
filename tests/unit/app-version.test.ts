import { describe, expect, it } from 'vitest'

import { buildAppVersion } from '../../src/lib/app-version'

describe('app version formatting', () => {
  it('builds a display version with build metadata when available', () => {
    const display = buildAppVersion({ appVersionBase: '0.1.0', buildTag: 'run.123.sha.abc456' })

    expect(display).toBe('0.1.0+run.123.sha.abc456')
  })

  it('omits build metadata when build tag is local', () => {
    const display = buildAppVersion({ appVersionBase: '0.1.0', buildTag: 'local' })

    expect(display).toBe('0.1.0')
  })

  it('returns fallback values with whitespace trimmed', () => {
    const display = buildAppVersion({ appVersionBase: ' 0.1.0 ', buildTag: '  run.12.sha.aa11bb ' })

    expect(display).toBe('0.1.0+run.12.sha.aa11bb')
  })
})
