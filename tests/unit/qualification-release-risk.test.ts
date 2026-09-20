import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../scripts/qualification/control-plane.mjs'
import { validateRepositoryRiskDecision } from '../../scripts/qualification/repository-risk.mjs'

const keys = generateKeyPairSync('ed25519')
const authority = { signerId: 'donal0c', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const expected = { sourceSha: 'a'.repeat(40), tag: 'electron-v0.1.0-beta.13', releaseId: 123,
  assets: [{ name: 'candidate.AppImage', sha256: 'b'.repeat(64), bytes: 10 }, { name: 'candidate.deb', sha256: 'c'.repeat(64), bytes: 20 }] }
const gaps = ['required status-check enforcement is absent']
const now = '2026-09-19T22:00:00.000Z'
/** Sign only synthetic fixture decisions, never an operator acceptance. */
function envelope(overrides = {}) {
  const payload = { schema: 'sartracker-repository-risk-acceptance-v1', signerId: 'donal0c',
    repository: 'donal0c/sartracker-web', contractId: 'C27', riskId: 'REL-004',
    ...expected, acceptedGaps: gaps, rationale: 'Synthetic test-only bounded acceptance.',
    compensatingControls: 'Synthetic test-only review and retained CI.',
    issuedAt: '2026-09-19T21:00:00.000Z', expiresAt: '2026-09-20T21:00:00.000Z',
    disposition: 'accept-repository-control-risk', publicationAuthorized: false, ...overrides }
  return { payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64') }
}
describe('explicit repository safeguard risk decision', () => {
  it('blocks absent acceptance and never turns policy approval into actual risk acceptance', () => {
    expect(validateRepositoryRiskDecision({ gaps, expected, observedAt: now })).toMatchObject({ status: 'NEEDS_HUMAN_DECISION', releaseEligible: false })
  })
  it('passes met safeguards without requiring an exception', () => {
    expect(validateRepositoryRiskDecision({ gaps: [], expected, observedAt: now })).toMatchObject({ status: 'PASS', riskAccepted: false })
  })
  it('accepts only signed exact-candidate gaps, retaining the signed decision digest', () => {
    const acceptance = envelope()
    expect(validateRepositoryRiskDecision({ gaps, expected, observedAt: now, authority, acceptance })).toMatchObject({
      status: 'PASS', riskAccepted: true, releaseEligible: false,
      acceptanceSha256: createHash('sha256').update(canonicalJson(acceptance)).digest('hex'),
    })
  })
  it('rejects broader gaps, stale decisions, other candidates and untrusted keys', () => {
    const input = { gaps, expected, observedAt: now, authority, acceptance: envelope() }
    expect(() => validateRepositoryRiskDecision({ ...input, gaps: [...gaps, 'secret_scanning is disabled or unobservable'] })).toThrow(/gaps/i)
    expect(() => validateRepositoryRiskDecision({ ...input, observedAt: '2026-09-21T22:00:00.000Z' })).toThrow(/expired/i)
    expect(() => validateRepositoryRiskDecision({ ...input, acceptance: envelope({ sourceSha: 'f'.repeat(40) }) })).toThrow(/candidate/i)
    expect(() => validateRepositoryRiskDecision({ ...input, authority: { ...authority, signerId: 'another' } })).toThrow(/Donal/i)
    const changed = envelope(); changed.payload.rationale = 'Changed after signature'
    expect(() => validateRepositoryRiskDecision({ ...input, acceptance: changed })).toThrow(/signature/i)
  })
  it('cannot authorize publication or waive non-REL-004 gates', () => {
    expect(() => validateRepositoryRiskDecision({ gaps, expected, observedAt: now, authority,
      acceptance: envelope({ publicationAuthorized: true }) })).toThrow(/scope/i)
  })
})
