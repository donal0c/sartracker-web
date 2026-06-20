import { expect, test } from '@playwright/test'

test.describe('M5 mission control workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await expect(page.getByTestId('mission-start-btn')).toBeEnabled()
  })

  test('starts a mission with a back-dated offset', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Night Search')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('mission-start-btn').click()

    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByTestId('current-mission-name')).toContainText('Night Search')
    await expect(page.getByTestId('mission-elapsed')).toHaveText(/^02:0\d:\d\d$/)
  })

  test('accepts the hosted testing 48 hour start offset without native validity drift', async ({
    page,
  }) => {
    const offsetInput = page.getByTestId('mission-offset-input')
    await expect(offsetInput).toHaveAttribute('max', '48')
    await page.getByTestId('mission-name-input').fill('Forty Eight Hour History')
    await offsetInput.fill('48')

    const validity = await offsetInput.evaluate((input) => {
      const element = input as HTMLInputElement
      return {
        value: element.value,
        max: element.max,
        valid: element.checkValidity(),
        validationMessage: element.validationMessage,
      }
    })
    expect(validity).toEqual({
      value: '48',
      max: '48',
      valid: true,
      validationMessage: '',
    })

    await page.getByTestId('mission-start-btn').click()

    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByTestId('mission-elapsed')).toHaveText(/^48:0\d:\d\d$/)
  })

  test('pauses and resumes while keeping elapsed time moving and active time frozen', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Training Mission')
    await page.getByTestId('mission-start-btn').click()

    await page.waitForTimeout(1100)
    const elapsedBeforePause = await page.getByTestId('mission-elapsed').textContent()

    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('paused')
    await expect(page.getByTestId('mission-pause-resume-btn')).toHaveText('Resume')

    // DON-64: paused must be unmistakable and the recovery control always reachable.
    await expect(page.getByTestId('mission-phase-chip')).toHaveText('PAUSED')
    await expect(page.getByTestId('mission-paused-banner')).toBeVisible()
    await expect(page.getByTestId('mission-paused-banner')).toContainText('Mission paused')
    const bannerResume = page.getByTestId('mission-paused-banner-resume-btn')
    await expect(bannerResume).toBeVisible()
    await expect(bannerResume).toBeEnabled()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'paused')

    const activeAtPause = await page.getByTestId('mission-active-search').textContent()
    await page.waitForTimeout(1100)
    const elapsedDuringPause = await page.getByTestId('mission-elapsed').textContent()
    const activeDuringPause = await page.getByTestId('mission-active-search').textContent()

    expect(elapsedDuringPause).not.toBe(elapsedBeforePause)
    expect(
      Math.abs(parseDuration(activeDuringPause) - parseDuration(activeAtPause)),
    ).toBeLessThanOrEqual(1)

    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    const activeAtResume = await page.getByTestId('mission-active-search').textContent()
    await page.waitForTimeout(2100)
    const activeAfterResume = await page.getByTestId('mission-active-search').textContent()
    expect(parseDuration(activeAfterResume)).toBeGreaterThan(parseDuration(activeAtResume))
  })

  test('finishes a mission through confirmation and returns to idle state', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Finish Flow')
    await page.getByTestId('mission-start-btn').click()

    await page.getByTestId('mission-finish-btn').click()
    await expect(page.getByTestId('mission-finish-dialog')).toBeVisible()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()

    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('mission-start-btn')).toBeEnabled()
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeDisabled()
    await expect(page.getByTestId('mission-finish-btn')).toBeDisabled()
  })

  test('finish confirmation is an accessible alertdialog and cancels with Escape', async ({
    page,
  }) => {
    await page.getByTestId('mission-name-input').fill('Keyboard Finish Flow')
    await page.getByTestId('mission-start-btn').click()

    const finishButton = page.getByTestId('mission-finish-btn')
    await finishButton.click()

    const dialog = page.getByRole('alertdialog', { name: 'End Mission?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Confirm Finish' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(finishButton).toBeFocused()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('finalizes a finished mission via archive-and-lock governance flow', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Finalize Flow')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()

    await expect(page.getByTestId('mission-governance-card')).toContainText('Finalize Flow')
    await page.getByTestId('mission-finalize-btn').click()
    await expect(page.getByTestId('mission-finalize-dialog')).toBeVisible()
    await page.getByTestId('mission-finalize-confirm').click()

    await expect(page.getByTestId('mission-governance-card')).toContainText('finalized')
    await expect(page.getByText(/Mission archived to/)).toBeVisible()

    const persistedMission = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      if (raw === null) {
        return null
      }

      const parsed = JSON.parse(raw) as {
        missions?: Array<{ name: string; status: string }>
      }

      return parsed.missions?.find((mission) => mission.name === 'Finalize Flow') ?? null
    })

    expect(persistedMission?.status).toBe('finalized')
  })

  test('unlocks a finalized mission through the configured admin roster', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem(
        'sartracker:browser-settings',
        JSON.stringify({
          missionDefaults: {
            adminRoster: ['Ops Lead'],
          },
        }),
      )
    })
    await page.reload()

    await page.getByTestId('mission-name-input').fill('Unlock Flow')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
    await page.getByTestId('mission-finalize-btn').click()
    await page.getByTestId('mission-finalize-confirm').click()

    await page.getByTestId('mission-unlock-btn').click()
    await expect(page.getByTestId('mission-unlock-dialog')).toBeVisible()
    await page.getByTestId('mission-unlock-admin').selectOption('Ops Lead')
    await page.getByTestId('mission-unlock-reason').fill('Need to add follow-up notes')
    await page.getByTestId('mission-unlock-confirm').click()

    await expect(page.getByTestId('mission-governance-card')).toContainText('finished')
    await expect(page.getByText(/Mission unlocked by Ops Lead/)).toBeVisible()
  })

  test('finishes a paused mission without letting active search time advance', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Paused Finish Flow')
    await page.getByTestId('mission-start-btn').click()

    await page.waitForTimeout(1100)
    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('paused')

    const activeAtPause = await page.getByTestId('mission-active-search').textContent()
    await page.waitForTimeout(1100)

    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()

    await expect(page.getByTestId('mission-control')).toContainText('idle')
    const persistedMission = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      if (raw === null) {
        return null
      }

      const parsed = JSON.parse(raw) as {
        missions?: Array<{
          name: string
          status: string
          start_time: string
          finish_time: string | null
          paused_seconds: number
        }>
      }

      return parsed.missions?.find((mission) => mission.name === 'Paused Finish Flow') ?? null
    })

    expect(persistedMission?.status).toBe('finished')
    expect(persistedMission?.finish_time).not.toBeNull()
    expect(persistedMission?.paused_seconds).toBeGreaterThanOrEqual(1)

    const elapsedAtFinish = Math.floor(
      (Date.parse(persistedMission!.finish_time ?? '') - Date.parse(persistedMission!.start_time)) / 1000,
    )
    // The UI text and persisted timestamps are sampled on separate seconds.
    // Allow the scheduler-boundary drift while still proving active time did
    // not continue advancing through the paused interval.
    expect(
      Math.abs(Math.max(0, elapsedAtFinish - persistedMission!.paused_seconds) - parseDuration(activeAtPause)),
    ).toBeLessThanOrEqual(2)
  })

  test('warns before reusing an existing mission name', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Duplicate Test')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()

    await page.getByTestId('mission-name-input').fill('Duplicate Test')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText(
      'Mission name already exists.',
    )

    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('rejects invalid start offsets before creating a mission', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Offset Guardrails')
    await page.getByTestId('mission-offset-input').fill('49')
    await page.getByTestId('mission-start-btn').click()

    await expect(page.getByTestId('mission-control')).toContainText(
      'Start offset must be between 0 and 48 hours.',
    )
    await expect(page.getByTestId('mission-control')).toContainText('idle')
  })

  test('surfaces recovery on reload and can resume the mission', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Recovery Flow')
    await page.getByTestId('mission-start-btn').click()

    await page.reload()
    await expect(page.getByTestId('mission-recovery-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).click()

    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByTestId('current-mission-name')).toContainText('Recovery Flow')
  })

  test('surfaces recovery on reload and can start fresh', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Fresh Flow')
    await page.getByTestId('mission-start-btn').click()

    await page.reload()
    await expect(page.getByTestId('mission-recovery-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Start Fresh' }).click()

    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('mission-start-btn')).toBeEnabled()
  })

  test('moves minimized Mission Control into the top panel without side-panel safety actions', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Minimize Flow')
    await page.getByTestId('mission-start-btn').click()

    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByTestId('mission-control-collapse-btn')).toBeVisible()
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeVisible()

    await page.getByTestId('mission-control-collapse-btn').click()

    await expect(page.getByTestId('mission-control-dock')).toHaveCount(0)
    await expect(page.getByTestId('command-mast-mission-control-minimized')).toBeVisible()
    await expect(page.getByTestId('command-mast-mission-control-minimized')).toContainText('Minimize Flow')
    await expect(page.getByTestId('mission-pause-resume-btn')).toHaveCount(0)
    await expect(page.getByTestId('mission-finish-btn')).toHaveCount(0)

    await page.getByTestId('command-mast-mission-control-expand').click()

    await expect(page.getByTestId('mission-control-dock')).toBeVisible()
    await expect(page.getByTestId('mission-control-collapse-btn')).toBeVisible()
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeVisible()
  })

  test('does not show minimize in paused mission control', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Paused Minimize Guard')
    await page.getByTestId('mission-start-btn').click()

    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('paused')

    await expect(page.getByTestId('mission-control-collapse-btn')).toHaveCount(0)
    await expect(page.getByTestId('mission-control-expand-btn')).toHaveCount(0)
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeVisible()
    await expect(page.getByTestId('mission-paused-banner')).toBeVisible()
    await expect(page.getByTestId('mission-paused-banner')).toContainText('Mission paused')
  })

  test('keeps Mission Control expanded in focus mode because the normal top mast is hidden', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Focus-Minimize Guard')
    await page.getByTestId('mission-start-btn').click()

    await page.getByTestId('focus-mode-toggle').click()
    await expect(page.getByTestId('focus-mode-sidebar')).toBeVisible()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByTestId('mission-control-collapsed-summary')).toHaveCount(0)
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeVisible()
    await expect(page.getByTestId('mission-finish-btn')).toBeVisible()
    await expect(page.getByTestId('mission-elapsed')).toBeVisible()
  })

})

function parseDuration(value: string | null): number {
  if (value === null) {
    throw new Error('Duration text was missing.')
  }

  const [hours, minutes, seconds] = value.split(':').map((part) => Number(part))
  return hours * 3600 + minutes * 60 + seconds
}
