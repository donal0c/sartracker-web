import { execFile as execFileCallback } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, copyFile, mkdir, open, readFile, readdir, realpath, symlink } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { appImageSquashfsOffset } from '../../build/appimage-offset.js'
import { debianVersionOf } from './debian-candidate-version.mjs'
import {
  CANONICAL_INSTALLED_EXECUTABLE_PATH,
  hashCandidateFile,
  inspectInstalledCandidate,
  validateCanonicalInstalledExecutable,
} from './candidate-artifacts.mjs'

const execFile = promisify(execFileCallback)
const SHA256 = /^[a-f0-9]{64}$/u

/** Match independently observed main-process identity to the exact launcher and payload. */
export function validateRuntimeObservation(observation, expected) {
  if (!['ci-appimage', 'installed-deb'].includes(expected.proofMode)
      || ![expected.executableSha256, expected.asarSha256, expected.artifactSha256].every((value) => typeof value === 'string' && SHA256.test(value))
      || !Number.isSafeInteger(observation.pid) || observation.pid <= 0
      || typeof observation.startTicks !== 'string' || !/^\d+$/u.test(observation.startTicks)
      || observation.mainProcess !== true || observation.descendantOfRunner !== true
      || observation.launchPath !== expected.launchPath || observation.artifactSha256 !== expected.artifactSha256
      || observation.executableSha256 !== expected.executableSha256 || observation.asarSha256 !== expected.asarSha256) {
    throw new Error('Observed main process is not the independently bound candidate runtime.')
  }
  if (expected.proofMode === 'ci-appimage' && observation.appImagePath !== expected.launchPath) {
    throw new Error('Runtime did not originate from the exact AppImage launcher.')
  }
  if (expected.proofMode === 'installed-deb' && (observation.executablePath !== expected.installedExecutablePath
      || expected.launchPath !== expected.installedExecutablePath || observation.appImagePath !== null)) {
    throw new Error('Runtime is not the genuinely installed Debian executable.')
  }
  return true
}

/**
 * Prepare a byte-identical AppImage launcher with an inspected resources sidecar
 * for older probes that locate app.asar beside --app. The launched file remains
 * the exact AppImage; extraction is inspection, never presented as launch proof.
 * Installed-deb uses the actual package-manager-owned executable instead.
 */
export async function preparePackageRuntime({ proofMode, artifact, version, workDirectory, installedExecutablePath }) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Package qualification requires a Linux x64 host.')
  const input = await hashCandidateFile(artifact.path)
  if (input.sha256 !== artifact.sha256) throw new Error('Candidate installer changed before runtime preparation.')
  await mkdir(workDirectory, { recursive: false, mode: 0o700 })
  if (proofMode === 'ci-appimage') {
    const launchPath = path.join(workDirectory, 'candidate.AppImage')
    await copyFile(input.path, launchPath, constants.COPYFILE_EXCL)
    await chmod(launchPath, 0o700)
    const copied = await hashCandidateFile(launchPath)
    if (copied.sha256 !== input.sha256) throw new Error('AppImage copy differs from the verified artifact.')
    const file = await open(launchPath, 'r')
    let offset
    try {
      const header = Buffer.alloc(Math.min(copied.bytes, 4 * 1024 * 1024))
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      offset = appImageSquashfsOffset(header.subarray(0, bytesRead))
    } finally { await file.close() }
    const payloadRoot = path.join(workDirectory, 'inspected-payload')
    await execFile('unsquashfs', ['-no-progress', '-d', payloadRoot, '-o', String(offset), launchPath],
      { timeout: 120000, maxBuffer: 1024 * 1024 })
    const executable = await hashCandidateFile(path.join(payloadRoot, 'sartracker-web'))
    const asar = await hashCandidateFile(path.join(payloadRoot, 'resources/app.asar'))
    await symlink('inspected-payload/resources', path.join(workDirectory, 'resources'))
    return { proofMode, launchPath, artifactSha256: input.sha256, artifactPath: input.path,
      executableSha256: executable.sha256, asarSha256: asar.sha256, payloadRoot,
      version, environment: { APPIMAGE_EXTRACT_AND_RUN: '1' } }
  }
  if (proofMode !== 'installed-deb' || installedExecutablePath !== CANONICAL_INSTALLED_EXECUTABLE_PATH
      || await realpath(installedExecutablePath) !== installedExecutablePath) {
    throw new Error('Installed proof requires an explicit real package executable path.')
  }
  const installation = await inspectInstalledCandidate({ debPath: input.path, debSha256: input.sha256,
    extractionDirectory: path.join(workDirectory, 'inspected-deb'), candidateVersion: version })
  if (installation.version !== debianVersionOf(version)) throw new Error('Installed Debian version differs from the candidate version.')
  validateCanonicalInstalledExecutable(installation, installedExecutablePath)
  const executable = installation.files.find((entry) => `/${entry.path}` === installedExecutablePath && entry.sha256)
  const asarPath = path.join(path.dirname(installedExecutablePath), 'resources/app.asar')
  const asar = installation.files.find((entry) => `/${entry.path}` === asarPath && entry.sha256)
  if (!executable || !asar) throw new Error('Installed executable or ASAR is not owned by the verified Debian package.')
  return { proofMode, launchPath: installedExecutablePath, installedExecutablePath,
    artifactSha256: input.sha256, artifactPath: input.path, executableSha256: executable.sha256,
    asarSha256: asar.sha256, installation, version, environment: {} }
}

/** Read Linux process ancestry without retaining arbitrary environment variables or arguments. */
async function processSnapshot(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
  const rest = stat.slice(stat.lastIndexOf(')') + 2).trim().split(' ')
  return { pid: Number(pid), parent: Number(rest[1]), startTicks: rest[19] }
}

/**
 * Observe only descendants of the owned probe. Caller polls during execution
 * and requires at least one matched main process (and every declared restart).
 * Disappearing processes are omitted; an absent observation never proves launch.
 */
export async function observePackageProcesses(runnerPid, expected) {
  if (process.platform !== 'linux') throw new Error('Actual runtime observation requires Linux procfs.')
  const processes = []
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/u.test(name)) continue
    try { processes.push(await processSnapshot(name)) } catch { /* A process exited between directory and stat reads. */ }
  }
  const descendants = new Set([runnerPid])
  let added
  do {
    added = false
    for (const item of processes) if (descendants.has(item.parent) && !descendants.has(item.pid)) { descendants.add(item.pid); added = true }
  } while (added)
  const observations = []
  for (const item of processes.filter((entry) => entry.pid !== runnerPid && descendants.has(entry.pid))) {
    let executablePath
    let cmdline
    try {
      executablePath = await realpath(`/proc/${item.pid}/exe`)
      cmdline = (await readFile(`/proc/${item.pid}/cmdline`)).toString().split('\0')
    } catch { continue }
    if (path.basename(executablePath) !== 'sartracker-web' || cmdline.some((part) => part.startsWith('--type='))) continue
    const executable = await hashCandidateFile(executablePath)
    const asar = await hashCandidateFile(path.join(path.dirname(executablePath), 'resources/app.asar'))
    const environment = (await readFile(`/proc/${item.pid}/environ`)).toString().split('\0')
    const appImagePath = environment.find((entry) => entry.startsWith('APPIMAGE='))?.slice('APPIMAGE='.length) ?? null
    const after = await processSnapshot(item.pid)
    if (after.startTicks !== item.startTicks || await realpath(`/proc/${item.pid}/exe`) !== executablePath) throw new Error('Process identity changed during observation.')
    const observation = { pid: item.pid, startTicks: item.startTicks, launchPath: expected.launchPath,
      executablePath, executableSha256: executable.sha256, asarSha256: asar.sha256,
      artifactSha256: expected.artifactSha256, appImagePath, mainProcess: true, descendantOfRunner: true }
    validateRuntimeObservation(observation, expected)
    observations.push(observation)
  }
  return observations
}
