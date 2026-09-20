import { createHash, verify } from 'node:crypto'
import { canonicalJson } from './control-plane.mjs'
import { validateHumanPublicKey } from './human-request.mjs'

/** Reject extra fields so signed scope cannot hide an additional authority claim. */
function closed(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error('Repository risk decision fields differ from the closed scope.')
}

/** Parse an exact UTC time; sealed replay uses the retained original observation time. */
function utc(value) {
  const parsed = Date.parse(value)
  if (typeof value !== 'string' || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Repository risk decision timestamp is invalid.')
  return parsed
}

/**
 * Apply Donal's 2026-09-19 REL-004 policy: unmet safeguards block C27 unless
 * a separately supplied, trusted-key-signed exact-candidate decision accepts
 * every observed gap. This is neither C29 acceptance nor publication authority.
 */
export function validateRepositoryRiskDecision({ gaps, expected, observedAt, authority, acceptance }) {
  if (!Array.isArray(gaps) || gaps.some(gap => typeof gap !== 'string' || gap.length === 0)
      || new Set(gaps).size !== gaps.length) throw new Error('Repository safeguard gaps are malformed.')
  utc(observedAt)
  if (gaps.length === 0) return Object.freeze({ status: 'PASS', riskAccepted: false, releaseEligible: false })
  if (acceptance === undefined) return Object.freeze({ status: 'NEEDS_HUMAN_DECISION', gaps, riskAccepted: false, releaseEligible: false })
  closed(authority, ['signerId', 'publicKey'])
  if (authority.signerId !== 'donal0c') throw new Error('Repository risk authority must be Donal.')
  validateHumanPublicKey(authority.publicKey)
  closed(acceptance, ['payload', 'signature'])
  const payload = acceptance.payload
  closed(payload, ['schema', 'signerId', 'repository', 'contractId', 'riskId', 'sourceSha', 'tag', 'releaseId',
    'assets', 'acceptedGaps', 'rationale', 'compensatingControls', 'issuedAt', 'expiresAt', 'disposition', 'publicationAuthorized'])
  if (payload.schema !== 'sartracker-repository-risk-acceptance-v1' || payload.signerId !== authority.signerId
      || payload.repository !== 'donal0c/sartracker-web' || payload.contractId !== 'C27' || payload.riskId !== 'REL-004'
      || payload.disposition !== 'accept-repository-control-risk' || payload.publicationAuthorized !== false) throw new Error('Repository risk decision exceeds its permitted scope.')
  for (const key of ['sourceSha', 'tag', 'releaseId', 'assets']) {
    if (canonicalJson(payload[key]) !== canonicalJson(expected[key])) throw new Error('Repository risk decision candidate identity differs.')
  }
  if (!Array.isArray(payload.acceptedGaps) || canonicalJson([...payload.acceptedGaps].sort()) !== canonicalJson([...gaps].sort())) {
    throw new Error('Repository risk acceptance does not exactly cover observed gaps.')
  }
  for (const key of ['rationale', 'compensatingControls']) {
    if (typeof payload[key] !== 'string' || !payload[key].trim() || payload[key].length > 4096) throw new Error('Repository risk acceptance requires bounded rationale and compensating controls.')
  }
  const issued = utc(payload.issuedAt); const expires = utc(payload.expiresAt); const observed = utc(observedAt)
  if (issued > observed || expires <= observed || expires <= issued || expires - issued > 7 * 24 * 60 * 60 * 1000) {
    throw new Error('Repository risk acceptance is expired, future-dated or exceeds seven days.')
  }
  if (typeof acceptance.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/u.test(acceptance.signature)
      || !verify(null, Buffer.from(canonicalJson(payload)), authority.publicKey, Buffer.from(acceptance.signature, 'base64'))) throw new Error('Repository risk decision signature is invalid.')
  return Object.freeze({ status: 'PASS', riskAccepted: true, gaps, releaseEligible: false,
    acceptanceSha256: createHash('sha256').update(canonicalJson(acceptance)).digest('hex') })
}
