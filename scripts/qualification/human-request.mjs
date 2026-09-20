import { createHash, createPublicKey } from 'node:crypto'
import { canonicalJson } from './control-plane.mjs'
import { validateTeamEvidence } from './team-evidence.mjs'

const SESSION_KIND = 'pre-release-original-machine-training'
const SHA256 = /^[a-f0-9]{64}$/u

/** Reject private signing material before any authority data is persisted. */
export function validateHumanPublicKey(publicKey) {
  if (typeof publicKey !== 'string' || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----\r?\n?$/u.test(publicKey)
      || createPublicKey(publicKey).asymmetricKeyType !== 'ed25519') {
    throw new Error('Human authority requires an Ed25519 public key; private signing material must never enter the controller.')
  }
}

/** Parse one exact UTC timestamp without accepting timezone or normalization ambiguity. */
function utc(value) {
  const time = Date.parse(value)
  if (typeof value !== 'string' || !Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error('Human evidence requires exact UTC timestamps.')
  }
  return time
}

/**
 * Produce a request, never acceptance. The caller must obtain authority from
 * independently hashed campaign inputs, not from an incoming submission.
 */
export function createHumanTrainingRequest(context, authority) {
  for (const key of ['definitionDigest', 'inputDigest', 'artifactSha256']) {
    if (!SHA256.test(context[key])) throw new Error('Human request candidate identity is incomplete.')
  }
  for (const key of ['authorizationSha256', 'profileSha256']) {
    if (!SHA256.test(authority[key])) throw new Error('Human authority identity is incomplete.')
  }
  for (const value of [context.campaignId, context.attemptId, context.variantId, authority.signerId, authority.machineId]) {
    if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > 128) throw new Error('Human request named identity is missing.')
  }
  validateHumanPublicKey(authority.publicKey)
  if (!/^[a-f0-9]{40}$/u.test(context.sourceSha) || !['synthetic', 'replay', 'disposable-training'].includes(authority.dataClass)) throw new Error('Human request source, training data or authority is invalid.')
  const body = {
    schema: 'sartracker-human-training-request-v1', status: 'NEEDS_HUMAN_DECISION',
    contractId: 'C29', proofMode: 'external-human', sessionKind: SESSION_KIND,
    campaignId: context.campaignId, definitionDigest: context.definitionDigest, inputDigest: context.inputDigest,
    attemptId: context.attemptId, variantId: context.variantId, sourceSha: context.sourceSha,
    artifactSha256: context.artifactSha256, createdAt: context.createdAt,
    expiresAt: new Date(utc(context.createdAt) + 24 * 60 * 60 * 1000).toISOString(),
    authority: { signerId: authority.signerId, machineId: authority.machineId, publicKey: authority.publicKey,
      authorizationSha256: authority.authorizationSha256, profileSha256: authority.profileSha256, dataClass: authority.dataClass },
    releaseEligible: false, fieldShadowEligible: false,
  }
  return Object.freeze({ ...body, requestSha256: createHash('sha256').update(canonicalJson(body)).digest('hex') })
}

/**
 * Validate an externally signed acceptance against the rederived request and
 * copied evidence bytes. receivedAt is captured by ingestion; sealed replay
 * uses that same time, so a valid receipt does not expire retrospectively.
 */
export function validateHumanTrainingSubmission(request, envelope, evidenceBytes, receivedAt) {
  const recreated = createHumanTrainingRequest(request, request.authority)
  if (canonicalJson(recreated) !== canonicalJson(request)) throw new Error('Human request was changed or is malformed.')
  if (!Buffer.isBuffer(evidenceBytes) || evidenceBytes.length === 0 || evidenceBytes.length > 16 * 1024 * 1024) {
    throw new Error('Human evidence attachment must be nonempty and at most 16 MiB.')
  }
  const result = validateTeamEvidence(envelope, { ...request, ...request.authority })
  const payload = envelope.payload
  if (payload.profileSha256 !== request.authority.profileSha256
      || payload.evidenceSha256 !== createHash('sha256').update(evidenceBytes).digest('hex')) {
    throw new Error('Human profile or retained attachment identity differs from the bound input.')
  }
  if (utc(payload.startedAt) < utc(request.createdAt) || utc(payload.endedAt) > utc(receivedAt)
      || utc(receivedAt) > utc(request.expiresAt) || utc(receivedAt) < utc(request.createdAt)) {
    throw new Error('Human acceptance is stale, future-dated or outside this request window.')
  }
  return result
}
