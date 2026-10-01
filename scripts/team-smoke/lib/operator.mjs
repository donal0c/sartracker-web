/**
 * Operator actions on the real UI, recovered from the beta.13.4 smoke.
 *
 * Each function does what an operator would do with the visible controls; the
 * test ids are the same ones the Playwright suites use. Keep these small: a
 * check composes them and then verifies the outcome in SQLite, not only on
 * screen.
 */

import { delay } from './app.mjs'

export const ARCHIVE_PASSPHRASE = 'Smoke-Test-Pass-2026!x'

/** @param {import('playwright').Page} page */
const byId = (page) => (id) => page.getByTestId(id)

/**
 * Configures the Traccar provider in Settings and saves.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 */
export async function connectProvider(page, url) {
  const t = byId(page)
  await t('open-settings-workspace').click()
  await delay(800)
  await page.getByRole('button', { name: /^traccar http$/i }).click()
  await t('settings-provider-url').fill(url)
  await page.getByRole('button', { name: /^basic$/i }).click()
  await t('settings-provider-email').fill('smoke@example.invalid')
  await t('settings-provider-secret').fill('smoke-password')
  await t('settings-save-connect').click()
  await delay(5000)
  await closeWorkspace(page)
}

/**
 * Waits for the basemap menu to show a map. A stored official map is restored
 * asynchronously once its package is verified at startup [DON-304]. Returns
 * the last label seen so a finding can quote it.
 */
export async function waitForBasemapLabel(page, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let label = ''
  while (Date.now() < deadline) {
    label = (await page.getByTestId('basemap-menu-toggle').innerText()).replace(/\s+/gu, ' ')
    if (label.includes(expected)) return label
    await delay(250)
  }
  return label
}

/** Closes an open workspace panel if one is showing. */
export async function closeWorkspace(page) {
  const close = page.getByTestId('workspace-close-btn')
  if (await close.isVisible().catch(() => false)) await close.click()
  await delay(500)
}

/**
 * Starts a mission and adds the named devices as participants after Start,
 * each with history from now (the add time).
 *
 * @param {import('playwright').Page} page
 * @param {string} name
 * @param {string[]} participants
 */
export async function startMission(page, name, participants) {
  const t = byId(page)
  await t('mission-name-input').fill(name)
  await t('mission-start-btn').click()
  await delay(2000)
  for (const participant of participants) await addParticipantAfterStart(page, participant, 'now')
}

/**
 * Starts a mission with a start offset (lookback), ticking the named devices
 * in the mission-start participant picker before pressing Start.
 *
 * @param {import('playwright').Page} page
 * @param {{name: string, offsetHours: number, devices: string[]}} mission
 */
export async function startMissionWithLookback(page, { name, offsetHours, devices }) {
  const t = byId(page)
  await t('mission-name-input').fill(name)
  await t('mission-offset-input').fill(String(offsetHours))
  const picker = t('participant-device-picker')
  for (const device of devices) {
    await picker.getByText(device, { exact: true }).waitFor({ timeout: 30_000 })
    await picker.getByText(device, { exact: true }).click()
  }
  await t('mission-start-btn').click()
  await t('participant-management').waitFor({ timeout: 20_000 })
  await delay(1500)
}

/**
 * Adds one device during a mission, choosing where its history starts.
 *
 * @param {import('playwright').Page} page
 * @param {string} device
 * @param {'now' | 'mission'} historyFrom
 */
export async function addParticipantAfterStart(page, device, historyFrom) {
  const t = byId(page)
  await t('participant-add-ref').selectOption({ label: device })
  await t(`participant-history-start-${historyFrom}`).check()
  await t('participant-add-btn').click()
  await delay(1200)
}

/** Returns the mission phase chip text, for example ACTIVE or PAUSED. */
export async function missionPhase(page) {
  return (await page.getByTestId('mission-phase-chip').innerText()).trim().toUpperCase()
}

/** Toggles pause/resume and returns the new phase. */
export async function togglePause(page) {
  await page.getByTestId('mission-pause-resume-btn').click()
  await delay(1500)
  return missionPhase(page)
}

/**
 * Accepts the recovery prompt if the app shows one.
 *
 * @returns {Promise<boolean>} whether a prompt was shown
 */
export async function resumeIfPrompted(page, timeoutMs = 20_000) {
  const resume = page.getByRole('button', { name: /^resume$/i })
  const shown = await resume.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true, () => false)
  if (shown) {
    await resume.click()
    await delay(3000)
  }
  return shown
}

/**
 * Places a named marker at a point on the map, optionally with an attachment.
 *
 * @param {import('playwright').Page} page
 * @param {{name: string, x: number, y: number, type?: string, attachment?: string}} marker
 */
export async function placeMarker(page, { name, x, y, type, attachment }) {
  const t = byId(page)
  await t('map-container').click({ position: { x, y }, force: true })
  await delay(700)
  if (type !== undefined) await t(`marker-type-${type}`).check({ force: true })
  await t('marker-name-input').fill(name)
  if (attachment !== undefined) {
    await t('marker-attachment-input').setInputFiles(attachment)
    await delay(1500)
  }
  await t('marker-save-btn').click()
  await delay(2000)
}

/** Finishes the active mission. */
export async function finishMission(page) {
  await page.getByTestId('mission-finish-btn').click()
  await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
  await delay(2000)
}

/** Finalizes a finished mission into an encrypted archive. */
export async function archiveMission(page) {
  const t = byId(page)
  await t('mission-finalize-btn').click()
  await delay(800)
  await t('archive-passphrase').fill(ARCHIVE_PASSPHRASE)
  await t('archive-passphrase-confirmation').fill(ARCHIVE_PASSPHRASE)
  await t('archive-issue-recovery-code').click()
  await delay(500)
  await t('archive-recovery-code-confirmation').fill((await t('archive-recovery-code').innerText()).trim())
  await t('archive-finalize').click()
}

/** Returns the visible body text with whitespace collapsed. */
export async function bodyText(page) {
  return (await page.locator('body').innerText()).replace(/\s+/gu, ' ')
}
