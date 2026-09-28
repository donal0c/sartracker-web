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

/** Closes an open workspace panel if one is showing. */
export async function closeWorkspace(page) {
  const close = page.getByTestId('workspace-close-btn')
  if (await close.isVisible().catch(() => false)) await close.click()
  await delay(500)
}

/**
 * Starts a mission and adds the named devices as participants.
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
  const select = page.locator('select').filter({ has: page.locator('option', { hasText: 'Choose…' }) }).first()
  for (const participant of participants) {
    await select.selectOption({ label: participant })
    await page.getByRole('button', { name: /^add participant$/i }).click()
    await delay(1200)
  }
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
