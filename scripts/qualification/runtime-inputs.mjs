import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  hashCandidateFile,
  inspectCiCandidateArchive,
  inspectInstalledCandidate,
  validateCanonicalInstalledExecutable,
  CANONICAL_INSTALLED_EXECUTABLE_PATH,
} from './candidate-artifacts.mjs'
import { hashLiveConfigDirectory } from './live-config-identity.mjs'
import { debianVersionOf } from './debian-candidate-version.mjs'

/** Require the explicitly documented data-only configuration fields. */
function closed(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error(`${label} has missing or unsupported fields.`)
}

/** Compare a declared identity with a fresh hash without treating either as CI provenance. */
async function boundFile(declared) {
  if (!declared || typeof declared.path !== 'string' || !path.isAbsolute(declared.path)) throw new Error('Runtime input path must be absolute.')
  const actual = declared.kind === 'live-config-directory'
    ? { ...await hashLiveConfigDirectory(declared.path), kind: 'live-config-directory' }
    : await hashCandidateFile(declared.path)
  if (actual.sha256 !== declared.sha256 || actual.bytes !== declared.bytes) throw new Error('Runtime input bytes differ from the supplied manifest.')
  return actual
}

/**
 * Compile data and paths only. Live GitHub provenance and actual installation
 * are deliberately still required at preflight; an input manifest is not proof.
 */
export async function compileRuntimeInputs(filename, source, version) {
  const identity = await hashCandidateFile(filename)
  if (identity.bytes === 0 || identity.bytes > 1024 * 1024) throw new Error('Runtime configuration must be bounded nonempty JSON.')
  const config = JSON.parse(await readFile(identity.path, 'utf8'))
  closed(config, ['schema', 'ci', 'installedExecutablePath', 'fixtures',
    ...(Object.hasOwn(config, 'enospcMount') ? ['enospcMount'] : [])], 'Runtime configuration')
  if (Object.hasOwn(config, 'enospcMount')) {
    if (typeof config.enospcMount !== 'string' || !path.isAbsolute(config.enospcMount)
        || await realpath(config.enospcMount) !== config.enospcMount
        || !(await stat(config.enospcMount)).isDirectory()) {
      throw new Error('ENOSPC mount input must name a canonical existing absolute directory; producer volume validation remains mandatory.')
    }
  }
  if (config.schema !== 'sartracker-candidate-runtime-inputs-v1'
      || config.ci?.schema !== 'sartracker-candidate-ci-artifacts-v1'
      || config.ci.version !== version || config.ci.provenance?.sourceSha !== source.sha
      || ![config.ci.provenance?.runId, config.ci.provenance?.runAttempt, config.ci.provenance?.artifactId].every((value) => Number.isSafeInteger(value) && value > 0)
      || config.installedExecutablePath !== CANONICAL_INSTALLED_EXECUTABLE_PATH
      || !Array.isArray(config.ci.installers) || config.ci.installers.length !== 2
      || config.ci.installers.map((entry) => entry.role).sort().join(',') !== 'ci-appimage,ci-deb'
      || !config.fixtures || typeof config.fixtures !== 'object' || Array.isArray(config.fixtures)) {
    throw new Error('Exact source, version, CI identifiers, installation path and two installer roles are required.')
  }
  const identities = [identity, await boundFile(config.ci.archive)]
  for (const installer of config.ci.installers) identities.push(await boundFile(installer))
  const fixtures = {}
  for (const [name, fixture] of Object.entries(config.fixtures)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(name)) throw new Error('Runtime fixture role is invalid.')
    closed(fixture, ['path', 'bytes', 'sha256'], 'Runtime fixture')
    fixtures[name] = await boundFile(name === 'live-config' ? { ...fixture, kind: 'live-config-directory' } : fixture)
    identities.push(fixtures[name])
  }
  const after = await hashCandidateFile(identity.path)
  if (after.sha256 !== identity.sha256) throw new Error('Runtime configuration changed during compilation.')
  return { schema: 'sartracker-bound-runtime-inputs-v1', config, identities, fixtures,
    liveVerificationRequired: true, installationVerified: false }
}

/**
 * Recheck the GitHub run/archive and installed package on the qualification
 * host. The caller supplies a fresh owned work directory, never a public path.
 * No installation, publication, or candidate application launch occurs here.
 */
export async function verifyRuntimeInputs(inputs, source, version, workDirectory) {
  if (inputs?.schema !== 'sartracker-bound-runtime-inputs-v1') throw new Error('Bound runtime inputs are absent.')
  for (const identity of inputs.identities) await boundFile(identity)
  const config = inputs.config
  const verified = await inspectCiCandidateArchive({ archivePath: config.ci.archive.path,
    outputDirectory: path.join(workDirectory, 'verified-ci'), version, sourceSha: source.sha,
    runId: config.ci.provenance.runId, runAttempt: config.ci.provenance.runAttempt, artifactId: config.ci.provenance.artifactId })
  for (const installer of config.ci.installers) {
    const fromArchive = verified.installers.find((entry) => entry.role === installer.role)
    if (fromArchive?.sha256 !== installer.sha256 || fromArchive.bytes !== installer.bytes) {
      throw new Error('Configured installer is not the installer inside the verified CI archive.')
    }
  }
  const deb = config.ci.installers.find((entry) => entry.role === 'ci-deb')
  const installation = await inspectInstalledCandidate({ debPath: deb.path, debSha256: deb.sha256,
    extractionDirectory: path.join(workDirectory, 'verified-installed-deb'), candidateVersion: version })
  if (installation.version !== debianVersionOf(version) || await realpath(config.installedExecutablePath) !== config.installedExecutablePath) {
    throw new Error('Configured launch path is not the actual exact installed Debian executable.')
  }
  validateCanonicalInstalledExecutable(installation, config.installedExecutablePath)
  for (const identity of inputs.identities) await boundFile(identity)
  return { schema: 'sartracker-runtime-preflight-v1', ci: verified, installation,
    installedExecutablePath: config.installedExecutablePath, releaseEligible: false }
}
