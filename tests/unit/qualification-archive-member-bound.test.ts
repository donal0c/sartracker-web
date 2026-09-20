import { describe, expect, it } from 'vitest'
import { parseArchiveMemberSize } from '../../scripts/qualification/candidate-artifacts.mjs'

describe('bounded CI archive extraction', () => {
  it('requires one exact member and its declared nonzero expanded size', () => {
    expect(parseArchiveMemberSize(' Length Date Time Name\n 123 2026-09-19 10:00 candidate.deb\n', 'candidate.deb')).toBe(123)
    expect(() => parseArchiveMemberSize(' 123 2026-09-19 10:00 other.deb\n', 'candidate.deb')).toThrow()
    expect(() => parseArchiveMemberSize(' 0 2026-09-19 10:00 candidate.deb\n', 'candidate.deb')).toThrow()
    expect(() => parseArchiveMemberSize(' 99999999999 2026-09-19 10:00 candidate.deb\n', 'candidate.deb')).toThrow()
    expect(() => parseArchiveMemberSize(' 1 2026-09-19 10:00 candidate.deb\n 1 2026-09-19 10:00 candidate.deb\n', 'candidate.deb')).toThrow()
  })
})
