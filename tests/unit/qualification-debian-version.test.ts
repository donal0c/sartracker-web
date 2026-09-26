import { describe, expect, it } from 'vitest'
import { debianVersionOf, validateCandidateDebianVersion } from '../../scripts/qualification/debian-candidate-version.mjs'

describe('exact electron-builder candidate Debian version', () => {
  it('maps only the reviewed beta candidate version to the builder tilde form', () => {
    expect(debianVersionOf('0.1.0-beta.13.2')).toBe('0.1.0~beta.13.2')
    expect(debianVersionOf('0.1.0-beta.13')).toBe('0.1.0~beta.13')
    expect(() => validateCandidateDebianVersion('0.1.0~beta.13.2', '0.1.0-beta.13.2')).not.toThrow()
  })
  it.each(['0.1.0~beta.13.1', '0.1.0-beta.13.2', '0.1.0~beta.13.2-1', '1:0.1.0~beta.13.2', '0.1.0~beta.13.2 '])(
    'rejects different or broadly normalized package version %s', (actual) => {
      expect(() => validateCandidateDebianVersion(actual, '0.1.0-beta.13.2')).toThrow()
    },
  )
  it.each(['0.1.0~beta.13.2', '0.1.0-beta.13.2-extra', 'v0.1.0-beta.13.2', '', null])(
    'rejects an unsupported candidate version %s', (candidate) => {
      expect(() => debianVersionOf(candidate)).toThrow()
    },
  )
})
