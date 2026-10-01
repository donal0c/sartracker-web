import { expect, test } from '@playwright/test'

// DON-300 manual-pass items at the common 1440 x 900 laptop size.
test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  await page.goto('/?missionHarness=1&missionModel=1')
  await page.getByTestId('app-title').waitFor()
})

test('top-bar labels fit their buttons instead of running together [DON-300]', async ({ page }) => {
  const overflowing = await page.locator('.sar-mast-button').evaluateAll((buttons) =>
    buttons.filter((button) => button.scrollWidth > button.clientWidth + 1)
      .map((button) => button.textContent?.trim()))
  expect(overflowing).toEqual([])
})

test('Diagnostics summary values stay inside their panel [DON-300]', async ({ page }) => {
  await page.getByTestId('open-diagnostics-workspace').click()
  const workspace = page.getByTestId('diagnostics-workspace')
  await expect(workspace).toBeVisible()
  const spilling = await workspace.locator('.sar-status-row').evaluateAll((rows) =>
    rows.filter((row) => {
      const panel = row.closest('section')!.getBoundingClientRect()
      return [...row.children].some((cell) => cell.getBoundingClientRect().right > panel.right + 1)
    }).map((row) => row.textContent?.trim().slice(0, 40)))
  expect(spilling).toEqual([])
})

test('the last Settings field is fully visible above the action bar when scrolled to the end [DON-300]', async ({ page }) => {
  await page.getByTestId('open-settings-workspace').click()
  const content = page.getByTestId('settings-workspace')
  await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
  const hidden = await content.evaluate((element) => {
    const fields = [...element.querySelectorAll('input, textarea, select, button')]
      .filter((field) => (field as HTMLElement).offsetParent !== null)
    const last = fields.at(-1)!.getBoundingClientRect()
    return last.bottom > element.getBoundingClientRect().bottom + 1
  })
  expect(hidden).toBe(false)
})

// DON-300 item 5, option C (Donal, 1 Oct 2026): during a mission Participants
// and Outings fold to one line, so the Tracking / Tools / Layers body keeps
// room at 900 px; Pause and Finish never need a click to reach; any warning
// keeps its section open.
async function seedRoster(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const seen = new Date(Date.now() - 60_000).toISOString()
    await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
      groups: [{ group_id: '101', name: 'Hill Team', parent_group_id: null }],
      devices: [
        { device_id: '1', name: 'Alpha Team', status: 'online', last_seen: seen, unique_id: 'a1', category: null, group_id: '101' },
        { device_id: '3', name: 'Charlie Team', status: 'online', last_seen: seen, unique_id: 'c3', category: null, group_id: null },
      ],
    })
  })
}

async function startMission(
  page: import('@playwright/test').Page,
  select: (page: import('@playwright/test').Page) => Promise<void>,
  offsetHours = '0',
): Promise<void> {
  await seedRoster(page)
  await page.getByTestId('mission-name-input').fill('Layout mission')
  await page.getByTestId('mission-offset-input').fill(offsetHours)
  await select(page)
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-phase-chip').first()).toContainText(/active/i)
}

/** True when the element is fully inside the window and inside every scrolling ancestor. */
async function fullyShown(locator: import('@playwright/test').Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    if (box.top < 0 || box.bottom > window.innerHeight || box.height === 0) return false
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (!/(auto|scroll|hidden)/u.test(style.overflowY)) continue
      const clip = parent.getBoundingClientRect()
      if (box.top < clip.top - 1 || box.bottom > clip.bottom + 1) return false
    }
    return true
  })
}

/** The harness has no Traccar to answer history requests; mark them fetched, as a healthy server would. */
async function completeHistory(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const [{ getBrowserHarnessStore }, { useParticipantStore }] = await Promise.all([
      import('/src/features/browser-validation/browser-harness-store.ts'),
      import('/src/features/participants/participant-store.ts'),
    ])
    const store = getBrowserHarnessStore()
    const missionId = window.__SARTRACKER_BROWSER_HARNESS__?.readState().currentMissionId ?? null
    if (missionId === null) throw new Error('No current mission.')
    const checkpoints = await store.listParticipantBackfillCheckpoints(missionId)
    await Promise.all(checkpoints.map((checkpoint) => store.upsertParticipantBackfillCheckpoint({
      mission_id: checkpoint.mission_id,
      traccar_device_id: checkpoint.traccar_device_id,
      window_from: checkpoint.window_from,
      window_to: checkpoint.window_to,
      reconciled_until: checkpoint.window_to,
      completed: true,
    })))
    await useParticipantStore.getState().controller?.refreshBackfillCheckpoints(missionId)
  })
}

const pickCharlie = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('participant-device-picker').getByText('Charlie Team', { exact: true }).click()
}

test('gives the Tracking, Tools and Layers body room during a calm mission [DON-300]', async ({ page }) => {
  await startMission(page, pickCharlie)
  await completeHistory(page)
  await expect(page.getByTestId('mission-participants-section')).toHaveAttribute('data-attention', '')
  await expect(page.getByTestId('mission-participants-section')).toHaveAttribute('data-open', 'false')
  await expect(page.getByTestId('mission-participants-section-summary')).toHaveText('1 device · history complete')
  await expect(page.getByTestId('mission-outings-section-summary')).toContainText('No active outing')
  const body = await page.getByTestId('sidebar-tab-content').boundingBox()
  // 188 px before option C. The browser copy also shows its ~35 px
  // "Browser testing mode" banner, which the desktop app does not.
  expect(body?.height ?? 0).toBeGreaterThanOrEqual(300)
  expect(await fullyShown(page.getByTestId('mission-pause-resume-btn'))).toBe(true)
  expect(await fullyShown(page.getByTestId('mission-finish-btn'))).toBe(true)
})

test('opens a folded section on request and keeps adding a participant possible [DON-300]', async ({ page }) => {
  await startMission(page, pickCharlie)
  await completeHistory(page)
  await expect(page.getByTestId('mission-participants-section')).toHaveAttribute('data-forced', 'false')
  await page.getByTestId('mission-participants-section-toggle').click()
  await expect(page.getByTestId('mission-participants-section')).toHaveAttribute('data-open', 'true')
  await expect(page.getByTestId('participant-add-btn')).toBeVisible()
  await page.getByTestId('mission-participants-section-toggle').click()
  await expect(page.getByTestId('participant-add-btn')).toBeHidden()
})

test('folding a section keeps an unfinished entry and its error [DON-300]', async ({ page }) => {
  await startMission(page, pickCharlie)
  await completeHistory(page)
  const toggle = page.getByTestId('mission-participants-section-toggle')
  await toggle.click()
  await page.getByTestId('participant-add-ref').selectOption({ index: 1 })
  await page.getByTestId('participant-history-start-custom').check()
  await page.getByTestId('participant-add-btn').click()
  await expect(page.getByTestId('participant-add-error')).toBeVisible()
  await toggle.click()
  await expect(page.getByTestId('participant-add-error')).toBeHidden()
  await toggle.click()
  await expect(page.getByTestId('participant-history-start-custom')).toBeChecked()
  await expect(page.getByTestId('participant-add-error')).toBeVisible()
})

test.describe('a warning keeps Participants open, with Pause and Finish still in view [DON-300]', () => {
  test('nobody selected', async ({ page }) => {
    await startMission(page, async () => undefined)
    const section = page.getByTestId('mission-participants-section')
    await expect(section).toHaveAttribute('data-forced', 'true')
    await expect(page.getByTestId('mission-participants-section-toggle')).toContainText('Needs attention')
    expect(await fullyShown(page.getByTestId('mission-pause-resume-btn'))).toBe(true)
    expect(await fullyShown(page.getByTestId('mission-finish-btn'))).toBe(true)
  })

  test('history still loading', async ({ page }) => {
    await startMission(page, async (target) => {
      await target.getByTestId('participant-group-picker').getByText('Hill Team', { exact: true }).click()
    }, '2')
    await expect(page.getByTestId('mission-participants-section')).toHaveAttribute('data-forced', 'true')
    await expect(page.getByTestId('participant-backfill-status').first()).toContainText('pending')
    expect(await fullyShown(page.getByTestId('mission-pause-resume-btn'))).toBe(true)
    expect(await fullyShown(page.getByTestId('mission-finish-btn'))).toBe(true)
  })
})
