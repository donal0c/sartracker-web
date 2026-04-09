import { expect, test } from '@playwright/test'

test.describe('M5 mission control workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toHaveText('SAR Tracker Web')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await expect(page.getByTestId('mission-start-btn')).toBeEnabled()
  })

  test('starts a mission with a back-dated offset', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Night Search')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('mission-start-btn').click()

    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByText('Current mission:')).toContainText('Night Search')
    await expect(page.getByTestId('mission-elapsed')).toHaveText(/^02:0\d:\d\d$/)
  })

  test('pauses and resumes while keeping elapsed time moving and active time frozen', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Training Mission')
    await page.getByTestId('mission-start-btn').click()

    await page.waitForTimeout(1100)
    const elapsedBeforePause = await page.getByTestId('mission-elapsed').textContent()

    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('paused')
    await expect(page.getByTestId('mission-pause-resume-btn')).toHaveText('Resume')

    const activeAtPause = await page.getByTestId('mission-active-search').textContent()
    await page.waitForTimeout(1100)
    const elapsedDuringPause = await page.getByTestId('mission-elapsed').textContent()
    const activeDuringPause = await page.getByTestId('mission-active-search').textContent()

    expect(elapsedDuringPause).not.toBe(elapsedBeforePause)
    expect(activeDuringPause).toBe(activeAtPause)

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
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Yes' }).click()

    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('mission-start-btn')).toBeEnabled()
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeDisabled()
    await expect(page.getByTestId('mission-finish-btn')).toBeDisabled()
  })

  test('finishes a paused mission without letting active search time advance', async ({ page }) => {
    await page.getByLabel('Mission Name').fill('Paused Finish Flow')
    await page.getByTestId('mission-start-btn').click()

    await page.waitForTimeout(1100)
    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('paused')

    const activeAtPause = await page.getByTestId('mission-active-search').textContent()
    await page.waitForTimeout(1100)

    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Yes' }).click()

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
    expect(Math.max(0, elapsedAtFinish - persistedMission!.paused_seconds)).toBe(
      parseDuration(activeAtPause),
    )
  })

  test('warns before reusing an existing mission name', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Duplicate Test')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Yes' }).click()

    await page.getByTestId('mission-name-input').fill('Duplicate Test')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText(
      'Mission name already exists.',
    )

    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('rejects invalid start offsets before creating a mission', async ({ page }) => {
    await page.getByLabel('Mission Name').fill('Offset Guardrails')
    await page.getByLabel('Start Offset (Hours)').fill('49')
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
    await page.getByRole('button', { name: 'Resume Mission' }).click()

    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByText('Current mission:')).toContainText('Recovery Flow')
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
})

function parseDuration(value: string | null): number {
  if (value === null) {
    throw new Error('Duration text was missing.')
  }

  const [hours, minutes, seconds] = value.split(':').map((part) => Number(part))
  return hours * 3600 + minutes * 60 + seconds
}
