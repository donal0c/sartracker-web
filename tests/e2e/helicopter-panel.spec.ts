import { expect, test } from '@playwright/test'

test.describe('M23 helicopter layer parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Helicopter Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('persists helicopter slots, renders the overlay, and supports visibility toggles', async ({
    page,
  }) => {
    await page.getByTestId('helicopter-toggle-slot_1').click()
    await page.getByTestId('helicopter-call-sign-slot_1').fill('Rescue 118')
    await page.getByTestId('helicopter-hex-id-slot_1').fill('4CA118')
    await page.getByTestId('helicopter-lat-slot_1').fill('52.0599')
    await page.getByTestId('helicopter-lon-slot_1').fill('-9.5045')
    await page.getByTestId('helicopter-altitude-slot_1').fill('1200')
    await page.getByTestId('helicopter-speed-slot_1').fill('95')
    await page.getByTestId('helicopter-heading-slot_1').fill('180')
    await page.getByTestId('helicopter-last-update-slot_1').fill('2026-04-11T12:00:00.000Z')
    await page.getByTestId('helicopter-save-slot_1').click()

    await expect.poll(async () => {
      return page.evaluate(() => {
        const harness = window.__SARTRACKER_BROWSER_HARNESS__
        return harness?.readState().helicopters?.length ?? 0
      })
    }).toBe(1)

    const helicopterId = await page.evaluate(() => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      return harness?.readState().helicopters?.[0]?.id ?? null
    })
    expect(helicopterId).not.toBeNull()

    await expect(page.getByTestId('helicopter-panel')).toContainText('1 ACTIVE')

    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-expand-group-helicopters').click()
    await page.getByTestId('layer-expand-layer-helicopters-slot-1').click()
    await expect(page.getByTestId('layer-tree')).toContainText('Rescue 118')

    await expect.poll(async () => {
      return page.evaluate(() => {
        const map = (window as Window & {
          __SARTRACKER_MAP__?: {
            getStyle: () => {
              sources?: Record<string, { data?: { features?: unknown[] } }>
            }
          }
        }).__SARTRACKER_MAP__
        const source = map?.getStyle().sources?.['mission-helicopters']
        const features = source?.data?.features
        return Array.isArray(features) ? features.length : 0
      })
    }).toBe(1)

    await page.getByTestId(`layer-visibility-feature-helicopter-${helicopterId}`).click()
    await expect(page.getByTestId(`layer-visibility-feature-helicopter-${helicopterId}`)).not.toBeChecked()

    await expect.poll(async () => {
      return page.evaluate(() => {
        const map = (window as Window & {
          __SARTRACKER_MAP__?: {
            getFilter: (layerId: string) => unknown
          }
        }).__SARTRACKER_MAP__
        return JSON.stringify(map?.getFilter('mission-helicopters-symbol') ?? null)
      })
    }).toContain(String(helicopterId))
  })
})
