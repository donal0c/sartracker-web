import { createHash } from 'node:crypto'
import { assertQualifiedAssets, assertReleaseAssetMetadata, assertReleaseUnchanged,
  parseSha256Manifest, validateRegressionRecord, validateReleaseProvenance } from '../../build/electron-release-lib.js'

/** Bind data-only future release and prior rollback identities without performing a release action. */
export function compileReleaseInputs(input, version) {
  const allowedKeys = ['releaseId', 'rollback', 'tag', ...(Object.hasOwn(input ?? {}, 'riskAuthorityPublicKeySha256') ? ['riskAuthorityPublicKeySha256'] : [])].sort()
  if (!input || Object.keys(input).sort().join(',') !== allowedKeys.join(',')
      || !Number.isSafeInteger(input.releaseId) || input.releaseId <= 0
      || input.tag !== `electron-v${version}` || !/^0\.1\.0-beta\.\d+(?:\.\d+)?$/u.test(version)
      || !input.rollback || Object.keys(input.rollback).sort().join(',') !== 'assets,releaseId,sourceSha,tag'
      || input.rollback.releaseId === input.releaseId || input.rollback.tag === input.tag) throw new Error('Release configuration requires exact distinct candidate and rollback data identities.')
  validateExpectedIdentity(input.rollback)
  if (input.riskAuthorityPublicKeySha256 !== undefined
      && !/^[a-f0-9]{64}$/u.test(input.riskAuthorityPublicKeySha256)) {
    throw new Error('Release repository-risk authority requires a valid reviewed public-key digest.')
  }
  return JSON.parse(JSON.stringify(input))
}

/** Reject malformed expected identifiers before any network operation can use them. */
export function validateExpectedIdentity(expected) {
  if (!Number.isSafeInteger(expected.releaseId) || expected.releaseId <= 0
      || !/^electron-v0\.1\.0-beta\.\d+(?:\.\d+)?$/u.test(expected.tag)
      || !/^[a-f0-9]{40}$/u.test(expected.sourceSha)
      || !Array.isArray(expected.assets) || expected.assets.length !== 2
      || expected.assets.some((asset) => !/^[A-Za-z0-9._-]+\.(?:AppImage|deb)$/u.test(asset.name)
        || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0)
      || new Set(expected.assets.map((asset) => asset.name)).size !== 2
      || !expected.assets.some((asset) => asset.name.endsWith('.AppImage'))
      || !expected.assets.some((asset) => asset.name.endsWith('.deb'))) throw new Error('Release expected identity is incomplete.')
}

/** Recompute exact draft/public transfer identity without upgrading either phase or authorising rollout. */
export function validateReleaseDownloadEvidence(report, expected) {
  validateExpectedIdentity(expected)
  if (!['prepublication', 'postpublication'].includes(report.phase)) throw new Error('Release evidence phase is invalid.')
  const qualification = { appImage: expected.assets.find((asset) => asset.name.endsWith('.AppImage')),
    deb: expected.assets.find((asset) => asset.name.endsWith('.deb')) }
  if (!qualification.appImage || !qualification.deb) throw new Error('Release must bind one AppImage and one Debian installer.')
  const manifestSha256 = createHash('sha256').update(report.manifest).digest('hex')
  for (const release of [report.before, report.after]) {
    if (release.id !== expected.releaseId || release.tag_name !== expected.tag || release.prerelease !== true
        || release.draft !== (report.phase === 'prepublication') || !Array.isArray(release.assets)
        || release.assets.length !== 3 || new Set(release.assets.map((asset) => asset.id)).size !== 3
        || new Set(release.assets.map((asset) => asset.name)).size !== 3) throw new Error('Release metadata phase or exact asset set differs.')
    validateReleaseProvenance(release.body, expected.sourceSha)
    validateRegressionRecord(release.body)
    assertQualifiedAssets(release.assets.map((asset) => asset.name), qualification, parseSha256Manifest(report.manifest))
    assertReleaseAssetMetadata(release.assets, qualification, manifestSha256)
  }
  assertReleaseUnchanged(report.before, report.after)
  if (report.tagBefore !== expected.sourceSha || report.tagAfter !== expected.sourceSha) throw new Error('Remote release tag moved or differs from the candidate.')
  const expectedDownloads = [...expected.assets,
    { name: 'SHA256SUMS', sha256: manifestSha256, bytes: Buffer.byteLength(report.manifest) }]
  if (!Array.isArray(report.downloads) || report.downloads.length !== 3
      || new Set(report.downloads.map((item) => item.name)).size !== 3) throw new Error('Fresh downloads must contain exactly all three assets.')
  for (const required of expectedDownloads) {
    const download = report.downloads.find((item) => item.name === required.name)
    const metadata = report.before.assets.find((item) => item.name === required.name)
    if (!download || download.sha256 !== required.sha256 || download.bytes !== required.bytes || metadata.size !== required.bytes
        || download.transport !== (report.phase === 'prepublication' ? 'authenticated-draft-api' : 'unauthenticated-public')
        || download.url !== `https://github.com/donal0c/sartracker-web/releases/download/${expected.tag}/${required.name}`) {
      throw new Error('Fresh release transfer bytes, path or authentication phase differs.')
    }
  }
  return Object.freeze({ status: 'PASS', phase: report.phase, releaseId: expected.releaseId,
    sourceSha: expected.sourceSha, manifestSha256, releaseEligible: false, teamRolloutEligible: false })
}
