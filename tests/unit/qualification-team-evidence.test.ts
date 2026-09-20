import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../scripts/qualification/control-plane.mjs'
import { validateTeamEvidence } from '../../scripts/qualification/team-evidence.mjs'

const keys = generateKeyPairSync('ed25519')
const sha = 'a'.repeat(64)
const context = {
  campaignId: 'test-only', definitionDigest: sha, attemptId: 'test-attempt',
  sourceSha: 'b'.repeat(40), artifactSha256: 'c'.repeat(64),
  signerId: 'test-reviewer', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  authorizationSha256: 'd'.repeat(64), machineId: 'test-original-machine',
  sessionKind: 'pre-release-original-machine-training', dataClass: 'synthetic',
}

/** Create a synthetic signed input for validator tests, never operational evidence. */
function envelope(overrides: Record<string, unknown> = {}) {
  const payload = {
    schema: 'sartracker-team-training-evidence-v2', contractId: 'C29', proofMode: 'external-human',
    campaignId: context.campaignId, definitionDigest: sha, attemptId: context.attemptId,
    sourceSha: context.sourceSha, artifactSha256: context.artifactSha256,
    signerId: context.signerId, authorizationSha256: context.authorizationSha256,
    machineId: context.machineId, sessionKind: context.sessionKind, dataClass: context.dataClass,
    war13bCounted: false, originalMachine: true, profileSha256: 'e'.repeat(64),
    sessionId: 'test-session', startedAt: '2026-09-19T10:00:00.000Z', endedAt: '2026-09-19T10:30:00.000Z',
    primarySource: 'independent training reference', remainedAdvisory: true,
    fallbackSeconds: 45, comparisons: { opening: 1, transitions: 2, warnings: 1, close: 1, mismatches: 0 },
    stopTriggers: [], disposition: 'accepted', evidenceSha256: 'f'.repeat(64),
    ...overrides,
  }
  return { payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64') }
}

describe('C29 external team evidence boundary', () => {
  it('validates a signed attestation without granting release authority', () => {
    expect(validateTeamEvidence(envelope(), context)).toEqual({
      status: 'PASS', authority: 'external-human', releaseEligible: false, fieldShadowEligible: false,
    })
  })
  it.each(['synthetic', 'replay', 'disposable-training'])('accepts the bounded %s data class', (dataClass) => {
    const sessionContext = { ...context, dataClass }
    expect(validateTeamEvidence(envelope({ dataClass }), sessionContext)).toMatchObject({
      status: 'PASS', releaseEligible: false, fieldShadowEligible: false,
    })
  })
  it.each([
    ['source', { sourceSha: '0'.repeat(40) }],
    ['artifact', { artifactSha256: '0'.repeat(64) }],
    ['attempt', { attemptId: 'other-attempt' }],
    ['definition', { definitionDigest: '0'.repeat(64) }],
    ['machine', { machineId: 'other-machine' }],
    ['original machine', { originalMachine: false }],
    ['authorization', { authorizationSha256: '0'.repeat(64) }],
    ['tier', { proofMode: 'browser' }],
    ['fallback', { fallbackSeconds: 61 }],
    ['advisory', { remainedAdvisory: false }],
    ['missing comparison', { comparisons: { opening: 1, transitions: 2, warnings: 0, close: 1, mismatches: 0 } }],
    ['mismatch', { comparisons: { opening: 1, transitions: 2, warnings: 1, close: 1, mismatches: 1 } }],
    ['unfinished', { endedAt: null }],
    ['stop', { stopTriggers: ['E2'] }],
    ['unaccepted', { disposition: 'pending' }],
    ['field session', { sessionKind: 'field-shadow' }],
    ['post-publication field shadow', { sessionKind: 'post-publication-field-shadow' }],
    ['real-incident data', { dataClass: 'real-incident' }],
    ['WAR-13B counted claim', { war13bCounted: true }],
    ['legacy team-shadow schema', { schema: 'sartracker-team-shadow-evidence-v1' }],
    ['extra fields', { automaticApproval: true }],
  ])('rejects %s evidence even if the supplied payload is signed', (_name, overrides) => {
    expect(() => validateTeamEvidence(envelope(overrides), context)).toThrow()
  })
  it('rejects changed payload bytes and untrusted signers', () => {
    const input = envelope()
    input.payload.fallbackSeconds = 30
    expect(() => validateTeamEvidence(input, context)).toThrow(/signature/u)
    const otherKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(() => validateTeamEvidence(envelope(), { ...context, publicKey: otherKey })).toThrow(/signature/u)
  })
  it('requires the independently expected pre-release session boundary', () => {
    expect(() => validateTeamEvidence(envelope(), { ...context, sessionKind: 'field-shadow' })).toThrow()
    expect(() => validateTeamEvidence(envelope(), { ...context, dataClass: 'real-incident' })).toThrow()
    expect(() => validateTeamEvidence(envelope(), { ...context, dataClass: 'replay' })).toThrow()
  })
})
