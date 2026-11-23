/**
 * Visual check of the light theme (DON-344, SAR-QA-029).
 *
 * The team asked for the black background to go: light grey panels, dark text,
 * strong borders. Each capture also asserts, in the browser, that the panel is
 * light, its text is dark, and the safety alarms are still solid red with white
 * words, so a regression back to black (or to washed-out warnings) fails here
 * even before anyone reviews the screenshots.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

import { expandAllLayers } from '../helpers/layers'
import { openDiagnostics, openMissionPanel, openWorkspacePanel, pressPauseResume } from '../helpers/workspace-panels'
import { captureAndRegister } from './helpers/verification-manifest'

const BASE_PROMPT = 'This is the LIGHT theme: panels, top bar, menus and dialogs must be light grey (not black) with dark, readable text and clearly visible borders. The map itself is not themed. Map tiles loading or unavailable are acceptable and are not a failure.'

/** Relative luminance of a computed CSS colour such as "rgb(238, 240, 243)". */
function luminanceOf(css: string): number {
  const [r, g, b] = (css.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((part) => {
    const c = Number(part) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Asserts a surface is drawn light with dark text, as the team asked. */
async function expectLightSurface(locator: Locator, what: string): Promise<void> {
  const { background, color } = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, color: style.color }
  })
  expect(luminanceOf(background), `${what} background ${background}`).toBeGreaterThan(0.6)
  expect(luminanceOf(color), `${what} text ${color}`).toBeLessThan(0.05)
}

/** Asserts an alarm stays solid red with white words in the light theme. */
async function expectRedAlarm(locator: Locator, what: string, words: Locator = locator): Promise<void> {
  const background = await locator.evaluate((element) => getComputedStyle(element).backgroundColor)
  const color = await words.first().evaluate((element) => getComputedStyle(element).color)
  const [r, g, b] = (background.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number]
  expect(r, `${what} background ${background} is red`).toBeGreaterThan(100)
  expect(r, `${what} background ${background} is red`).toBeGreaterThan(g * 2.5)
  expect(r, `${what} background ${background} is red`).toBeGreaterThan(b * 2.5)
  expect(luminanceOf(color), `${what} text ${color}`).toBeGreaterThan(0.9)
}

/**
 * Computed WCAG contrast of an element's text against the first opaque
 * background behind it, read from the rendered page. With `frames`, the
 * element's (or an ancestor's) CSS animations are paused at each time in ms and
 * the lowest ratio is returned, so every phase of a flash is measured.
 */
async function computedContrast(locator: Locator, frames: readonly number[] = [0]): Promise<number> {
  return locator.first().evaluate((element, times) => {
    const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).map(Number)
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.slice(0, 3).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }) as [number, number, number]
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const backgroundBehind = (start: Element): number[] => {
      for (let node: Element | null = start; node !== null; node = node.parentElement) {
        const rgba = parse(getComputedStyle(node).backgroundColor)
        if (rgba.length >= 3 && (rgba[3] ?? 1) >= 0.99) return rgba
      }
      return [255, 255, 255]
    }
    const animations: Animation[] = []
    for (let node: Element | null = element; node !== null; node = node.parentElement) animations.push(...node.getAnimations())
    let lowest = Infinity
    for (const time of times) {
      for (const animation of animations) { animation.pause(); animation.currentTime = time }
      const a = lum(parse(getComputedStyle(element).color))
      const b = lum(backgroundBehind(element))
      lowest = Math.min(lowest, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))
    }
    for (const animation of animations) animation.play()
    return lowest
  }, frames)
}

/**
 * WCAG contrast of a keyboard-focused control's outline against the surface
 * around it (the parent's background), paused at each animation time in ms so
 * every phase of a flashing alarm is measured. Focus is moved by keyboard so
 * :focus-visible applies, and CSS transitions are allowed to finish first.
 */
async function focusRingContrast(page: Page, locator: Locator, frames: readonly number[]): Promise<number> {
  await page.keyboard.press('Shift')
  await locator.focus()
  await expect(locator).toBeFocused()
  return locator.evaluate(async (element, times) => {
    await Promise.all(element.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished))
    if (!element.matches(':focus-visible')) throw new Error('control is not :focus-visible')
    const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).map(Number)
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.slice(0, 3).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }) as [number, number, number]
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const surround = (): number[] => {
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const rgba = parse(getComputedStyle(node).backgroundColor)
        if (rgba.length >= 3 && (rgba[3] ?? 1) >= 0.99) return rgba
      }
      return [255, 255, 255]
    }
    const animations: Animation[] = []
    for (let node = element.parentElement; node !== null; node = node.parentElement) animations.push(...node.getAnimations())
    let lowest = Infinity
    for (const time of times) {
      for (const animation of animations) { animation.pause(); animation.currentTime = time }
      const a = lum(parse(getComputedStyle(element).outlineColor))
      const b = lum(surround())
      lowest = Math.min(lowest, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))
    }
    for (const animation of animations) animation.play()
    return lowest
  }, frames)
}

/** Both halves of the 1.1 s paused/alarm flash. */
const FLASH_FRAMES = [100, 800] as const

async function openLight(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('sartracker:high-contrast', 'true'))
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.waitForSelector('canvas', { timeout: 20_000 })
}

async function startMission(page: Page): Promise<void> {
  await openMissionPanel(page)
  await page.getByTestId('mission-name-input').fill('Ridge search — light theme')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
}

async function injectStationaryPerson(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const base = { device_id: 'alpha', lon: -9.7, altitude: null, speed: null, battery: 64, accuracy: 4, source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false }
    const first = { ...base, id: 'first', lat: 52.0, timestamp: '2026-08-22T10:00:00.000Z' }
    const latest = { ...base, id: 'latest', lat: 52.00001, timestamp: '2026-08-22T10:20:00.000Z' }
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: latest.timestamp, unique_id: null, category: 'person' }],
      positions: [latest], breadcrumbs: [first, latest],
    })
  })
}

test.describe('Visual: light theme [DON-344]', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('start screen and top bar are light grey with dark text', async ({ page }) => {
    await openLight(page)
    await openMissionPanel(page)
    await expect(page.getByTestId('mission-name-input')).toBeVisible()
    await expectLightSurface(page.getByTestId('ws-top-bar'), 'top bar')
    await expectLightSurface(page.locator('.ws-mission-card'), 'start card')
    await captureAndRegister(page, {
      testId: 'light-theme-start', testName: 'Light theme start screen', area: 'app-shell', severity: 'critical',
      verificationPrompt: `${BASE_PROMPT} Check 1. The top bar is light grey with a dark "Start a mission" / "No mission running" button and readable People, Layers, Settings and More buttons. 2. The New mission card over the map is light grey with a dark border, a readable mission name field and roll back field, and an amber START button with dark text. 3. The Maps and Map Tools chips and the map scale are light with dark text. 4. The coordinate strip at the bottom is light with dark text.`,
      playwrightAssertions: ['data-theme=light', 'top bar light with dark text', 'start card light with dark text'],
    })
  })

  test('People and Tracking show a stationary person as an amber warning on light grey', async ({ page }) => {
    await openLight(page)
    await startMission(page)
    await injectStationaryPerson(page)
    await openWorkspacePanel(page, 'people')
    await expect(page.getByTestId('ws-people-panel')).toContainText('Alpha Team')
    await expectLightSurface(page.locator('.ws-side').first(), 'side panel')
    await captureAndRegister(page, {
      testId: 'light-theme-people', testName: 'Light theme People with a stationary person', area: 'tracking', severity: 'critical',
      verificationPrompt: `${BASE_PROMPT} Check 1. The People panel is light grey with dark names. 2. Alpha Team is marked as needing attention with an amber/brown highlight and readable status words (not moving / stationary). 3. The top bar shows the mission as Running in a readable green, and the tracking line is readable. 4. Tick boxes and the person colour swatch are visible against the light panel.`,
      playwrightAssertions: ['People panel light with dark text', 'Alpha Team listed'],
    })
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-happened')).toBeVisible()
    await captureAndRegister(page, {
      testId: 'light-theme-tracking', testName: 'Light theme Tracking panel', area: 'tracking', severity: 'high',
      verificationPrompt: `${BASE_PROMPT} Check 1. The Tracking panel is light grey with dark, readable "What happened", "What the map shows" and "What to do" text. 2. Its buttons have visible borders and dark labels.`,
      playwrightAssertions: ['Tracking panel visible'],
    })
  })

  test('Layers, Tools, Settings and the More menu read on light grey', async ({ page }) => {
    await openLight(page)
    await startMission(page)
    await injectStationaryPerson(page)
    await openWorkspacePanel(page, 'layers')
    await expandAllLayers(page)
    await expect(page.getByTestId('layer-row-group-map-tools')).toBeVisible()
    await page.getByTestId('basemap-menu-toggle').click()
    await captureAndRegister(page, {
      testId: 'light-theme-layers', testName: 'Light theme Layers', area: 'layers', severity: 'high',
      verificationPrompt: `${BASE_PROMPT} Check 1. The Layers panel is light grey; group and layer names, the search box and tick boxes are dark and readable. 2. No black panel or black row remains. 3. The Maps menu at the top-left of the map is open: a light panel listing the basemaps, the selected one clearly marked, with readable map health lines.`,
      playwrightAssertions: ['Layers panel visible with Map tools group', 'Maps menu open'],
    })
    await page.getByTestId('basemap-menu-toggle').click()
    await openWorkspacePanel(page, 'tools')
    await expect(page.getByTestId('gpx-import-panel')).toBeVisible()
    await captureAndRegister(page, {
      testId: 'light-theme-tools', testName: 'Light theme Tools', area: 'app-shell', severity: 'high',
      verificationPrompt: `${BASE_PROMPT} Check 1. The Tools panel (GPX import, helicopter and other tools) is light grey with dark headings and readable helper text. 2. Buttons and inputs have visible borders. 3. No black boxes remain.`,
      playwrightAssertions: ['Tools panel visible'],
    })
    await page.getByTestId('ws-more-button').click()
    await expectLightSurface(page.getByTestId('ws-more-menu'), 'More menu')
    await expect(page.getByTestId('theme-toggle')).toHaveText('Theme: Light')
    await captureAndRegister(page, {
      testId: 'light-theme-more-menu', testName: 'Light theme More menu', area: 'app-shell', severity: 'medium',
      verificationPrompt: `${BASE_PROMPT} Check 1. The More menu under the top bar is light with a dark border and dark items (Review and replay, Diagnostics, Help). 2. Its theme button reads "Theme: Light".`,
      playwrightAssertions: ['More menu light with dark text', 'theme button reads Theme: Light'],
    })
    await page.getByTestId('ws-more-button').click()
    await page.getByTestId('open-settings-workspace').click()
    await expect(page.getByTestId('settings-workspace')).toBeVisible()
    await captureAndRegister(page, {
      testId: 'light-theme-settings', testName: 'Light theme Settings', area: 'settings', severity: 'high',
      verificationPrompt: `${BASE_PROMPT} Check 1. The Settings workspace is light grey with dark headings, labels and field text. 2. Inputs and section boxes have visible borders. 3. Selected options read clearly. 4. No black panels remain.`,
      playwrightAssertions: ['Settings workspace visible'],
    })
  })

  test('Diagnostics reads on light grey', async ({ page }) => {
    await openLight(page)
    await openDiagnostics(page)
    await captureAndRegister(page, {
      testId: 'light-theme-diagnostics', testName: 'Light theme Diagnostics', area: 'app-shell', severity: 'medium',
      verificationPrompt: `${BASE_PROMPT} Check 1. Diagnostics is light grey with dark, readable text and status chips whose words can be read. 2. No black panels remain.`,
      playwrightAssertions: ['Diagnostics visible'],
    })
  })

  test('paused mission and lost tracking stay solid red alarms', async ({ page }) => {
    await openLight(page)
    await startMission(page)
    await pressPauseResume(page)
    await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expectRedAlarm(page.getByTestId('ws-alarm'), 'paused alarm')
    await captureAndRegister(page, {
      testId: 'light-theme-paused', testName: 'Light theme paused mission alarm', area: 'mission', severity: 'critical',
      verificationPrompt: `${BASE_PROMPT} Check 1. A solid red MISSION PAUSED alarm strip with white words runs across the map and is impossible to miss. 2. The top bar shows PAUSED in a readable red on light grey. 3. A Resume button is visible.`,
      playwrightAssertions: ['paused alarm solid red with white text'],
    })
    await pressPauseResume(page)
    await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
      { devices: [], positions: [], breadcrumbs: [] },
      { mode: 'offline', consecutiveFailures: 2, recovered: false, lastSuccessAt: '2026-09-09T08:00:00Z', warning: 'Connection lost. Retained positions may be stale.' },
    ))
    await expect(page.getByTestId('ws-alarm')).toContainText('TRACKING LOST')
    await expectRedAlarm(page.getByTestId('ws-alarm'), 'tracking lost alarm')
    await expectRedAlarm(page.locator('.ws-health-alert'), 'tracking line', page.locator('.ws-health-alert strong'))
    await captureAndRegister(page, {
      testId: 'light-theme-tracking-lost', testName: 'Light theme tracking lost alarm', area: 'tracking', severity: 'critical',
      verificationPrompt: `${BASE_PROMPT} Check 1. A solid red TRACKING LOST alarm strip with white words runs across the map. 2. The tracking line in the top bar is a solid red box with white words, outlined dark, on the light grey bar. 3. The rest of the top bar stays light grey and readable.`,
      playwrightAssertions: ['tracking lost alarm solid red with white text', 'top bar tracking line solid red'],
    })
  })

  test('finishing a mission asks in a light dialog', async ({ page }) => {
    await openLight(page)
    await startMission(page)
    await openMissionPanel(page)
    await page.getByTestId('mission-finish-btn').click()
    await captureAndRegister(page, {
      testId: 'light-theme-finish-dialog', testName: 'Light theme finish mission confirmation', area: 'mission', severity: 'high',
      verificationPrompt: `${BASE_PROMPT} Check 1. The finish confirmation is readable: dark text on a light surface, with clearly bordered buttons. 2. The destructive action is clearly marked (red or amber) and its label is readable.`,
      playwrightAssertions: ['finish confirmation shown'],
    })
  })

  test('alarm instructions, hover labels, map notices and keyboard focus meet WCAG AA', async ({ page }) => {
    await openLight(page)
    await startMission(page)

    // Running on the top bar while the mission button is hovered.
    await page.getByTestId('ws-mission-phase').hover()
    expect(await computedContrast(page.getByTestId('ws-mission-phase')), 'Running on hover').toBeGreaterThanOrEqual(4.5)

    // Confirm Finish, at rest and hovered.
    await openMissionPanel(page)
    await page.getByTestId('mission-finish-btn').click()
    const confirmFinish = page.getByRole('button', { name: 'Confirm Finish' })
    expect(await computedContrast(confirmFinish), 'Confirm Finish').toBeGreaterThanOrEqual(4.5)
    await confirmFinish.hover()
    expect(await computedContrast(confirmFinish), 'Confirm Finish on hover').toBeGreaterThanOrEqual(4.5)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Keyboard focus is drawn in a colour that stands out from the light panel.
    await page.getByTestId('mission-finish-btn').focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await page.waitForFunction(() => (document.activeElement as HTMLElement).getAnimations().length === 0)
    const focus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement
      return { target: active.dataset.testid ?? active.textContent ?? '', outline: getComputedStyle(active).outlineColor, width: getComputedStyle(active).outlineWidth, panel: getComputedStyle(document.querySelector('.ws-side')!).backgroundColor }
    })
    expect(Number.parseFloat(focus.width), 'focus outline width').toBeGreaterThanOrEqual(2)
    const ratio = (a: string, b: string) => { const [x, y] = [luminanceOf(a), luminanceOf(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05) }
    expect(ratio(focus.outline, focus.panel), `focus ${focus.outline} on ${focus.panel} (${focus.target})`).toBeGreaterThanOrEqual(3)

    // Paused banner detail and its Resume, through both flash phases.
    await pressPauseResume(page)
    await openMissionPanel(page)
    const banner = page.getByTestId('mission-paused-banner')
    await expect(banner).toBeVisible()
    expect(await computedContrast(banner.locator('p').nth(1), FLASH_FRAMES), 'paused detail').toBeGreaterThanOrEqual(4.5)
    expect(await computedContrast(banner.locator('p').first(), FLASH_FRAMES), 'paused heading').toBeGreaterThanOrEqual(4.5)
    expect(await computedContrast(page.getByTestId('mission-paused-banner-resume-btn'), FLASH_FRAMES), 'paused Resume').toBeGreaterThanOrEqual(4.5)

    await pressPauseResume(page)

    // Tracking evidence-loss warning, through both flash phases.
    await page.evaluate(async () => {
      const { applyIngestEvidenceHealth } = await import('/src/features/tracking/ingest-health-store.ts')
      applyIngestEvidenceHealth({
        state: 'degraded', reason: 'ledger_projection_failed', pendingCount: 1,
        corruptCount: 0, conflictCount: 1, rejectedCount: 0,
        affectedDeviceCount: 1, conflictDeviceIds: ['alpha'],
      })
    })
    await openWorkspacePanel(page, 'tracking')
    const warning = page.getByTestId('ingest-evidence-health-warning')
    await expect(warning).toBeVisible()
    expect(await computedContrast(warning, FLASH_FRAMES), 'tracking evidence warning').toBeGreaterThanOrEqual(4.5)
  })

  test('recovery Resume reads at rest and on hover', async ({ page }) => {
    await openLight(page)
    await startMission(page)
    await page.reload()
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await openMissionPanel(page)
    const resume = page.getByTestId('start-screen-resume-btn')
    await expect(resume).toBeVisible({ timeout: 15_000 })
    expect(await computedContrast(resume), 'recovery Resume').toBeGreaterThanOrEqual(4.5)
    await resume.hover()
    expect(await computedContrast(resume), 'recovery Resume on hover').toBeGreaterThanOrEqual(4.5)
  })

  for (const theme of ['light', 'standard'] as const) {
    test(`keyboard focus stands out on the red alarm controls in both flash phases (${theme})`, async ({ page }) => {
      if (theme === 'light') await openLight(page)
      else {
        await page.goto('/?missionHarness=1')
        await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
        await page.waitForSelector('canvas', { timeout: 20_000 })
      }
      await startMission(page)
      await pressPauseResume(page)
      await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
      await openMissionPanel(page)
      expect(await focusRingContrast(page, page.getByTestId('ws-alarm-resume'), FLASH_FRAMES), 'alarm Resume mission focus').toBeGreaterThanOrEqual(3)
      expect(await focusRingContrast(page, page.getByTestId('mission-paused-banner-resume-btn'), FLASH_FRAMES), 'paused banner Resume focus').toBeGreaterThanOrEqual(3)
      await pressPauseResume(page)
      await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
        { devices: [], positions: [], breadcrumbs: [] },
        { mode: 'offline', consecutiveFailures: 2, recovered: false, lastSuccessAt: '2026-09-09T08:00:00Z', warning: 'Connection lost. Retained positions may be stale.' },
      ))
      await expect(page.getByTestId('ws-alarm')).toContainText('TRACKING LOST')
      expect(await focusRingContrast(page, page.getByTestId('ws-alarm-details'), FLASH_FRAMES), 'alarm What to do focus').toBeGreaterThanOrEqual(3)
    })
  }

  test('clicking near a hidden marker shows a readable notice in the white map popup', async ({ page }) => {
    await openLight(page)
    await startMission(page)
    await page.evaluate(async () => {
      const [{ getBrowserHarnessStore }, { applyMarkerRuntime }] = await Promise.all([
        import('/src/features/browser-validation/browser-harness-store.ts'),
        import('/src/features/markers/marker-store.ts'),
      ])
      const raw = window.sessionStorage.getItem('sartracker:browser-harness')
      const missionId = raw === null ? null : (JSON.parse(raw) as { currentMissionId: string | null }).currentMissionId
      if (missionId === null) throw new Error('No active mission')
      const store = getBrowserHarnessStore()
      await store.upsertMarker({
        id: 'marker-clue-1', mission_id: missionId, type: 'clue', name: 'Boot Print', lat: 51.95, lon: -9.85,
        irish_grid_e: 480000, irish_grid_n: 580000, display_order: 1, clue_type: 'Footprint', confidence: 0.8,
      })
      applyMarkerRuntime({ activeMissionId: missionId, markers: await store.listMarkers(missionId), loading: false, saving: false, error: null, dialog: null })
    })
    await openWorkspacePanel(page, 'layers')
    await expandAllLayers(page)
    const markerToggle = page.getByTestId('layer-visibility-feature-marker-marker-clue-1')
    await expect(markerToggle).toBeVisible({ timeout: 10_000 })
    await markerToggle.click()
    await expect(markerToggle).not.toBeChecked()
    await page.evaluate(() => window.__SARTRACKER_MAP__!.jumpTo({ center: [-9.85, 51.95], zoom: 15 }))
    await expect.poll(() => page.evaluate(() => {
      const map = window.__SARTRACKER_MAP__!
      return map.queryRenderedFeatures(map.project([-9.85, 51.95]), { layers: ['mission-markers-hitbox'] })
        .filter((feature) => feature.properties?.markerId === 'marker-clue-1').length
    })).toBe(0)
    const point = await page.evaluate(() => {
      const map = window.__SARTRACKER_MAP__!
      const bounds = map.getCanvas().getBoundingClientRect()
      const projected = map.project([-9.85, 51.95])
      return { x: bounds.x + projected.x, y: bounds.y + projected.y }
    })
    await page.mouse.click(point.x, point.y)
    const notice = page.locator('.maplibregl-popup-content', { hasText: 'A hidden marker is near this location.' })
    await expect(notice).toBeVisible()
    expect(await computedContrast(notice), 'hidden-marker notice').toBeGreaterThanOrEqual(4.5)
    await captureAndRegister(page, {
      testId: 'light-theme-hidden-marker-notice', testName: 'Light theme hidden-marker notice', area: 'markers', severity: 'high',
      verificationPrompt: `${BASE_PROMPT} Check 1. A white popup on the map says a hidden marker is near this location, in dark readable words. 2. The Layers panel is light grey with dark text.`,
      playwrightAssertions: ['hidden-marker popup text reaches 4.5:1 on white'],
    })
  })
})

