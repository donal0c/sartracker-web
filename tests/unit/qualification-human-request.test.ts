import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../scripts/qualification/control-plane.mjs'
import { createHumanTrainingRequest, validateHumanTrainingSubmission } from '../../scripts/qualification/human-request.mjs'

const keys = generateKeyPairSync('ed25519')
const evidence = Buffer.from('{"sanitizedTrainingNotes":"synthetic test only"}')
const authority = { signerId: 'tester', machineId: 'original-host',
  publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  authorizationSha256: 'c'.repeat(64), profileSha256: 'd'.repeat(64), dataClass: 'synthetic' }
const context = { campaignId: 'test-campaign', definitionDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64),
  attemptId: 'attempt-test', variantId: 'original-machine-training', sourceSha: 'e'.repeat(40),
  artifactSha256: 'f'.repeat(64), createdAt: '2026-09-19T10:00:00.000Z' }

/** Sign deliberately synthetic test declarations; never create real acceptance. */
function submission(overrides: Record<string, unknown> = {}) {
  const payload = { schema: 'sartracker-team-training-evidence-v2', contractId: 'C29', proofMode: 'external-human',
    campaignId: context.campaignId, definitionDigest: context.definitionDigest, attemptId: context.attemptId,
    sourceSha: context.sourceSha, artifactSha256: context.artifactSha256,
    signerId: authority.signerId, machineId: authority.machineId, authorizationSha256: authority.authorizationSha256,
    profileSha256: authority.profileSha256, sessionKind: 'pre-release-original-machine-training', dataClass: 'synthetic',
    war13bCounted: false, originalMachine: true, sessionId: 'synthetic-session',
    startedAt: '2026-09-19T10:01:00.000Z', endedAt: '2026-09-19T10:30:00.000Z',
    primarySource: 'independent training reference', remainedAdvisory: true, fallbackSeconds: 30,
    comparisons: { opening: 1, transitions: 1, warnings: 1, close: 1, mismatches: 0 },
    stopTriggers: [], disposition: 'accepted', evidenceSha256: createHash('sha256').update(evidence).digest('hex'), ...overrides }
  return { payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64') }
}

describe('external human training request custody', () => {
  it('never copies a private signing key into a human request', () => {
    const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(() => createHumanTrainingRequest(context, { ...authority, publicKey: privateKey })).toThrow(/public key/iu)
  })
  it('creates a pending request and validates only attached, timely, independently bound acceptance', () => {
    const request = createHumanTrainingRequest(context, authority)
    expect(request.status).toBe('NEEDS_HUMAN_DECISION')
    expect(request).not.toHaveProperty('signature')
    expect(validateHumanTrainingSubmission(request, submission(), evidence, '2026-09-19T10:31:00.000Z')).toMatchObject({
      status: 'PASS', releaseEligible: false, fieldShadowEligible: false,
    })
  })
  it.each([
    { startedAt: '2026-09-19T09:00:00.000Z' },
    { endedAt: '2026-09-20T12:00:00.000Z' },
    { profileSha256: '0'.repeat(64) },
  ])('rejects signed stale or wrong-profile acceptance %j', (change) => {
    expect(() => validateHumanTrainingSubmission(createHumanTrainingRequest(context, authority), submission(change), evidence,
      '2026-09-19T10:31:00.000Z')).toThrow()
  })
  it('rejects evidence whose copied bytes differ and expired or future acceptance', () => {
    const request = createHumanTrainingRequest(context, authority)
    expect(() => validateHumanTrainingSubmission(request, submission(), Buffer.from('changed'), '2026-09-19T10:31:00.000Z')).toThrow()
    expect(() => validateHumanTrainingSubmission(request, submission(), evidence, '2026-09-19T10:15:00.000Z')).toThrow()
    expect(() => validateHumanTrainingSubmission(request, submission(), evidence, '2026-09-20T11:00:00.000Z')).toThrow()
  })
})
