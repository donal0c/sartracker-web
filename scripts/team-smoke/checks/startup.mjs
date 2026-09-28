/**
 * Startup safety: bad stored credentials, refused databases, an unwritable
 * profile and a second launch must all leave the operator with a visible,
 * truthful state and untouched data.
 */

import { chmod, cp, mkdir, open, writeFile } from 'node:fs/promises'
import path from 'node:path'

import Database from 'better-sqlite3'

import { delay, launchApp, observeStartup } from '../lib/app.mjs'
import { missionPhase, startMission } from '../lib/operator.mjs'
import { expectProduct } from '../lib/results.mjs'
import { STORE_FILE, storeFileHashes } from '../lib/store.mjs'

const BAD_SECRET_WARNING =
  'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'

/**
 * Creates a profile with an initialised mission store, quits cleanly, and
 * checkpoints the WAL so copies start from a quiescent store: any later file
 * change is then the app's doing, not SQLite settling our fixture.
 */
async function initialisedProfile(ctx, label) {
  const profile = path.join(ctx.runDir, label)
  const app = await launchApp(ctx, { profile, label: `${label}-init` })
  await app.stop('SIGTERM')
  const db = new Database(path.join(profile, STORE_FILE))
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()
  return profile
}

/** Launches on a damaged store and requires a visible refusal with files untouched. */
async function expectRefusal(ctx, profile, label, damage) {
  const before = await storeFileHashes(profile)
  const observed = await observeStartup(ctx, { profile, label, timeoutMs: 45_000 })
  const after = await storeFileHashes(profile)
  expectProduct(observed.window, `${damage}: the app exited (code ${observed.exitCode}) without showing any window.`)
  expectProduct(/startup failed|cannot|could not|refus|newer|not supported|corrupt/i.test(observed.bodyText),
    `${damage}: no refusal message was shown. Text: ${observed.bodyText.slice(0, 200)}`)
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((name) => before[name] !== after[name])
    .map((name) => `${name} ${before[name] === undefined ? 'created' : after[name] === undefined ? 'removed' : 'modified'}`)
  expectProduct(changed.length === 0, `${damage}: store files changed during the refused start: ${changed.join(', ')}.`)
  return `${damage}: refused with "${(/[^.]*(startup failed|cannot|could not|refus|newer|not supported|corrupt)[^.]*\./i.exec(observed.bodyText)?.[0] ?? '').trim().slice(0, 120)}"; ${Object.keys(before).join(' + ')} byte-identical`
}

export default [
  {
    check: 'Startup with bad stored credential',
    id: 'bad-credential',
    async run(ctx) {
      const profile = path.join(ctx.runDir, 'profile')
      await mkdir(profile, { recursive: true })
      // Same shape as scripts/electron-bad-secret-smoke.mjs, pointed at a dead local port.
      await writeFile(path.join(profile, 'settings.json'), JSON.stringify({
        missionDefaults: {
          autoRefreshEnabled: true, autoRefreshIntervalSeconds: 30, autoSaveEnabled: true,
          autoSaveIntervalSeconds: 30, primaryMissionRoot: '', backupMissionRoot: '',
          coordinatorRoster: [], adminRoster: [],
        },
        dataSource: {
          providerType: 'traccar_http', baseUrl: 'http://127.0.0.1:9', authMode: 'basic',
          email: 'smoke@example.invalid', autoConnect: true, trackingCacheEnabled: true,
          replayEnabled: false, replayStart: '', replayDurationHours: 4,
        },
        officialMaps: {
          sourceType: 'none', sourcePath: '', status: 'not_configured', username: '',
          availableSources: [], serviceCount: 0, message: 'Official maps are not configured.', packages: [],
        },
        weather: { links: [] },
      }))
      await writeFile(path.join(profile, 'secrets.json'), JSON.stringify({
        basic: { encrypted: Buffer.from('not-valid-electron-safe-storage-ciphertext').toString('base64') },
      }))
      const app = await launchApp(ctx, { profile, label: 'bad-credential' })
      const warning = app.page.getByTestId('tracking-warning')
      await warning.waitFor({ state: 'attached', timeout: 20_000 })
      const text = (await warning.textContent())?.trim()
      await app.shot('shell')
      expectProduct(text === BAD_SECRET_WARNING, `Tracking warning was "${text}".`)
      await app.stop()
      return 'Reached the shell; tracking disabled with the re-enter-password warning.'
    },
  },
  {
    check: 'Corrupt or newer database refused',
    id: 'database-refusal',
    async run(ctx) {
      const base = await initialisedProfile(ctx, 'base')
      const newer = path.join(ctx.runDir, 'newer')
      await cp(base, newer, { recursive: true })
      const db = new Database(path.join(newer, STORE_FILE))
      db.prepare("UPDATE metadata SET value = '99' WHERE key = 'schema_version'").run()
      // Settle the edit into the main file so the app starts from a quiescent store.
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.close()
      const corrupt = path.join(ctx.runDir, 'corrupt')
      await cp(base, corrupt, { recursive: true })
      const handle = await open(path.join(corrupt, STORE_FILE), 'r+')
      await handle.write(Buffer.alloc(4096, 0x5a), 0, 4096, 0)
      await handle.close()
      const results = [
        await expectRefusal(ctx, newer, 'newer-schema', 'Newer schema'),
        await expectRefusal(ctx, corrupt, 'corrupt', 'Corrupt database'),
      ]
      return results.join('. ')
    },
  },
  {
    check: 'Unwritable profile shows an error',
    id: 'unwritable-profile',
    async run(ctx) {
      const profile = path.join(ctx.runDir, 'readonly-profile')
      await mkdir(profile, { recursive: true })
      await chmod(profile, 0o555)
      try {
        const observed = await observeStartup(ctx, { profile, label: 'unwritable', timeoutMs: 30_000 })
        expectProduct(observed.window,
          `Silent exit: the app exited with code ${observed.exitCode} and showed no window or message.`)
        expectProduct(/permission|writ|cannot|could not|unable/i.test(observed.bodyText),
          `A window opened but showed no profile error. Text: ${observed.bodyText.slice(0, 200)}`)
        return 'Visible error shown for the unwritable profile.'
      } finally {
        await chmod(profile, 0o755)
      }
    },
  },
  {
    check: 'Duplicate launch',
    id: 'duplicate-launch',
    async run(ctx) {
      const profile = path.join(ctx.runDir, 'profile')
      const first = await launchApp(ctx, { profile, label: 'first' })
      await startMission(first.page, 'Duplicate Launch Smoke', [])
      const phaseBefore = await missionPhase(first.page)
      const second = await observeStartup(ctx, { profile, label: 'second', timeoutMs: 20_000 })
      await delay(2000)
      expectProduct(!second.window, 'A second window opened on the same profile.')
      expectProduct(first.alive(), 'The first instance exited when a second was launched.')
      const phaseAfter = await missionPhase(first.page)
      expectProduct(phaseAfter === phaseBefore, `First instance mission changed from ${phaseBefore} to ${phaseAfter}.`)
      await first.stop()
      return `Second instance exited (code ${second.exitCode}) without a window; first kept its ${phaseAfter} mission.`
    },
  },
]
