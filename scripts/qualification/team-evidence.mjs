import { createPublicKey, verify } from 'node:crypto'
import { canonicalJson } from './control-plane.mjs'

const SHA256 = /^[a-f0-9]{64}$/u
const SHA1 = /^[a-f0-9]{40}$/u
const PRE_RELEASE_SESSION_KIND = 'pre-release-original-machine-training'
const TRAINING_DATA_CLASSES = new Set(['synthetic', 'replay', 'disposable-training'])

/** Validate a closed record without trusting extra producer-supplied claims. */
function closedRecord(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`Invalid ${label} fields.`)
  }
}

/** Require a bounded nonempty textual identity, without reflecting private input. */
function text(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 256) {
    throw new Error(`Invalid ${label}.`)
  }
}

/**
 * Verify a named human's signed C29 attestation against independently bound
 * campaign inputs. This validates custody and required declarations, not the
 * truth of an unobserved session. The signer and authorization must be approved
 * externally and pinned before ingestion; a key supplied by the evidence is
 * never trusted. No key generation or acceptance fabrication occurs here.
 */
export function validateTeamEvidence(envelope, expected) {
  closedRecord(envelope, ['payload', 'signature'], 'team evidence envelope')
  const payload = envelope.payload
  closedRecord(payload, [
    'schema', 'contractId', 'proofMode', 'campaignId', 'definitionDigest', 'attemptId',
    'sourceSha', 'artifactSha256', 'signerId', 'authorizationSha256', 'machineId',
    'sessionKind', 'dataClass', 'war13bCounted', 'originalMachine', 'profileSha256', 'sessionId', 'startedAt', 'endedAt',
    'primarySource', 'remainedAdvisory', 'fallbackSeconds', 'comparisons',
    'stopTriggers', 'disposition', 'evidenceSha256',
  ], 'team evidence')
  if (payload.schema !== 'sartracker-team-training-evidence-v2' || payload.contractId !== 'C29'
      || payload.proofMode !== 'external-human') throw new Error('Invalid team evidence proof tier.')
  for (const field of ['campaignId', 'definitionDigest', 'attemptId', 'sourceSha', 'artifactSha256', 'signerId', 'authorizationSha256', 'machineId', 'sessionKind', 'dataClass']) {
    text(expected?.[field], `expected ${field}`)
    if (payload[field] !== expected[field]) throw new Error(`Team evidence ${field} identity differs.`)
  }
  if (expected.sessionKind !== PRE_RELEASE_SESSION_KIND || !TRAINING_DATA_CLASSES.has(expected.dataClass)) {
    throw new Error('Expected team evidence must be pre-release original-machine training.')
  }
  for (const field of ['definitionDigest', 'artifactSha256', 'authorizationSha256', 'profileSha256', 'evidenceSha256']) {
    if (!SHA256.test(payload[field])) throw new Error(`Invalid ${field} digest.`)
  }
  if (!SHA1.test(payload.sourceSha)) throw new Error('Invalid source SHA.')
  for (const field of ['sessionId', 'primarySource']) text(payload[field], field)
  const start = Date.parse(payload.startedAt)
  const end = Date.parse(payload.endedAt)
  if (typeof payload.startedAt !== 'string' || typeof payload.endedAt !== 'string'
      || !Number.isFinite(start) || !Number.isFinite(end) || end <= start
      || new Date(start).toISOString() !== payload.startedAt || new Date(end).toISOString() !== payload.endedAt) {
    throw new Error('Team session must have exact completed UTC timestamps.')
  }
  if (payload.sessionKind !== PRE_RELEASE_SESSION_KIND || !TRAINING_DATA_CLASSES.has(payload.dataClass)
      || payload.war13bCounted !== false || payload.originalMachine !== true || payload.remainedAdvisory !== true
      || payload.disposition !== 'accepted' || !Array.isArray(payload.stopTriggers)
      || payload.stopTriggers.length !== 0) throw new Error('Human acceptance is absent or a stop trigger remains.')
  if (!Number.isFinite(payload.fallbackSeconds) || payload.fallbackSeconds < 0
      || payload.fallbackSeconds > 60) throw new Error('Fallback exceeds the 60-second limit or is missing.')
  closedRecord(payload.comparisons, ['opening', 'transitions', 'warnings', 'close', 'mismatches'], 'comparison coverage')
  for (const phase of ['opening', 'transitions', 'warnings', 'close']) {
    if (!Number.isSafeInteger(payload.comparisons[phase]) || payload.comparisons[phase] < 1) {
      throw new Error(`Missing human comparison checkpoint: ${phase}.`)
    }
  }
  if (payload.comparisons.mismatches !== 0) throw new Error('Human comparisons contain an unresolved mismatch.')
  const publicKey = createPublicKey(expected.publicKey)
  if (publicKey.asymmetricKeyType !== 'ed25519' || typeof envelope.signature !== 'string'
      || !/^[A-Za-z0-9+/]{86}==$/u.test(envelope.signature)
      || !verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Team evidence signature is invalid or untrusted.')
  }
  return Object.freeze({
    status: 'PASS', authority: 'external-human', releaseEligible: false, fieldShadowEligible: false,
  })
}
