import { expect, test } from '@playwright/test'
import path from 'node:path'

test.describe('M15 mission review workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Review Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('shows mission details, audit history, and opens archive paths', async ({ page }) => {
    await createMarker(page, { name: 'Boot Print', typeLabel: 'Clue', position: { x: 460, y: 260 } })
    await injectTrackingSnapshot(page)

    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
    await page.getByTestId('mission-finalize-btn').click()
    await page.getByTestId('mission-finalize-confirm').click()

    await page.getByTestId('open-mission-review-workspace').click()
    await expect(page.getByTestId('mission-review-workspace')).toBeVisible()
    await expect(page.getByTestId('mission-review-workspace').getByText('Review Mission', { exact: true })).toBeVisible()
    await expect
      .poll(async () => page.getByTestId('mission-review-workspace').textContent(), {
        timeout: 10000,
      })
      .toContain('finalized')
    await expect(page.getByTestId('mission-review-workspace')).toContainText('Mission Finalized')
    await expect(page.getByTestId('mission-review-workspace')).toContainText('Boot Print')

    await page.getByTestId(/mission-review-open-path-/).first().click()
    await expect(page.getByTestId('mission-review-path-feedback')).toContainText('Opened')

    const openedPaths = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      if (raw === null) {
        return []
      }

      const parsed = JSON.parse(raw) as { openedPaths?: string[] }
      return parsed.openedPaths ?? []
    })

    expect(openedPaths.some((path) => path.endsWith('.zip'))).toBe(true)
  })

  test('DON-176: Review is docked and leaves active-mission controls operable', async ({ page }) => {
    // Open Review while a mission is active. The docked workspace must NOT cover
    // or intercept the mission-control rail or the map underneath.
    await page.getByTestId('open-mission-review-workspace').click()
    await expect(page.getByTestId('mission-review-workspace')).toBeVisible()

    // No full-screen "Close workspace" backdrop should be intercepting clicks.
    await expect(page.getByRole('button', { name: 'Close workspace' })).toHaveCount(0)

    // The docked review surface is explicitly marked read-only for operators.
    await expect(page.getByTestId('mission-review-docked-readonly-note')).toBeVisible()

    // Critical active-mission controls remain operable WITHOUT closing Review.
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeEnabled()
    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('paused')
    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    // The map remains clickable (marker dialog opens) while Review stays open.
    // Click in the clear map band to the right of the docked panel and left of
    // the operational sidebar.
    await page.getByTestId('map-container').click({ position: { x: 720, y: 300 } })
    await expect(page.getByTestId('marker-dialog')).toBeVisible()
    await page.getByTestId('marker-dialog').getByRole('button', { name: 'Cancel' }).click()

    // Review is still open the whole time.
    await expect(page.getByTestId('mission-review-workspace')).toBeVisible()

    // Esc must still close docked Review even though focus has left the panel
    // (the map click above moved focus out). Docked mode is non-modal, so this
    // relies on a document-level Escape handler, not a panel-scoped one.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('mission-review-workspace')).toBeHidden()
  })

  test('hides tracking telemetry from the audit log by default and reveals it on toggle', async ({
    page,
  }) => {
    await createMarker(page, { name: 'Boot Print', typeLabel: 'Clue', position: { x: 460, y: 260 } })
    // Inject tracking positions — each one records a position_recorded telemetry event.
    await injectTrackingSnapshot(page)

    await page.getByTestId('open-mission-review-workspace').click()
    await expect(page.getByTestId('mission-review-workspace')).toBeVisible()

    const auditLog = page.getByTestId('mission-review-event-log')
    await expect(auditLog).toBeVisible()

    // Operator-meaningful events are shown; tracking telemetry is hidden by default.
    await expect(auditLog).toContainText('Marker Created')
    await expect(auditLog).not.toContainText('position_recorded')
    await expect(auditLog).not.toContainText('device_updated')

    // Enabling the toggle reloads the log with telemetry included.
    await page.getByTestId('mission-review-telemetry-toggle').locator('input').check()
    await expect(auditLog).toContainText('position_recorded')

    // Disabling the toggle returns to the operator-only view.
    await page.getByTestId('mission-review-telemetry-toggle').locator('input').uncheck()
    await expect(auditLog).not.toContainText('position_recorded')
    await expect(auditLog).toContainText('Marker Created')
  })

  test('filters marker log rows and shows selected marker detail', async ({ page }) => {
    await createMarker(page, { name: 'Boot Print', typeLabel: 'Clue', position: { x: 440, y: 220 } })
    await createMarker(page, { name: 'Loose Scree', typeLabel: 'Hazard', position: { x: 560, y: 310 } })

    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByRole('button', { name: 'Marker Log' }).click()
    await expect(page.getByTestId('mission-review-marker-log')).toBeVisible()

    await page.getByTestId('mission-review-marker-search').fill('Boot')
    await expect(page.getByTestId('mission-review-marker-log')).toContainText('Boot Print')
    await expect(page.getByTestId('mission-review-marker-log')).not.toContainText('Loose Scree')

    await expect(page.getByTestId('mission-review-marker-detail')).toContainText('Boot Print')
    await expect(page.getByTestId('mission-review-marker-detail')).toContainText('Footprint')

    await page.getByTestId('mission-review-marker-search').fill('')
    await page.getByTestId('mission-review-marker-type-filter').selectOption('hazard')
    await expect(page.getByTestId('mission-review-marker-log')).toContainText('Loose Scree')
    await expect(page.getByTestId('mission-review-marker-detail')).toContainText('Loose Scree')
  })

  test('shows marker evidence and audit metadata in review flows', async ({ page }) => {
    await createMarker(page, {
      name: 'Evidence Cache',
      typeLabel: 'Clue',
      position: { x: 470, y: 250 },
      updatedBy: 'Ops Lead',
      coordinatorIds: 'C1, C2',
      attachmentPath: path.resolve('tests/fixtures/marker-evidence.txt'),
    })

    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByRole('button', { name: 'Marker Log' }).click()

    await expect(page.getByTestId('mission-review-marker-detail')).toContainText('Evidence Cache')
    await expect(page.getByTestId('mission-review-marker-detail')).toContainText('Ops Lead')
    await expect(page.getByTestId('mission-review-marker-detail')).toContainText('C1, C2')
    await expect(page.getByTestId('mission-review-marker-detail')).toContainText('marker-evidence.txt')
    await expect(page.getByTestId('mission-review-marker-history')).toContainText('Marker Created')

    await page.getByTestId('mission-review-marker-open-attachment').click()
    await expect.poll(async () => {
      return page.evaluate(() => {
        const raw = window.sessionStorage.getItem('sartracker:browser-harness')
        if (raw === null) {
          return []
        }

        const parsed = JSON.parse(raw) as { openedPaths?: string[] }
        return parsed.openedPaths ?? []
      })
    }).toContainEqual(expect.stringContaining('marker-evidence.txt'))
  })
})

async function createMarker(
  page: import('@playwright/test').Page,
  options: {
    readonly name: string
    readonly typeLabel: 'Clue' | 'Hazard'
    readonly position: { readonly x: number; readonly y: number }
    readonly updatedBy?: string
    readonly coordinatorIds?: string
    readonly attachmentPath?: string
  },
) {
  await page.getByTestId('map-container').click({ position: options.position })

  const dialog = page.getByTestId('marker-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('marker-name-input').fill(options.name)
  await dialog.getByText(options.typeLabel, { exact: true }).click()

  if (options.typeLabel === 'Clue') {
    await page.getByTestId('marker-clue-type-input').selectOption('Footprint')
  } else {
    await page.getByTestId('marker-hazard-type-input').selectOption('Cliff/Drop-off')
  }

  if (options.updatedBy !== undefined) {
    await page.getByTestId('marker-updated-by-input').fill(options.updatedBy)
  }

  if (options.coordinatorIds !== undefined) {
    await page.getByTestId('marker-coordinator-ids-input').fill(options.coordinatorIds)
  }

  if (options.attachmentPath !== undefined) {
    await page.getByTestId('marker-attachment-input').setInputFiles(options.attachmentPath)
    await expect(page.getByTestId('marker-attachment-summary')).toContainText('marker-evidence.txt')
  }

  await page.getByTestId('marker-save-btn').scrollIntoViewIfNeeded()
  await page.getByTestId('marker-save-btn').click()
  await expect(dialog).toBeHidden()
}

async function injectTrackingSnapshot(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const harness = window.__SARTRACKER_BROWSER_HARNESS__
    if (harness === undefined) {
      throw new Error('Browser harness API unavailable.')
    }

    await harness.injectTrackingSnapshot({
      devices: [
        {
          device_id: 'alpha',
          name: 'Alpha Team',
          status: 'online',
          last_seen: '2026-04-10T17:00:00.000Z',
          unique_id: null,
          category: null,
        },
      ],
      positions: [
        {
          id: 'pos-alpha',
          device_id: 'alpha',
          lat: 51.99917,
          lon: -9.74406,
          altitude: null,
          speed: 3.5,
          battery: 82,
          accuracy: null,
          timestamp: '2026-04-10T17:00:00.000Z',
          source: null,
          data_origin: 'live',
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
      breadcrumbs: [
        {
          id: 'crumb-alpha',
          device_id: 'alpha',
          lat: 51.9989,
          lon: -9.7444,
          altitude: null,
          speed: 3.1,
          battery: 83,
          accuracy: null,
          timestamp: '2026-04-10T16:58:00.000Z',
          source: null,
          data_origin: 'live',
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
    })
  })
}
