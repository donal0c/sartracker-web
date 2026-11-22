/**
 * Operator actions on the real UI, recovered from the beta.13.4 smoke.
 *
 * Each function does what an operator would do with the visible controls; the
 * test ids are the same ones the Playwright suites use. Keep these small: a
 * check composes them and then verifies the outcome in SQLite, not only on
 * screen.
 */

import { delay } from './app.mjs'
import { openParticipantPickers, openWorkspacePanel, pressPauseResume } from '../../workspace-panels.mjs'

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

/**
 * Opens one section of the Settings menu (DON-343). Builds from before the
 * menu show every setting on one page and have no section buttons, so the
 * click is skipped there and the same smoke runs against either build.
 *
 * @param {import('playwright').Page} page
 * @param {'mission-defaults'|'tracking-sources'|'mapping'|'weather-links'|'advanced'} section
 */
export async function openSettingsSection(page, section) {
  const button = page.getByTestId(`settings-section-${section}`)
  const present = await button.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)
  if (present) await button.click()
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
  await openWorkspacePanel(page, 'mission')
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
  await openWorkspacePanel(page, 'mission')
  await t('mission-name-input').fill(name)
  await t('mission-offset-input').fill(String(offsetHours))
  await openParticipantPickers(page)
  const picker = t('participant-device-picker')
  for (const device of devices) {
    await picker.getByText(device, { exact: true }).waitFor({ timeout: 30_000 })
    await picker.getByText(device, { exact: true }).click()
  }
  await t('mission-start-btn').click()
  await openParticipantPickers(page)
  await openMissionSection(page, 'participants')
  await t('participant-management').waitFor({ timeout: 20_000 })
  await delay(1500)
}

/**
 * Opens a Mission Control section (participants or outings) if it is
 * collapsed. During a mission they collapse to a summary until Show is
 * pressed; a section forced open by a warning is already open, and outside
 * an active or paused mission there is no wrapper at all [DON-300].
 *
 * @param {import('playwright').Page} page
 * @param {'participants' | 'outings'} name
 */
export async function openMissionSection(page, name) {
  const section = page.getByTestId(`mission-${name}-section`)
  // The wrapper exists only while a mission is active or paused; give a
  // just-started mission a moment, then treat "no wrapper" as open.
  await section.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
  if (await section.count() === 0) return
  if (await section.getAttribute('data-open') !== 'false') return
  await page.getByTestId(`mission-${name}-section-toggle`).click()
  await page.waitForFunction((testId) =>
    document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-open') !== 'false',
  `mission-${name}-section`, { timeout: 10_000 })
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
  await openParticipantPickers(page)
  await openMissionSection(page, 'participants')
  await t('participant-add-ref').selectOption({ label: device })
  await t(`participant-history-start-${historyFrom}`).check()
  await t('participant-add-btn').click()
  await delay(1200)
}

/**
 * Returns the mission phase from the Mission panel, for example ACTIVE or
 * PAUSED. The top bar says "Running" for an active mission, so the panel's
 * own phase attribute is read instead (DON-341).
 */
export async function missionPhase(page) {
  return ((await page.getByTestId('mission-control').getAttribute('data-mission-phase')) ?? '').trim().toUpperCase()
}

/** Toggles pause/resume, confirming a pause, and returns the new phase. */
export async function togglePause(page) {
  await pressPauseResume(page)
  await delay(500)
  return missionPhase(page)
}

/**
 * Accepts the recovery prompt if the app shows one.
 *
 * @returns {Promise<boolean>} whether a prompt was shown
 */
export async function resumeIfPrompted(page, timeoutMs = 20_000) {
  const resume = page.getByTestId('start-screen-resume-btn')
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
  await openWorkspacePanel(page, 'mission')
  await page.getByTestId('mission-finish-btn').click()
  await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
  await delay(2000)
}

/** Finalizes a finished mission into an encrypted archive. */
export async function archiveMission(page) {
  const t = byId(page)
  await openWorkspacePanel(page, 'mission')
  await t('mission-finalize-btn').click()
  await delay(800)
  await t('archive-passphrase').fill(ARCHIVE_PASSPHRASE)
  await t('archive-passphrase-confirmation').fill(ARCHIVE_PASSPHRASE)
  await t('archive-issue-recovery-code').click()
  await delay(500)
  await t('archive-recovery-code-confirmation').fill((await t('archive-recovery-code').innerText()).trim())
  await t('archive-finalize').click()
}

/**
 * Reads the visible tracking health: the top bar's tracking headline (with
 * its condition, for example `lost` or `credentials`), the problem words
 * beside it, the alarm strip, and the Tracking panel when it is open
 * (DON-341). The old layout's warning cell and health strip are gone.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string>} the parts joined with " / ", whitespace collapsed
 */
export async function trackingStatus(page) {
  const parts = []
  const headline = page.getByTestId('ws-tracking-headline')
  if (await headline.count() > 0) {
    const condition = await headline.getAttribute('data-condition').catch(() => null)
    if (condition !== null) parts.push(`condition ${condition}`)
  }
  for (const id of ['ws-tracking-headline', 'ws-tracking-problems', 'ws-alarm', 'ws-tracking-panel']) {
    const locator = page.getByTestId(id)
    if (await locator.count() > 0 && await locator.first().isVisible().catch(() => false)) {
      parts.push(await locator.first().innerText().catch(() => ''))
    }
  }
  return parts.join(' / ').replace(/\s+/gu, ' ').trim()
}

/** Returns the visible body text with whitespace collapsed. */
export async function bodyText(page) {
  return (await page.locator('body').innerText()).replace(/\s+/gu, ' ')
}

/** Switches to any other available basemap; returns the new menu label. */
export async function switchBasemap(page) {
  const toggle = page.getByTestId('basemap-menu-toggle')
  const before = (await toggle.innerText()).replace(/\s+/gu, ' ')
  await toggle.click()
  await delay(400)
  const ids = await page.locator('[data-testid^="basemap-btn-"]').evaluateAll((nodes) => nodes.map((node) => ({
    id: node.getAttribute('data-testid'), active: node.className.includes('bg-amber-300'), enabled: !node.disabled,
  })))
  const other = ids.find((entry) => !entry.active && entry.enabled)
  if (other === undefined) throw new Error(`No second basemap to switch to: ${JSON.stringify(ids)}.`)
  await page.getByTestId(other.id).click()
  await delay(3000)
  const after = (await toggle.innerText()).replace(/\s+/gu, ' ')
  if (after === before) throw new Error(`The basemap stayed "${before}" after choosing ${other.id}.`)
  return after
}
