import { describe, expect, it } from 'vitest'
import { requiresAdvisoryJudge } from '../../scripts/qualification/candidate-control-plane.mjs'

describe('private live evidence and mandatory visual sibling', () => {
  const live = { contractId: 'C05', adapterId: 'live.get-only', proofMode: 'ci-appimage' }
  const browser = { contractId: 'C05', adapterId: 'suite.browser', proofMode: 'browser', mandatory: true }
  const registryCoverage = { contracts: [{ id: 'C05', judge: 'advisory' }] }
  it('keeps the browser judge mandatory while excluding private live media', () => {
    const definition = { bindings: [live, browser], registryCoverage }
    expect(requiresAdvisoryJudge(definition, live)).toBe(false)
    expect(requiresAdvisoryJudge(definition, browser)).toBe(true)
  })
  it('does not waive the family judge for a missing or optional visual sibling', () => {
    expect(requiresAdvisoryJudge({ bindings: [live], registryCoverage }, live)).toBe(true)
    expect(requiresAdvisoryJudge({ bindings: [live, { ...browser, mandatory: false }], registryCoverage }, live)).toBe(true)
  })
})
