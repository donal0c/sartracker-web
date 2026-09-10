import { describe, expect, it } from 'vitest'
import { assertPackagedNativeRuntime } from '../../build/linux-package-policy.js'

const lock = { packages: {
  'node_modules/electron': { version: '99.2.3' },
  'node_modules/better-sqlite3': { version: '30.1.2' },
} }
const native = { electron: '99.2.3', betterSqlite3: '30.1.2', abi: '321', arch: 'x64', integrity: 'ok', value: 42 }

describe('locked packaged runtime policy [DON-146]', () => {
  it('qualifies the locked runtime without an unrelated historical version or ABI pin', () => {
    expect(() => assertPackagedNativeRuntime(lock, native)).not.toThrow()
  })
  it.each([
    ['electron', '99.2.2', '99.2.3'], ['betterSqlite3', '30.1.1', '30.1.2'],
    ['arch', 'arm64', 'x64'], ['integrity', 'corrupt', 'ok'], ['value', 0, 42],
  ])('reports expected and observed %s', (field, observed, expected) => {
    expect(() => assertPackagedNativeRuntime(lock, { ...native, [field]: observed }))
      .toThrow(`${field}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`)
  })
  it('rejects missing or malformed locked identities and missing ABI attestation', () => {
    expect(() => assertPackagedNativeRuntime({ packages: {} }, native)).toThrow(/locked electron/)
    expect(() => assertPackagedNativeRuntime({ packages: { ...lock.packages, 'node_modules/electron': { version: '^99.2.3' } } }, native)).toThrow(/locked electron/)
    expect(() => assertPackagedNativeRuntime(lock, { ...native, abi: '' })).toThrow(/abi/)
  })
})
