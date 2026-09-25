import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readlink, readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { streamCommandToFile } from './release-transfer.mjs'

const execFile = promisify(execFileCallback)
const REPOSITORY = 'donal0c/sartracker-web'
const WORKFLOW = '.github/workflows/electron-linux-validation.yml'
const RELEASE_WORKFLOW = '.github/workflows/electron-release.yml'
const SHA256 = /^[a-f0-9]{64}$/u
export const CANONICAL_INSTALLED_EXECUTABLE_PATH = '/opt/SAR Tracker Electron Validation/sartracker-web'

/** Validate live GitHub metadata; a ZIP identity is deliberately not an installer identity. */
export function validateCiArtifactProvenance(run, artifact, expected) {
  const releaseWorkflow = run.path === RELEASE_WORKFLOW
  const validWorkflow = releaseWorkflow
    ? /^0\.1\.0-beta\.\d+(?:\.\d+)?$/u.test(expected.version ?? '') && run.head_branch === `electron-v${expected.version}`
    : run.path === WORKFLOW && run.head_branch === 'master'
  if (!/^[a-f0-9]{40}$/u.test(expected.sourceSha)
      || ![expected.runId, expected.runAttempt, expected.artifactId].every((value) => Number.isSafeInteger(value) && value > 0)
      || run.id !== expected.runId || run.run_attempt !== expected.runAttempt
      || run.head_sha !== expected.sourceSha || !validWorkflow
      || !['push', 'workflow_dispatch'].includes(run.event)
      || run.status !== 'completed' || run.conclusion !== 'success'
      || run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY) {
    throw new Error('Candidate requires the exact successful postmerge repository/workflow/run identity.')
  }
  const allowedNames = releaseWorkflow ? ['electron-linux-artifacts']
    : [...(expected.runAttempt === 1 ? [`electron-linux-artifacts-${expected.sourceSha}`] : []),
      `electron-linux-artifacts-${expected.sourceSha}-attempt-${expected.runAttempt}`]
  if (artifact.id !== expected.artifactId || !allowedNames.includes(artifact.name)
      || artifact.expired !== false || artifact.workflow_run?.id !== run.id
      || artifact.workflow_run?.head_sha !== expected.sourceSha
      || typeof artifact.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest)
      || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0) {
    throw new Error('Candidate artifact metadata does not match the exact CI archive.')
  }
  return Object.freeze({ repository: REPOSITORY, workflow: run.path, sourceSha: expected.sourceSha,
    runId: run.id, runAttempt: run.run_attempt, artifactId: artifact.id,
    archiveSha256: artifact.digest.slice(7), archiveBytes: artifact.size_in_bytes })
}

/** Hash through a bounded stream; qualification fixtures may be multi-gigabyte. */
export async function hashCandidateFile(filename) {
  const before = await lstat(filename)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Candidate input must be a regular file.')
  const digest = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(filename)) { digest.update(chunk); bytes += chunk.length }
  const after = await lstat(filename)
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes !== before.size) {
    throw new Error('Candidate input changed while hashing.')
  }
  return { path: path.resolve(filename), bytes, sha256: digest.digest('hex') }
}

/** Run a bounded read-only command without shell interpolation. */
async function readCommand(command, args) {
  const { stdout } = await execFile(command, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' })
  return stdout
}

/** Copy a single exact ZIP member into a newly owned regular file, without extracting archive paths. */
async function copyArchiveMember(archive, member, destination) {
  const expectedBytes = parseArchiveMemberSize(await readCommand('unzip', ['-l', archive, member]), member)
  await streamCommandToFile({ command: 'unzip', args: ['-p', archive, member], destination, expectedBytes })
}

/** Bound expanded installer bytes independently of the compressed ZIP size. */
export function parseArchiveMemberSize(listing, member) {
  const entries = listing.split('\n').map(line => /^\s*(\d+)\s+\S+\s+\S+\s+(.+?)\s*$/u.exec(line))
    .filter(entry => entry?.[2] === member)
  const bytes = entries.length === 1 ? Number(entries[0][1]) : NaN
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 2 * 1024 ** 3) throw new Error('CI member expanded size is missing, repeated or exceeds the reviewed two-GiB bound.')
  return bytes
}

/**
 * Verify a supplied archive against freshly fetched GitHub API metadata and
 * derive its two installer hashes. This reads CI; it neither builds nor installs.
 * outputDirectory must be absent: pre-existing evidence is never overwritten.
 */
export async function inspectCiCandidateArchive({ archivePath, outputDirectory, version, ...expected }) {
  if (!/^0\.1\.0-beta\.\d+(?:\.\d+)?$/u.test(version)) throw new Error('Explicit candidate beta version is required.')
  if (!/^[a-f0-9]{40}$/u.test(expected.sourceSha)
      || ![expected.runId, expected.runAttempt, expected.artifactId].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Exact numeric CI identities and source SHA are required before querying GitHub.')
  const run = JSON.parse(await readCommand('gh', ['api', `repos/${REPOSITORY}/actions/runs/${expected.runId}`]))
  const artifact = JSON.parse(await readCommand('gh', ['api', `repos/${REPOSITORY}/actions/artifacts/${expected.artifactId}`]))
  const provenance = validateCiArtifactProvenance(run, artifact, { ...expected, version })
  const archive = await hashCandidateFile(archivePath)
  if (archive.sha256 !== provenance.archiveSha256 || archive.bytes !== provenance.archiveBytes) {
    throw new Error('Downloaded CI ZIP bytes differ from GitHub artifact metadata.')
  }
  const members = (await readCommand('unzip', ['-Z1', archive.path])).trim().split('\n')
  const appImage = `sartracker-electron-validation_${version}_linux_x64.AppImage`
  const deb = `sartracker-electron-validation_${version}_linux_x64.deb`
  const names = provenance.workflow === RELEASE_WORKFLOW ? [appImage, deb] : [appImage, deb, 'SHA256SUMS']
  if (members.length !== names.length || new Set(members).size !== members.length
      || names.some((name) => !members.includes(name))) throw new Error('CI archive must contain exactly the expected installers and checksum manifest.')
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 })
  for (const name of names) await copyArchiveMember(archive.path, name, path.join(outputDirectory, name))
  const installers = await Promise.all([appImage, deb].map((name) => hashCandidateFile(path.join(outputDirectory, name))))
  // Release workflow creates SHA256SUMS in its later draft job. That manifest
  // must be independently fetched/checked by C27; it is not invented here.
  if (names.includes('SHA256SUMS')) {
  const checksums = (await readFile(path.join(outputDirectory, 'SHA256SUMS'), 'utf8')).trim().split('\n')
  const parsed = checksums.map((line) => line.match(/^([a-f0-9]{64}) [ *](?:tmp\/electron-dist\/)?([^/]+)$/u))
  if (parsed.length !== 2 || parsed.some((match) => match === null)
      || new Set(parsed.map((match) => match[2])).size !== 2
      || installers.some((installer) => !parsed.some((match) => match[2] === path.basename(installer.path) && match[1] === installer.sha256))) {
    throw new Error('CI installer bytes do not match the exact checksum manifest.')
  }
  }
  const archiveAfter = await hashCandidateFile(archive.path)
  if (archiveAfter.sha256 !== archive.sha256) throw new Error('CI archive changed during extraction.')
  return { schema: 'sartracker-candidate-ci-artifacts-v1', provenance, archive, ciMetadata: { run, artifact },
    version, installers: installers.map((entry, index) => ({ ...entry, role: index === 0 ? 'ci-appimage' : 'ci-deb' })) }
}

/** Validate actual dpkg admission plus every expected installed payload byte/link. */
export function validateInstalledPayload(installed, expected) {
  if (installed.status !== 'install ok installed'
      || ['packageName', 'version', 'architecture'].some((key) => typeof expected[key] !== 'string' || !expected[key] || installed[key] !== expected[key])
      || expected.architecture !== 'amd64' || !Array.isArray(expected.files) || expected.files.length === 0
      || !Array.isArray(installed.files) || installed.files.length !== expected.files.length) {
    throw new Error('A genuinely installed exact Debian package is required.')
  }
  const observed = new Map(installed.files.map((entry) => [entry.path, entry]))
  if (observed.size !== installed.files.length || new Set(expected.files.map((entry) => entry.path)).size !== expected.files.length) {
    throw new Error('Installed payload contains duplicate paths.')
  }
  for (const entry of expected.files) {
    if (typeof entry.path !== 'string' || path.isAbsolute(entry.path) || entry.path.split('/').some((part) => !part || part === '..' || part === '.')) {
      throw new Error('Installed payload path is unsafe.')
    }
    const actual = observed.get(entry.path)
    if (!actual || (entry.symlink !== undefined ? actual.symlink !== entry.symlink
      : !SHA256.test(entry.sha256) || actual.sha256 !== entry.sha256 || actual.size !== entry.size || actual.executableBits !== entry.executableBits)) {
      throw new Error('Installed payload differs from the verified Debian installer.')
    }
  }
  return true
}

/** Require the launcher path emitted by the reviewed electron-builder package. */
export function validateCanonicalInstalledExecutable(installed, executablePath = CANONICAL_INSTALLED_EXECUTABLE_PATH) {
  if (executablePath !== CANONICAL_INSTALLED_EXECUTABLE_PATH || !Array.isArray(installed?.files)) {
    throw new Error('Installed candidate must use the canonical electron-builder launcher path.')
  }
  const relativePath = executablePath.slice(1)
  const entry = installed.files.find((item) => item?.path === relativePath)
  if (!entry || entry.symlink !== undefined || !SHA256.test(entry.sha256 ?? '')
      || !Number.isSafeInteger(entry.executableBits) || entry.executableBits <= 0) {
    throw new Error('Canonical installed launcher must be an owned regular executable file.')
  }
  return true
}

/** Inventory files without following symlinks; roots are explicit, not inferred installation proof. */
async function payloadInventory(root, relative = '') {
  const entries = []
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const item = path.posix.join(relative, name)
    const filename = path.join(root, item)
    const info = await lstat(filename)
    if (info.isSymbolicLink()) entries.push({ path: item, symlink: await readlink(filename) })
    else if (info.isDirectory()) entries.push(...await payloadInventory(root, item))
    else if (info.isFile()) {
      const identity = await hashCandidateFile(filename)
      entries.push({ path: item, sha256: identity.sha256, size: identity.bytes, executableBits: info.mode & 0o111 })
    } else throw new Error('Unsupported Debian payload entry.')
  }
  return entries
}

/** Compare the real installed filesystem and dpkg database with the verified CI deb. Never installs or uninstalls. */
export async function inspectInstalledCandidate({ debPath, debSha256, extractionDirectory }) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Installed Debian proof requires Linux x64.')
  const deb = await hashCandidateFile(debPath)
  if (deb.sha256 !== debSha256) throw new Error('Debian installer differs from the verified CI bytes.')
  const packageName = (await readCommand('dpkg-deb', ['-f', deb.path, 'Package'])).trim()
  const version = (await readCommand('dpkg-deb', ['-f', deb.path, 'Version'])).trim()
  const architecture = (await readCommand('dpkg-deb', ['-f', deb.path, 'Architecture'])).trim()
  if (packageName !== 'sartracker-web') throw new Error('Unexpected candidate Debian package name.')
  await mkdir(extractionDirectory, { recursive: false, mode: 0o700 })
  await readCommand('dpkg-deb', ['--extract', deb.path, path.resolve(extractionDirectory)])
  const files = await payloadInventory(extractionDirectory)
  const status = (await readCommand('dpkg-query', ['-W', '-f=${Status}\n${Version}\n${Architecture}\n', packageName])).trim().split('\n')
  const ownedPaths = new Set((await readCommand('dpkg-query', ['-L', packageName])).trim().split('\n'))
  const installedFiles = []
  for (const entry of files) {
    const filename = `/${entry.path}`
    if (!ownedPaths.has(filename)) throw new Error('Candidate payload is not owned by the installed Debian package.')
    const info = await lstat(filename)
    if (entry.symlink !== undefined) {
      if (!info.isSymbolicLink()) throw new Error('Installed Debian link was replaced.')
      installedFiles.push({ path: entry.path, symlink: await readlink(filename) })
    } else {
      const identity = await hashCandidateFile(filename)
      installedFiles.push({ path: entry.path, sha256: identity.sha256, size: identity.bytes, executableBits: info.mode & 0o111 })
    }
  }
  const installed = { packageName, status: status[0], version: status[1], architecture: status[2], files: installedFiles }
  validateInstalledPayload(installed, { packageName, version, architecture, files })
  if ((await hashCandidateFile(deb.path)).sha256 !== debSha256) throw new Error('Debian installer changed during inspection.')
  return { schema: 'sartracker-candidate-installed-deb-v1', deb, ...installed,
    payloadExpected: { packageName, version, architecture, files } }
}
