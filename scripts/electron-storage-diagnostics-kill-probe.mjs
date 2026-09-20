#!/usr/bin/env node

// Packaged-Electron kill/restart storage diagnostics proof (DON-244).
// Kills the real app only after both the atomic checkpoint and bounded runtime
// log have flushed `started`, then restarts and exports a support bundle. With the
// field fixture, this marker is observable while the asynchronous copy is in flight.

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { chromium, _electron as electron } from 'playwright'

import {
  BACKUP_FAULT_VARIANTS,
  buildStorageBackupFaultOracleInput,
  buildStorageBackupFaultVerdict,
  buildStorageKillProbeOracleInput,
  buildStorageKillProbeVerdict,
  parseStorageKillProbeArgs,
} from '../build/electron-storage-diagnostics-kill-probe-lib.js'
import { createMissionStoreProbeSettings } from '../build/electron-mission-store-freeze-probe-lib.js'
import { sanitizeEvidenceText } from '../build/electron-official-map-offline-smoke-lib.js'

const checkpointFileName = 'storage-diagnostics.json'
const runtimeLogRelativePath = path.join('logs', 'runtime.log')
const supportBundleFileName = 'storage-diagnostics-kill-support-bundle.txt'

main().catch((error) => {
  console.error(`storage-diagnostics-kill-probe: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Runs the packaged kill/restart/export proof and writes one machine-readable verdict. */
async function main() {
  const options = parseStorageKillProbeArgs(process.argv.slice(2))
  if (options.variant !== undefined && options.variant !== 'abrupt-recovery') {
    await runBackupFaultVariant(options)
    return
  }
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  const databasePath = path.join(userDataDir, 'mission-store.sqlite')
  await assertFreshEvidenceDirectory(evidenceDir)
  await mkdir(userDataDir, { recursive: true })

  const fixtureStat = await stat(options.fixturePath)
  if (!fixtureStat.isFile() || fixtureStat.size <= 0) {
    throw new Error(`Fixture is not a non-empty file: ${options.fixturePath}`)
  }
  console.log(`[storage-kill-probe] copying ${(fixtureStat.size / 1024 / 1024 / 1024).toFixed(2)} GiB fixture`)
  await copyFile(options.fixturePath, databasePath)
  await copyFixtureManifestIfPresent(options.fixturePath, databasePath)
  await writeJson(path.join(userDataDir, 'settings.json'), createMissionStoreProbeSettings())

  let firstLaunch
  let secondLaunch
  try {
    firstLaunch = await launchPackagedApp({
      appPath: options.appPath,
      userDataDir,
      extraArgs: options.extraArgs,
    })
    await firstLaunch.page.screenshot({
      path: path.join(evidenceDir, '01-before-kill.png'),
      fullPage: true,
    })

    const beforeKill = await waitForFlushedStartMarker({
      userDataDir,
      appProcess: firstLaunch.appProcess,
      timeoutMs: options.timeoutMs,
    })
    await writeJson(path.join(evidenceDir, 'checkpoint-before-kill.json'), beforeKill)
    await copyFile(
      path.join(userDataDir, runtimeLogRelativePath),
      path.join(evidenceDir, 'runtime-before-kill.log'),
    )
    console.log('[storage-kill-probe] backup-start marker flushed; sending SIGKILL')
    firstLaunch.appProcess.kill('SIGKILL')
    await waitForExit(firstLaunch.appProcess, 10_000)
    await firstLaunch.browser.close().catch(() => undefined)
    await writeLaunchLog(path.join(evidenceDir, 'electron-before-kill.log'), firstLaunch.logChunks)
    firstLaunch = undefined

    secondLaunch = await launchPackagedApp({
      appPath: options.appPath,
      userDataDir,
      extraArgs: options.extraArgs,
    })
    const afterRestart = await waitForInterruptedRestartMarker({
      userDataDir,
      appProcess: secondLaunch.appProcess,
      timeoutMs: options.timeoutMs,
    })
    await writeJson(path.join(evidenceDir, 'checkpoint-after-restart.json'), afterRestart)
    console.log(
      `[storage-kill-probe] observing restarted app for ${options.postRestartObservationMs}ms`,
    )
    await waitWhileProcessAlive(
      secondLaunch.appProcess,
      options.postRestartObservationMs,
      'during post-restart observation',
    )
    await secondLaunch.page.screenshot({
      path: path.join(evidenceDir, '02-after-restart.png'),
      fullPage: true,
    })

    const supportBundlePath = await secondLaunch.page.evaluate(
      async ({ fileName }) => {
        const exportBundle = window.sartrackerElectron?.exportSupportBundle
        if (typeof exportBundle !== 'function') {
          throw new Error('Electron support-bundle bridge is unavailable.')
        }
        return exportBundle({
          fileName,
          contents: [
            'SAR Tracker packaged storage diagnostics kill probe',
            'synthetic validation data only',
          ].join('\n'),
        })
      },
      { fileName: supportBundleFileName },
    )
    const supportBundle = await readFile(supportBundlePath, 'utf8')
    const runtimeLog = await readFile(path.join(userDataDir, runtimeLogRelativePath), 'utf8')
    await writeFile(
      path.join(evidenceDir, 'support-bundle-inspected.txt'),
      sanitizeEvidenceText(supportBundle),
      'utf8',
    )
    await writeFile(
      path.join(evidenceDir, 'runtime-after-restart.log'),
      sanitizeEvidenceText(runtimeLog),
      'utf8',
    )
    await writeLaunchLog(
      path.join(evidenceDir, 'electron-after-restart.log'),
      secondLaunch.logChunks,
    )

    const forbiddenValues = [
      'SYNTHETIC FIELD-SCALE VALIDATION MISSION',
      options.fixturePath,
      userDataDir,
      os.homedir(),
    ]
    const oracleInput = buildStorageKillProbeOracleInput({
      beforeKill,
      afterRestart,
      runtimeLog,
      supportBundle,
      forbiddenValues,
    })
    const verdict = buildStorageKillProbeVerdict({
      ...oracleInput,
      forbiddenValues,
    })
    const report = {
      schemaVersion: 2,
      schema: 'sartracker-storage-diagnostics-kill-probe-v2',
      issue: 'DON-244',
      recordedAt: new Date().toISOString(),
      app: {
        basename: path.basename(options.appPath),
        sha256: await sha256File(options.appPath),
      },
      fixture: {
        basename: path.basename(options.fixturePath),
        bytes: fixtureStat.size,
        sha256: await sha256File(options.fixturePath),
      },
      platform: {
        os: `${os.type()} ${os.release()}`,
        architecture: os.arch(),
        node: process.version,
      },
      killedAt: beforeKill.activeOperation,
      recoveredAs: afterRestart.previousInterruptedOperation,
      supportBundleBasename: path.basename(supportBundlePath),
      privacyChecks: forbiddenValues.map((_value, index) => ({
        label: `forbidden-value-${index + 1}`,
        absent: !supportBundle.includes(_value),
      })),
      oracleInput,
      verdict,
    }
    await writeJson(path.join(evidenceDir, 'storage-diagnostics-kill-probe-report.json'), report)
    console.log(
      `[storage-kill-probe] passed=${verdict.passed} interrupted=${afterRestart.previousInterruptedOperation?.type}:${afterRestart.previousInterruptedOperation?.stage}`,
    )
    if (!verdict.passed) {
      throw new Error(`Kill/restart probe failed: ${verdict.failures.join(' ')}`)
    }
  } finally {
    await stopLaunch(firstLaunch)
    await stopLaunch(secondLaunch)
  }
}

/**
 * Runs one fixed C18 backup-fault variant against the supplied packaged app.
 * Disk-full is reported as an execution precondition when no bounded quota is
 * supplied; this producer never fills the host filesystem.
 */
async function runBackupFaultVariant(options) {
  const evidenceDir = path.resolve(options.evidenceDir)
  const variant = options.variant
  if (!BACKUP_FAULT_VARIANTS.includes(variant)) throw new Error(`Unsupported C18 backup variant: ${variant}`)
  await assertFreshEvidenceDirectory(evidenceDir)
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 })
  const appProfile = path.join(evidenceDir, '.app-profile')
  let storeProfile = path.join(evidenceDir, 'fault-store')
  let boundedVolume = null
  let boundedVolumeOwned = false
  if (variant === 'disk-full') {
    boundedVolume = await prepareBoundedEnospcVolume({
      mountPath: options.enospcMount,
      evidenceDir,
      fixturePath: options.fixturePath,
    })
    if (boundedVolume.ready) {
      storeProfile = boundedVolume.storeProfile
      boundedVolumeOwned = true
    }
  } else {
    await mkdir(storeProfile, { recursive: true, mode: 0o700 })
  }
  const sourceSha256 = await sha256File(options.fixturePath)
  const appSha256 = await sha256File(options.appPath)
  const workerCrashPath = path.join(evidenceDir, 'backup-worker-crash.cjs')
  if (variant === 'worker-crash') {
    await writeFile(workerCrashPath, 'process.exit(23)\n', { mode: 0o700, flag: 'wx' })
  }

  let app = null
  let page = null
  let runtime = null
  let raw = null
  let failure = null
  let reportToWrite = null
  let pendingError = null
  const cleanup = { applicationClosed: false, appProfileRemoved: false, boundedVolumeOwnedRemoved: false }
  try {
    if (variant !== 'disk-full') {
      await copyFile(options.fixturePath, path.join(storeProfile, 'mission-store.sqlite'))
      await copyFixtureManifestIfPresent(
        options.fixturePath,
        path.join(storeProfile, 'mission-store.sqlite'),
      )
    }
    if (variant === 'disk-full' && boundedVolume?.ready !== true) {
      raw = {
        variant,
        outcome: 'unavailable',
        precondition: boundedVolume?.precondition ?? {
          kind: 'bounded-enospc', status: 'ENVIRONMENT_BLOCKED', observed: false,
          deviceDistinct: false, totalBytes: null, availableBytes: null,
          reason: 'No bounded quota or loopback ENOSPC harness was supplied; host storage was not mutated.',
        },
      }
    } else {
      app = await launchFaultPackagedApp(options.appPath, appProfile, options.extraArgs)
      page = await app.firstWindow()
      await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
      runtime = await app.evaluate(({ app: runningApp }) => ({
        isPackaged: runningApp.isPackaged,
        appPath: runningApp.getAppPath(),
        executablePath: process.execPath,
        profilePath: runningApp.getPath('userData'),
      }))
      await page.screenshot({ path: path.join(evidenceDir, 'backup-fault-runtime.png'), fullPage: true })
      raw = await app.evaluate(async ({ app: runningApp }, input) => {
        const require = process.getBuiltinModule('node:module').createRequire(`${runningApp.getAppPath()}/package.json`)
        const fs = require('node:fs/promises')
        const fsSync = require('node:fs')
        const pathModule = require('node:path')
        const crypto = require('node:crypto')
        const Database = require('better-sqlite3')
        const { createElectronMissionStore } = require(pathModule.join(
          runningApp.getAppPath(), 'electron/mission-store.cjs',
        ))
        const { runSqliteBackupInWorker } = require(pathModule.join(
          runningApp.getAppPath(), 'electron/sqlite-backup-runner.cjs',
        ))
        const sourcePath = pathModule.join(input.storePath, 'mission-store.sqlite')
        const mirrorPath = pathModule.join(input.storePath, 'mission-store.backup.sqlite')
        const hashFile = async (filename) => {
          const hash = crypto.createHash('sha256')
          let bytes = 0
          await new Promise((resolve, reject) => {
            const stream = fsSync.createReadStream(filename)
            stream.on('data', (chunk) => { bytes += chunk.length; hash.update(chunk) })
            stream.on('error', reject)
            stream.on('end', resolve)
          })
          return { sha256: hash.digest('hex'), bytes }
        }
        const fileFact = async (filename) => {
          try { return await hashFile(filename) } catch (error) {
            if (error?.code === 'ENOENT') return null
            throw error
          }
        }
        const mirrorFact = async () => {
          const fact = await fileFact(mirrorPath)
          if (fact === null) return null
          let integrity = 'failed'
          let database
          try {
            database = new Database(mirrorPath, { readonly: true, fileMustExist: true })
            integrity = database.pragma('integrity_check', { simple: true }) === 'ok' ? 'ok' : 'failed'
          } catch {
            integrity = 'failed'
          } finally { database?.close() }
          return { ...fact, integrity }
        }
        const temporaryFiles = async () => (await fs.readdir(input.storePath, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.startsWith('mission-store.backup.sqlite.tmp-'))
          .map((entry) => entry.name)
          .sort()
        const safeError = (error) => {
          const message = String(error?.message ?? error).replace(/[\r\n]+/gu, ' ').slice(0, 500)
          const code = typeof error?.code === 'string'
            ? error.code
            : /EACCES|permission denied/iu.test(message) ? 'EACCES'
              : /ENOSPC|SQLITE_FULL|no space left/iu.test(message) ? 'ENOSPC' : null
          return { name: String(error?.name ?? 'Error').slice(0, 80), code, message }
        }
        const closeStore = async (store) => {
          if (store === null) return
          await store.prepareClose().catch(() => undefined)
          try { store.close() } catch {}
        }
        const makeStore = (faultInjection = {}) => createElectronMissionStore({
          userDataPath: input.storePath,
          backupFaultInjection: faultInjection,
        })

        let store = makeStore()
        let sourceBefore = await fileFact(sourcePath)
        await store.syncBackup('c18-fault-baseline')
        const mirrorBefore = await mirrorFact()
        let sourceAfter = await fileFact(sourcePath)
        let error = null
        let operationOutcome = 'completed'
        let permission = null
        let snapshot = null
        let busyWal = null
        let concurrentWrites = null
        let worker = null
        let staleMirror = false
        let diskFull = null
        try {
          if (input.variant === 'disk-full') {
            const fillerPath = pathModule.join(input.storePath, 'owned-enospc-filler.bin')
            const maxFillBytes = Number.isSafeInteger(input.fillCapBytes) && input.fillCapBytes >= 0
              ? input.fillCapBytes : 0
            const chunk = Buffer.alloc(1024 * 1024, 0x5a)
            let filledBytes = 0
            let observedEnospc = false
            let filler
            try {
              filler = fsSync.openSync(fillerPath, 'wx', 0o600)
              while (filledBytes < maxFillBytes) {
                const nextBytes = Math.min(chunk.length, maxFillBytes - filledBytes)
                try {
                  const written = fsSync.writeSync(filler, chunk, 0, nextBytes)
                  filledBytes += written
                  if (written < nextBytes) break
                } catch (caught) {
                  if (caught?.code === 'ENOSPC') observedEnospc = true
                  else throw caught
                  break
                }
              }
            } catch (caught) {
              error = safeError(caught)
              operationOutcome = 'failed'
            } finally { if (filler !== undefined) fsSync.closeSync(filler) }
            try { await store.syncBackup('c18-disk-full') } catch (caught) {
              error = safeError(caught); operationOutcome = 'failed'
            }
            diskFull = {
              fillerAttempted: true,
              observedEnospc,
              backupErrorObserved: error?.code === 'ENOSPC',
              filledBytes,
              maxFillBytes,
            }
          } else if (input.variant === 'permission') {
            permission = {
              attempted: true,
              observed: false,
              restored: false,
              denial: {
                independentWriteAttempted: false,
                observedCode: null,
                target: 'store-directory',
                modeBefore: 0o700,
                modeDenied: 0o500,
                modeRestored: 0o700,
              },
            }
            await fs.chmod(input.storePath, 0o500)
            try { await store.syncBackup('c18-permission') } catch (caught) {
              error = safeError(caught); operationOutcome = 'failed'
              permission.observed = error.code === 'EACCES' || error.code === 'EPERM'
            } finally {
              permission.denial.independentWriteAttempted = true
              const denialPath = pathModule.join(input.storePath, '.c18-permission-denial-check')
              try {
                await fs.writeFile(denialPath, 'c18-permission-check', { flag: 'wx', mode: 0o600 })
                await fs.rm(denialPath, { force: true })
              } catch (caught) {
                const denialError = safeError(caught)
                permission.denial.observedCode = denialError.code
              }
              // SQLite's backup worker reports this filesystem denial as a
              // generic SqliteError without errno.  Treat it as observed only
              // when the independent same-directory canary proves the exact
              // denial while the directory is chmod'ed 0500.
              permission.observed = operationOutcome === 'failed'
                && permission.denial.observedCode !== null
                && error?.name === 'SqliteError'
                && /unable to open database file/iu.test(error.message)
              await fs.chmod(input.storePath, 0o700)
              permission.restored = true
            }
          } else if (input.variant === 'corrupt-temp' || input.variant === 'stale-good-mirror') {
            if (input.variant === 'stale-good-mirror') {
              const active = await store.getActiveMission()
              if (active !== null) await store.pauseMission(active.id)
              else await store.createMission({ name: 'C18 stale mirror synthetic mission' })
              sourceAfter = await fileFact(sourcePath)
              staleMirror = true
            }
            await closeStore(store)
            store = makeStore({
              ...(input.variant === 'corrupt-temp'
                ? { corruptTemporarySnapshotBeforeSanityCheck: true }
                : { afterTemporaryBackup: true }),
            })
            try { await store.syncBackup(`c18-${input.variant}`) } catch (caught) {
              error = safeError(caught); operationOutcome = 'failed'
              snapshot = input.variant === 'corrupt-temp'
                ? { temporaryCorrupted: true, sanityRejected: true }
                : null
            }
          } else if (input.variant === 'busy-wal') {
            const targetPath = pathModule.join(input.storePath, 'busy-wal-result.sqlite')
            const lock = new Database(sourcePath)
            lock.pragma('journal_mode = WAL')
            lock.exec('BEGIN IMMEDIATE')
            let backupCompleted = false
            try {
              await runSqliteBackupInWorker({ sourcePath, targetPath })
              backupCompleted = true
            } catch (caught) { error = safeError(caught); operationOutcome = 'failed' }
            finally { try { lock.exec('ROLLBACK') } catch {} ; lock.close() }
            busyWal = { writeTransactionHeld: true, backupCompleted, released: true }
            await fs.rm(targetPath, { force: true })
          } else if (input.variant === 'concurrent-writes') {
            const mission = await store.getActiveMission()
              ?? await store.createMission({ name: 'C18 concurrent mutation mission' })
            const mutationRefA = `c18-device-a-${crypto.randomUUID()}`
            const mutationRefB = `c18-device-b-${crypto.randomUUID()}`
            const results = await Promise.allSettled([
              store.addMissionParticipant({
                mission_id: mission.id,
                kind: 'device',
                ref: mutationRefA,
                confirmed_by: 'C18 calibration operator',
              }),
              store.addMissionParticipant({
                mission_id: mission.id,
                kind: 'device',
                ref: mutationRefB,
                confirmed_by: 'C18 calibration operator',
              }),
            ])
            const completedCount = results.filter((result) => result.status === 'fulfilled').length
            const participants = completedCount === 2 ? await store.listMissionParticipants(mission.id) : []
            const auditEvents = completedCount === 2
              ? (await store.listMissionEvents(mission.id)).filter((event) => event?.event_type === 'participant_added')
              : []
            let postMutationBackupCompleted = false
            let retryCompleted = false
            if (completedCount === 2) {
              try {
                await store.syncBackup('c18-concurrent-post-mutation')
                postMutationBackupCompleted = true
                await store.syncBackup('c18-concurrent-retry')
                retryCompleted = true
              } catch (caught) {
                error = safeError(caught)
                operationOutcome = 'failed'
              }
            }
            concurrentWrites = {
              attemptedCount: 2,
              completedCount,
              serialized: completedCount === 2,
              mutationKind: 'add-mission-participant',
              acceptedMutationCount: participants.length,
              durableRowCount: participants.length,
              auditEventCount: auditEvents.length,
              postMutationBackupCompleted,
              retryCompleted,
            }
            if (completedCount !== 2) {
              operationOutcome = 'failed'
              error = safeError(results.find((result) => result.status === 'rejected')?.reason)
            }
          } else if (input.variant === 'worker-crash') {
            const targetPath = pathModule.join(input.storePath, 'mission-store.backup.sqlite.tmp-worker-crash')
            try {
              await runSqliteBackupInWorker({ sourcePath, targetPath, workerPath: input.workerPath })
              operationOutcome = 'completed'
            } catch (caught) { error = safeError(caught); operationOutcome = 'failed' }
            const targetAbsent = await fileFact(targetPath) === null
            await fs.rm(targetPath, { force: true })
            worker = { attempted: true, crashed: operationOutcome === 'failed', targetAbsent }
          }
        } finally {
          await closeStore(store)
        }
        return {
          variant: input.variant, outcome: operationOutcome, error,
          sourceBefore, sourceAfter: await fileFact(sourcePath),
          mirrorBefore, mirrorAfter: await mirrorFact(),
          temporaryFilesAfter: await temporaryFiles(), permission, snapshot,
          busyWal, concurrentWrites, worker, staleMirror, diskFull,
          precondition: input.precondition,
        }
      }, {
        storePath: storeProfile,
        variant,
        workerPath: workerCrashPath,
        precondition: boundedVolume?.precondition ?? null,
        fillCapBytes: boundedVolume?.fillCapBytes ?? null,
      })
    }
    const oracleInput = buildStorageBackupFaultOracleInput(raw)
    const verdict = buildStorageBackupFaultVerdict(oracleInput)
    const runtimeIdentity = runtime === null ? null : {
      proofMode: runtime.isPackaged === true ? 'packaged-module' : 'development-harness',
      executablePath: path.resolve(runtime.executablePath),
      executableSha256: await sha256File(runtime.executablePath),
      asarPath: runtime.isPackaged === true ? path.resolve(runtime.appPath) : null,
      asarSha256: runtime.isPackaged === true ? await sha256File(runtime.appPath) : null,
      profilePath: runtime.profilePath,
    }
    reportToWrite = {
      schemaVersion: 1,
      schema: 'sartracker-storage-backup-fault-matrix-v1',
      contractId: 'C18',
      variant,
      source: { path: path.relative(evidenceDir, options.fixturePath), sha256: sourceSha256 },
      app: { path: path.basename(options.appPath), sha256: appSha256 },
      runtime: runtimeIdentity,
      store: { root: 'fault-store', source: 'fault-store/mission-store.sqlite', mirror: 'fault-store/mission-store.backup.sqlite' },
      oracleInput,
      verdict,
      cleanup,
      releaseEligible: false,
    }
    if (verdict.status === 'INVALID_EVIDENCE') throw new Error(`C18 ${variant} fault probe failed: ${verdict.failures.join(' ')}`)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    if (raw === null) raw = { variant, outcome: 'failed', error: { name: 'ProducerError', code: null, message: failure } }
    pendingError = error
  } finally {
    if (app !== null) {
      try { await app.close(); cleanup.applicationClosed = true } catch {}
    }
    try { await rm(appProfile, { recursive: true, force: true }); cleanup.appProfileRemoved = true } catch {}
    if (boundedVolumeOwned) {
      try { await rm(storeProfile, { recursive: true, force: true }); cleanup.boundedVolumeOwnedRemoved = true } catch {}
    }
  }
  if (pendingError !== null) {
    await writeJson(path.join(evidenceDir, 'storage-backup-fault-matrix-failure-receipt.json'), {
      schema: 'sartracker-storage-backup-fault-matrix-failure-v1', contractId: 'C18', variant,
      sourceSha256, appSha256, raw, cleanup, releaseEligible: false,
    })
    throw pendingError
  }
  if (reportToWrite !== null) {
    reportToWrite.cleanup = cleanup
    await writeJson(path.join(evidenceDir, 'storage-backup-fault-matrix-report.json'), reportToWrite)
  }
  void page
  void failure
}

/** Launches the exact packaged executable for one disposable C18 fault run. */
async function launchFaultPackagedApp(appPath, userDataDir, extraArgs) {
  const platformArgs = process.platform === 'linux'
    ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE']
    : []
  return electron.launch({
    executablePath: appPath,
    args: [...platformArgs, ...extraArgs],
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
    },
    timeout: 30_000,
  })
}

/** Launches one isolated packaged app and returns its first ready renderer page. */
async function launchPackagedApp(input) {
  const port = await findFreePort()
  const logChunks = []
  const appProcess = spawn(
    input.appPath,
    [`--remote-debugging-port=${port}`, ...input.extraArgs],
    {
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: input.userDataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  appProcess.stdout.on('data', (chunk) => logChunks.push(chunk))
  appProcess.stderr.on('data', (chunk) => logChunks.push(chunk))
  try {
    await waitForCdp(port, appProcess)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? (await context.waitForEvent('page'))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
    return { appProcess, browser, page, logChunks }
  } catch (error) {
    appProcess.kill('SIGKILL')
    throw error
  }
}

/** Waits until both durable channels show the backup start before its copy completes. */
async function waitForFlushedStartMarker(input) {
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    assertProcessAlive(input.appProcess, 'before backup-start marker')
    const checkpoint = await readJsonIfPresent(path.join(input.userDataDir, checkpointFileName))
    const runtimeLog = await readFileIfPresent(path.join(input.userDataDir, runtimeLogRelativePath))
    if (
      checkpoint?.activeOperation?.type === 'backup' &&
      checkpoint.activeOperation.stage === 'started' &&
      runtimeLog.includes('storage_backup_started')
    ) {
      return checkpoint
    }
    await delay(20)
  }
  throw new Error('Timed out waiting for the flushed backup started marker.')
}

/** Waits for startup recovery to convert the active marker into interrupted evidence. */
async function waitForInterruptedRestartMarker(input) {
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    assertProcessAlive(input.appProcess, 'after restart')
    const checkpoint = await readJsonIfPresent(path.join(input.userDataDir, checkpointFileName))
    const runtimeLog = await readFileIfPresent(path.join(input.userDataDir, runtimeLogRelativePath))
    if (
      checkpoint?.activeOperation === null &&
      checkpoint?.previousInterruptedOperation?.type === 'backup' &&
      checkpoint.previousInterruptedOperation.stage === 'started' &&
      runtimeLog.includes('storage_previous_run_interrupted')
    ) {
      return checkpoint
    }
    await delay(20)
  }
  throw new Error('Timed out waiting for restart interruption evidence.')
}

async function stopLaunch(launch) {
  if (launch === undefined) return
  await launch.browser?.close().catch(() => undefined)
  if (launch.appProcess.exitCode === null) {
    launch.appProcess.kill('SIGTERM')
    await waitForExit(launch.appProcess, 5_000)
  }
}

async function assertFreshEvidenceDirectory(evidenceDir) {
  const existing = await stat(evidenceDir).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (existing !== null) {
    throw new Error(`Evidence directory already exists; choose a fresh path: ${evidenceDir}`)
  }
}

/** Validate and privately seed one reviewed small volume for a bounded ENOSPC run. */
async function prepareBoundedEnospcVolume({ mountPath, evidenceDir, fixturePath }) {
  const blocked = (reason, details = {}) => ({
    ready: false,
    precondition: {
      kind: 'bounded-enospc', status: 'ENVIRONMENT_BLOCKED', observed: false,
      deviceDistinct: details.deviceDistinct === true,
      totalBytes: details.totalBytes ?? null, availableBytes: details.availableBytes ?? null,
      reason,
    },
  })
  if (typeof mountPath !== 'string' || !path.isAbsolute(mountPath)) {
    return blocked('A reviewed absolute bounded writable mount is required via --enospc-mount.')
  }
  let mountInfo
  let evidenceInfo
  let volumeStats
  try {
    mountInfo = await stat(mountPath)
    evidenceInfo = await stat(evidenceDir)
    volumeStats = await statfs(mountPath)
    await access(mountPath)
  } catch (error) {
    return blocked(`Bounded ENOSPC mount could not be inspected: ${error?.code ?? 'unavailable'}.`)
  }
  if (!mountInfo.isDirectory()) return blocked('Bounded ENOSPC input is not a directory.')
  const totalBytes = Number(volumeStats.bsize) * Number(volumeStats.blocks)
  const availableBytes = Number(volumeStats.bsize) * Number(volumeStats.bavail)
  const deviceDistinct = mountInfo.dev !== evidenceInfo.dev
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > 64 * 1024 * 1024) {
    return blocked('Bounded ENOSPC volume must report total capacity at or below 64 MiB.', { totalBytes })
  }
  if (!deviceDistinct) {
    return blocked('Bounded ENOSPC volume must use a device distinct from the evidence filesystem.', {
      totalBytes, availableBytes,
    })
  }
  let fixtureInfo
  try { fixtureInfo = await stat(fixturePath) } catch (error) {
    return blocked(`Fixture could not be inspected for bounded ENOSPC preparation: ${error?.code ?? 'unavailable'}.`, {
      totalBytes, availableBytes, deviceDistinct,
    })
  }
  if (fixtureInfo.size <= 0 || fixtureInfo.size > Math.max(1, availableBytes / 2)) {
    return blocked('Fixture is too large to seed safely on the bounded ENOSPC volume.', {
      totalBytes, availableBytes, deviceDistinct,
    })
  }
  const storeProfile = path.join(mountPath, `.sartracker-c18-enospc-${randomUUID()}`)
  try {
    await mkdir(storeProfile, { recursive: true, mode: 0o700 })
    await copyFile(fixturePath, path.join(storeProfile, 'mission-store.sqlite'))
    await copyFixtureManifestIfPresent(fixturePath, path.join(storeProfile, 'mission-store.sqlite'))
    const afterCopy = await statfs(storeProfile)
    const copyAvailableBytes = Number(afterCopy.bsize) * Number(afterCopy.bavail)
    return {
      ready: true,
      storeProfile,
      fillCapBytes: Math.max(0, copyAvailableBytes),
      precondition: {
        kind: 'bounded-enospc', status: 'READY', observed: true, deviceDistinct,
        totalBytes, availableBytes: copyAvailableBytes,
        reason: 'Reviewed bounded writable volume passed capacity, device and fixture preflight.',
      },
    }
  } catch (error) {
    await rm(storeProfile, { recursive: true, force: true }).catch(() => undefined)
    return blocked(`Bounded ENOSPC volume could not be seeded: ${error?.code ?? 'unavailable'}.`, {
      totalBytes, availableBytes, deviceDistinct,
    })
  }
}

async function copyFixtureManifestIfPresent(sourcePath, targetPath) {
  await copyFile(`${sourcePath}.manifest.json`, `${targetPath}.manifest.json`).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
}

async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    assertProcessAlive(appProcess, 'before CDP became available')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Keep polling while packaged Electron starts.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for the Electron remote-debugging port.')
}

async function findFreePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not allocate a TCP port for Electron CDP.'))
        return
      }
      server.close(() => resolve(address.port))
    })
    server.on('error', reject)
  })
}

function assertProcessAlive(appProcess, context) {
  if (appProcess.exitCode !== null) {
    throw new Error(`Electron exited ${context} with code ${appProcess.exitCode}.`)
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs),
  ])
}

async function waitWhileProcessAlive(appProcess, durationMs, context) {
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    assertProcessAlive(appProcess, context)
    await delay(Math.min(250, deadline - Date.now()))
  }
}

async function readJsonIfPresent(filePath) {
  const contents = await readFileIfPresent(filePath)
  if (contents === '') return null
  try {
    return JSON.parse(contents)
  } catch {
    return null
  }
}

async function readFileIfPresent(filePath) {
  return readFile(filePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeLaunchLog(filePath, chunks) {
  await writeFile(
    filePath,
    sanitizeEvidenceText(Buffer.concat(chunks).toString('utf8')),
    'utf8',
  )
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
