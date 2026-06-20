import { expect, test } from '@playwright/test'

test.describe('M12 settings workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
  })

  test('opens the workspace and validates Traccar provider inputs', async ({ page }) => {
    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-workspace')).toBeVisible()
    await expect(page.getByTestId('official-map-source-status')).toContainText('Official maps are not configured.')

    await page.getByRole('button', { name: 'Traccar HTTP' }).click()
    await page.getByTestId('settings-provider-url').fill('https://traccar.example.com')
    await expect(page.getByTestId('settings-save')).toBeDisabled()
    await expect(page.getByText(
      'Password is required for basic authentication.',
    )).toBeVisible()

    await page.getByTestId('settings-provider-email').fill('ops@example.com')
    await page.getByTestId('settings-provider-secret').fill('secret')
    await expect(page.getByTestId('settings-test-connection')).toBeEnabled()
    await expect(page.getByTestId('settings-save')).toBeEnabled()
  })

  test('tests Traccar credentials against the configured server in browser validation mode', async ({
    page,
  }) => {
    const sessionRequests: string[] = []
    const deviceRequests: string[] = []

    await page.route('http://traccar.test:8082/api/session', async (route, request) => {
      sessionRequests.push(request.postData() ?? '')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Set-Cookie': 'JSESSIONID=session-123; Path=/; HttpOnly',
        },
        body: JSON.stringify({ id: 4, email: 'apiuser' }),
      })
    })

    await page.route('http://traccar.test:8082/api/devices', async (route, request) => {
      deviceRequests.push(request.headers().authorization ?? '')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 1, name: 'S-Tab', status: 'online' }]),
      })
    })

    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-workspace')).toBeVisible()

    await page.getByRole('button', { name: 'Traccar HTTP' }).click()
    await page.getByTestId('settings-provider-url').fill('http://traccar.test:8082')
    await page.getByTestId('settings-provider-email').fill('apiuser')
    await page.getByTestId('settings-provider-secret').fill('apiuser')
    await page.getByTestId('settings-test-connection').click()

    await expect(page.getByTestId('settings-feedback')).toContainText('Connection successful.')
    expect(sessionRequests).toEqual(['email=apiuser&password=apiuser'])
    expect(deviceRequests).toEqual(['Basic YXBpdXNlcjphcGl1c2Vy'])
  })

  test('save and connect starts live tracking from browser validation settings', async ({
    page,
  }) => {
    await routeTraccarSuccess(page)

    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-workspace')).toBeVisible()

    await page.getByRole('button', { name: 'Traccar HTTP' }).click()
    await page.getByTestId('settings-provider-url').fill('http://traccar.test:8082')
    await page.getByTestId('settings-provider-email').fill('apiuser')
    await page.getByTestId('settings-provider-secret').fill('apiuser')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden()

    await page.getByTestId('mission-name-input').fill('Live Tracking Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('settings-save-connect').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden()

    await expect(page.getByTestId('tracking-status')).toContainText('online')
    await expect(page.getByTestId('tracking-status')).toContainText('1')
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toContainText('S-Tab')
  })

  test('connected tracking stops advertising online telemetry after mission finish', async ({
    page,
  }) => {
    await routeTraccarSuccess(page)

    await page.getByTestId('open-settings-workspace').click()
    await page.getByRole('button', { name: 'Traccar HTTP' }).click()
    await page.getByTestId('settings-provider-url').fill('http://traccar.test:8082')
    await page.getByTestId('settings-provider-email').fill('apiuser')
    await page.getByTestId('settings-provider-secret').fill('apiuser')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden()

    await page.getByTestId('mission-name-input').fill('Connected Finish Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('settings-save-connect').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByTestId('tracking-status')).toContainText('online')

    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()

    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('tracking-status')).toContainText('idle')
    await expect(page.getByTestId('tracking-status')).toContainText('Waiting for an active mission.')
    await expect(page.getByTestId('tracking-status')).toContainText('0')
    await expect(page.getByTestId('tracking-status')).not.toContainText('online')
  })

  test('large hosted breadcrumb history does not block current tracking status or exceed browser storage cap', async ({
    page,
  }) => {
    test.setTimeout(45_000)
    await routeTraccarSuccess(page, { breadcrumbCount: 14_500 })

    await page.getByTestId('open-settings-workspace').click()
    await page.getByRole('button', { name: 'Traccar HTTP' }).click()
    await page.getByTestId('settings-provider-url').fill('http://traccar.test:8082')
    await page.getByTestId('settings-provider-email').fill('apiuser')
    await page.getByTestId('settings-provider-secret').fill('apiuser')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden()

    await page.getByTestId('mission-name-input').fill('Large History Mission')
    await page.getByTestId('mission-offset-input').fill('48')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('settings-save-connect').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden({ timeout: 15_000 })

    await expect(page.getByTestId('tracking-status')).toContainText('online')
    await expect(page.getByTestId('tracking-status')).toContainText('1')

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.sessionStorage.getItem('sartracker:browser-harness')
          if (raw === null) {
            return null
          }

          const parsed = JSON.parse(raw) as { positions?: unknown[] }
          return parsed.positions?.length ?? 0
        }),
      )
      .toBe(2_000)
  })

  test('persists mission defaults and coordinate display preference in browser validation mode', async ({
    page,
  }) => {
    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-workspace')).toBeVisible()

    await page.getByTestId('settings-auto-save-interval').fill('90')
    await page.getByTestId('settings-primary-root').fill('/missions/primary')
    await page.getByTestId('settings-tracking-cache-enabled').uncheck()
    await page.getByRole('button', { name: 'TM65 first' }).click()
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-workspace')).toBeHidden()

    await page.reload()
    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-auto-save-interval')).toHaveValue('90')
    await expect(page.getByTestId('settings-primary-root')).toHaveValue('/missions/primary')
    await expect(page.getByTestId('settings-tracking-cache-enabled')).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'TM65 first' })).toHaveClass(/bg-amber-500/)
  })

  test('keeps keyboard focus inside the settings dialog and returns focus on Escape', async ({
    page,
  }) => {
    const opener = page.getByTestId('open-settings-workspace')
    await opener.click()

    const dialog = page.getByRole('dialog', { name: 'Operational Settings' })
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('settings-save-connect')).toBeVisible()
    await expect(page.getByTestId('workspace-close-btn')).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    await expect(page.getByTestId('settings-save-connect')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('DON-204: requires confirmation before discarding unsaved settings edits', async ({
    page,
  }) => {
    const opener = page.getByTestId('open-settings-workspace')
    await opener.click()

    const dialog = page.getByRole('dialog', { name: 'Operational Settings' })
    await expect(dialog).toBeVisible()
    await page.getByTestId('settings-primary-root').fill('/missions/draft-root')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('settings-discard-confirmation')).toBeVisible()

    await page.getByTestId('settings-keep-editing').click()
    await expect(page.getByTestId('settings-discard-confirmation')).toBeHidden()
    await expect(page.getByTestId('settings-primary-root')).toHaveValue('/missions/draft-root')

    await page.keyboard.press('Escape')
    await page.getByTestId('settings-discard-changes').click()
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()

    await opener.click()
    await expect(page.getByTestId('settings-primary-root')).not.toHaveValue('/missions/draft-root')
  })
})

async function routeTraccarSuccess(
  page: import('@playwright/test').Page,
  options: { readonly breadcrumbCount?: number } = {},
) {
  await page.route('http://traccar.test:8082/api/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Set-Cookie': 'JSESSIONID=session-123; Path=/; HttpOnly',
      },
      body: JSON.stringify({ id: 4, email: 'apiuser' }),
    })
  })

  await page.route('http://traccar.test:8082/api/devices', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          name: 'S-Tab',
          status: 'online',
          lastUpdate: '2026-05-14T17:29:40.391Z',
          uniqueId: '52959800',
          category: 'person',
        },
      ]),
    })
  })

  await page.route('http://traccar.test:8082/api/positions**', async (route, request) => {
    const url = new URL(request.url())
    if (url.searchParams.has('deviceId')) {
      const breadcrumbCount = options.breadcrumbCount ?? 0
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          Array.from({ length: breadcrumbCount }, (_, index) => ({
            id: 400_000 + index,
            deviceId: 1,
            latitude: 51.99917 + index / 1_000_000,
            longitude: -9.74406 - index / 1_000_000,
            fixTime: new Date(Date.UTC(2026, 4, 14, 10, 0, index)).toISOString(),
            valid: true,
            attributes: { batteryLevel: 82 },
          })),
        ),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 396947,
          deviceId: 1,
          latitude: 51.99917,
          longitude: -9.74406,
          fixTime: '2026-05-14T17:29:40.391Z',
          valid: true,
          attributes: { batteryLevel: 82 },
        },
      ]),
    })
  })
}
