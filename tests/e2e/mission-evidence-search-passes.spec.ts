import { expect, test } from '@playwright/test'

import { formatDublinDateTimeLocal } from '../../src/features/mission-review/dublin-local-time'

test.describe('PR5 mission evidence and repeated search passes [DON-279]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.getByTestId('mission-name-input').fill('Search Pass Evidence')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('outing-label-input').fill('Operational period 1')
    await page.getByTestId('outing-start-btn').click()

    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-search_area').click({ force: true })
    await clickMap(page, { x: 500, y: 180 })
    await clickMap(page, { x: 650, y: 220 })
    await clickMap(page, { x: 540, y: 340 })
    await rightClickMap(page, { x: 540, y: 340 })
    await page.getByTestId('drawing-name-input').fill('Area Alpha')
    await page.getByTestId('drawing-save-btn').click()

    await page.getByTestId('drawing-tool-search_area').click({ force: true })
    await clickMap(page, { x: 680, y: 180 })
    await clickMap(page, { x: 760, y: 230 })
    await clickMap(page, { x: 690, y: 330 })
    await rightClickMap(page, { x: 690, y: 330 })
    await page.getByTestId('drawing-name-input').fill('Area Beta')
    await page.getByTestId('drawing-save-btn').click()

    await page.getByTestId('outing-end-btn').click()
    await page.getByTestId('outing-label-input').fill('Operational period 2')
    await page.getByTestId('outing-start-btn').click()
  })

  test('records repeated coordinator outcomes without treating coverage as authority', async ({ page }) => {
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByRole('button', { name: 'Search Passes', exact: true }).click()
    await expect(page.getByTestId('search-operations-workspace')).toContainText('Area Alpha')
    await expect(page.getByTestId('search-operations-workspace')).toContainText(
      'coverage is advisory only',
    )

    await page.getByTestId('search-operation-coordinator').fill('Coordinator One')
    await page.getByTestId('search-operation-area').selectOption({ label: 'Area Beta' })
    await page.getByTestId('search-operation-outing').selectOption({ label: 'Operational period 2' })
    await page.getByTestId('search-assignment-team').fill('Team 2')
    await page.getByTestId('search-assignment-record').click()
    await expect(page.getByTestId('search-operation-feedback')).toContainText('Assignment recorded')

    await page.getByTestId('search-pass-assignment').selectOption({ index: 1 })
    const passWindow = await page.evaluate(() => {
      const outing = window.__SARTRACKER_BROWSER_HARNESS__?.readState().outings
        .find((entry) => entry.label === 'Operational period 2')
      if (outing === undefined) throw new Error('Operational period 2 was not found.')
      return {
        outingStart: outing.started_at,
        invalidStart: new Date(Date.parse(outing.started_at) - 1).toISOString(),
        validEnd: new Date().toISOString(),
      }
    })
    await page.getByTestId('search-pass-start').fill(
      formatDublinDateTimeLocal(passWindow.invalidStart),
    )
    await page.getByTestId('search-pass-record').click()
    await expect(page.getByTestId('search-operation-error')).toContainText(
      'Search pass start cannot be before its assignment outing start',
    )
    await expect(page.locator('[data-testid^="search-pass-search-pass-"]')).toHaveCount(0)

    await page.getByTestId('search-pass-start').fill(
      formatDublinDateTimeLocal(passWindow.outingStart),
    )
    await page.getByTestId('search-pass-end').fill(formatDublinDateTimeLocal(passWindow.validEnd))
    await page.getByTestId('search-pass-outcome').selectOption('partial')
    await page.getByTestId('search-pass-record').click()
    await expect(page.getByTestId('search-operation-feedback')).toContainText(
      'Geometry did not set the outcome',
    )
    await page.getByTestId('search-pass-outcome').selectOption('full')
    await page.getByTestId('search-pass-record').click()

    await expect(page.locator('[data-testid^="search-pass-search-pass-"]')).toHaveCount(2)
    await expect(page.getByTestId('search-operations-workspace')).toContainText('Coordinator-declared: partial')
    await expect(page.getByTestId('search-operations-workspace')).toContainText('Coordinator-declared: full')

    const recorded = await page.evaluate(() => {
      const state = window.__SARTRACKER_BROWSER_HARNESS__?.readState()
      const area = state?.searchAreas.find((entry) => entry.name === 'Area Beta')
      const outing = state?.outings.find((entry) => entry.label === 'Operational period 2')
      const assignment = state?.searchAssignments.find((entry) => entry.team_id === 'Team 2')
      const pass = state?.searchPasses.find((entry) => entry.assignment_id === assignment?.id)
      return { area, outing, assignment, pass }
    })
    expect(recorded.assignment).toMatchObject({
      search_area_id: recorded.area?.id,
      outing_id: recorded.outing?.id,
      participant_ids_json: '[]',
    })
    expect(recorded.pass).toMatchObject({
      search_area_id: recorded.area?.id,
      assignment_id: recorded.assignment?.id,
      started_at: passWindow.outingStart,
      ended_at: passWindow.validEnd,
      participant_ids: [],
      clue_ids: [],
      track_evidence_ids: [],
    })
  })
})

async function clickMap(page: import('@playwright/test').Page, position: { x: number; y: number }) {
  await page.locator('.maplibregl-canvas').first().click({ position, force: true })
}

async function rightClickMap(page: import('@playwright/test').Page, position: { x: number; y: number }) {
  await page.locator('.maplibregl-canvas').first().click({ position, button: 'right', force: true })
}
