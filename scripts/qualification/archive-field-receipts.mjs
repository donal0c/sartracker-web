import path from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { compareArchiveDatabaseSnapshots } from './archive-field-oracle.mjs'
import { canonicalJson } from './control-plane.mjs'

/** Enforce fixed large-ciphertext admission independently of producer assertions. */
export function validateArchiveFieldFacts(report, expected) {
  if (!['C20', 'C22'].includes(expected.contractId) || report?.schemaVersion !== 1
      || report.proofKind !== 'packaged-large-archive-v1' || report.contractId !== 'C20-C22'
      || report.variantId !== 'field-archive-37gb' || report.developmentTestHarness === true
      || report.source?.head !== expected.sourceSha || report.runtime?.executableSha256 !== expected.appSha256
      || !expected.asarSha256 || report.runtime?.asarSha256 !== expected.asarSha256) throw new Error('Large archive candidate identity differs.')
  if (report.sourceFixture?.preset !== 'field' || report.sourceFixture.sourceBytes < 3700000000
      || !/^[a-f0-9]{64}$/u.test(report.sourceFixture.sourceSha256)) throw new Error('Large archive source fixture is incomplete.')
  const archive = report.archive
  if (!archive || archive.thresholdBytes !== 3500000000 || !Number.isSafeInteger(archive.ciphertextBytes)
      || archive.ciphertextBytes < 3500000000 || archive.containerVersion !== 2 || archive.verified !== true
      || !archive.archiveId || !/^[a-f0-9]{64}$/u.test(archive.ciphertextSha256)) throw new Error('Large archive ciphertext threshold or identity is invalid.')
  if (['opened', 'immutable', 'verified', 'mutationDenied', 'plaintextCleanupComplete'].some(key => report.reviewRestore?.[key] !== true)) throw new Error('Large archive review and restore evidence is incomplete.')
  if (['applicationClosed', 'profileRemoved', 'reviewClosed', 'plaintextRemoved'].some(key => report.cleanup?.[key] !== true)
      || report.failure || report.run?.failure || report.cleanup?.failure) throw new Error('Large archive cleanup or execution failed.')
}

/** Re-read retained ciphertext and closed databases; producer digests are never the oracle. */
export async function validateArchiveFieldReceipt(report, expected) {
  validateArchiveFieldFacts(report, expected)
  const root = await realpath(expected.evidencePath)
  const fixture = report.sourceFixture
  await retainedIdentity(root, fixture.path, fixture.sourceSha256, fixture.sourceBytes)
  await retainedIdentity(root, fixture.privateCopyPath, fixture.sourceSha256, fixture.sourceBytes)
  const manifestFile = await retainedIdentity(root, fixture.manifestPath, fixture.manifestSha256)
  if (manifestFile.bytes > 8 * 1024 * 1024) throw new Error('Large archive fixture manifest exceeds its bound.')
  const manifest = JSON.parse(await readFile(manifestFile.path, 'utf8'))
  if (manifest.generatorVersion !== 2 || manifest.syntheticDataOnly !== true || manifest.preset !== 'field'
      || manifest.schemaVersion !== 13 || manifest.workload?.deviceCount !== 32
      || manifest.database?.sha256 !== fixture.sourceSha256 || manifest.database?.bytes !== fixture.sourceBytes) throw new Error('Large archive manifest does not bind the fixed field fixture.')
  await retainedIdentity(root, report.archive.archivePath, report.archive.ciphertextSha256, report.archive.ciphertextBytes)
  const before = await retainedIdentity(root, report.preArchive?.databasePath, report.preArchive?.sha256, report.preArchive?.bytes)
  const after = await retainedIdentity(root, report.reviewRestore.restoredDatabasePath, report.reviewRestore.restoredSha256, report.reviewRestore.restoredBytes)
  const sourceToFinished = await compareArchiveDatabaseSnapshots({ beforePath: fixture.privateCopyPath, afterPath: before.path, missionId: report.inventory?.missionId, phase: 'source-to-finished' })
  const inventory = await compareArchiveDatabaseSnapshots({ beforePath: before.path, afterPath: after.path, missionId: report.inventory?.missionId })
  if (canonicalJson(inventory) !== canonicalJson(report.inventory)) throw new Error('Large archive independently observed inventory differs.')
  return { inventory, sourceToFinished, gaps: [] }
}

/** Confine every retained file to the owned evidence tree and stream its actual identity. */
async function retainedIdentity(root, filename, sha256, bytes) {
  if (typeof filename !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256 ?? '')) throw new Error('Large archive retained file identity is missing.')
  const resolved = await realpath(filename)
  const relative = path.relative(root, resolved)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Large archive retained file escapes evidence custody.')
  const actual = await hashCandidateFile(resolved)
  if (actual.sha256 !== sha256 || bytes !== undefined && actual.bytes !== bytes) throw new Error('Large archive retained file identity differs.')
  return actual
}
