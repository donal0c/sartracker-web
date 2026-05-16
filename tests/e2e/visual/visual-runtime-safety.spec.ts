/**
 * Visual verification tests for runtime boot, startup fault, and autosave
 * warning surfaces that operators must notice before trusting the app.
 */
import { expect, test } from '@playwright/test'
import { navigateToHarness, startMission } from './helpers/test-setup'
import {
  captureAndRegister,
  captureElementAndRegister,
} from './helpers/verification-manifest'

test.describe('Visual: Runtime safety states', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page)
  })

  test('booting shell blocks the app while runtime services prepare', async ({ page }) => {
    await page.evaluate(async () => {
      const { useRuntimeBootStore } = await import(
        '/src/features/runtime/runtime-boot-store.ts'
      )
      useRuntimeBootStore.setState({
        phase: 'booting',
        error: null,
        generation: 200,
      })
    })

    await expect(page.getByTestId('runtime-booting-shell')).toBeVisible()
    await expect(page.getByRole('status')).toContainText(
      'Loading mission, tracking, and map services...',
    )
    await expect(page.getByTestId('app-shell')).toHaveCount(0)

    await captureAndRegister(page, {
      testId: 'runtime-booting-shell',
      testName: 'Runtime booting shell',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker while runtime services are preparing:
1. The normal map and mission controls should not be visible or interactable
2. The screen should clearly identify SAR Tracker
3. The primary message should say "Preparing operational runtime"
4. The supporting status should say that mission, tracking, and map services are loading
5. The state should look calm and intentional, not like a blank or broken app
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'runtime-booting-shell is visible',
        'status role contains service loading copy',
        'app-shell is absent while booting',
      ],
    })
  })

  test('startup fault shell makes the failure and clean reload action obvious', async ({ page }) => {
    await page.evaluate(async () => {
      const { useRuntimeBootStore } = await import(
        '/src/features/runtime/runtime-boot-store.ts'
      )
      useRuntimeBootStore.setState({
        phase: 'failed',
        error: 'Injected startup fault for visual verification.',
        generation: 201,
      })
    })

    await expect(page.getByTestId('runtime-failed-shell')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(
      'Injected startup fault for visual verification.',
    )
    await expect(page.getByRole('button', { name: 'Reload clean runtime' })).toBeFocused()
    await expect(page.getByTestId('app-shell')).toHaveCount(0)

    await captureAndRegister(page, {
      testId: 'runtime-failed-shell',
      testName: 'Runtime startup fault shell',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker after runtime startup fails:
1. The normal map and mission controls should not be visible or interactable
2. The panel should be clearly labeled "Startup fault"
3. The main heading should say "Runtime startup failed"
4. The injected fault detail should be visible in a readable block
5. The guidance should tell operators to copy or screenshot the fault message
6. The "Reload clean runtime" action should be prominent
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'runtime-failed-shell is visible',
        'alert contains injected startup fault',
        'reload clean runtime button is focused',
        'app-shell is absent while failed',
      ],
    })
  })

  test('autosave stale warning chip remains visible in the command mast', async ({ page }) => {
    await startMission(page, 'Visual Autosave Stale')
    await page.evaluate(async () => {
      const { useAutosaveStatusStore } = await import(
        '/src/features/persistence/autosave-status-store.ts'
      )
      useAutosaveStatusStore.getState().configure({
        enabled: true,
        intervalMs: 5_000,
        now: new Date('2026-05-16T09:00:00.000Z'),
      })
      useAutosaveStatusStore.getState().markSyncSucceeded({
        reason: 'interval',
        backupPath: '/tmp/mission-store.backup.sqlite',
        now: new Date('2026-05-16T09:00:01.000Z'),
      })
      useAutosaveStatusStore.getState().markObservedElapsed({ elapsedMs: 11_000 })
    })

    const warning = page.getByTestId('autosave-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('Autosave warning')
    await expect(warning).toHaveAttribute('title', /Autosave stale:/)
    await expect(warning).toHaveAttribute('aria-label', /Autosave stale:/)
    await expect(warning).toHaveAttribute('role', 'status')

    await captureElementAndRegister(page, 'command-mast', {
      testId: 'runtime-autosave-stale-mast',
      testName: 'Autosave stale warning in command mast',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker command mast with a stale autosave warning:
1. The mission should be active and named "Visual Autosave Stale"
2. The System Status area should remain visible in the mast
3. An amber "Autosave warning" chip should be visible in the System Status area
4. The warning should not be hidden behind menus, clipped out of the mast, or visually lost
5. The warning should read as cautionary, not as a green operational-ready state
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'autosave-warning is visible',
        'autosave-warning title contains Autosave stale',
        'autosave-warning aria-label contains Autosave stale',
        'autosave-warning role is status',
      ],
    })
  })

  test('autosave failure remains visible in focus mode with lifecycle alert detail', async ({ page }) => {
    await startMission(page, 'Visual Autosave Failure')
    await page.evaluate(async () => {
      const { useAutosaveStatusStore } = await import(
        '/src/features/persistence/autosave-status-store.ts'
      )
      useAutosaveStatusStore.getState().markSyncFailed({
        reason: 'mission-finish',
        message: 'backup volume unavailable',
        now: new Date('2026-05-16T09:00:00.000Z'),
      })
    })
    await page.getByTestId('focus-mode-toggle').click()

    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-focus-mode', 'true')
    await expect(page.getByTestId('focus-autosave-warning')).toContainText(
      'Autosave failing: backup volume unavailable',
    )
    await expect(page.getByTestId('lifecycle-backup-failure-banner')).toContainText(
      'Lifecycle backup failed',
    )
    await expect(page.getByTestId('lifecycle-backup-failure-banner')).toContainText(
      'backup volume unavailable',
    )

    await captureAndRegister(page, {
      testId: 'runtime-autosave-failure-focus',
      testName: 'Autosave failure visible in focus mode',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker Focus Mode with a lifecycle autosave failure:
1. Focus Mode should be active with the reduced sidebar and dominant map still visible
2. The amber safety banner should include the specific autosave failure message "backup volume unavailable"
3. A stronger lifecycle backup failed alert should be visible below the browser testing note
4. The alert should explain that the mission state change saved but the safety backup did not complete
5. The alert should not have a dismiss button
6. The warning should remain obvious even though the normal command mast is hidden in Focus Mode
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'app-shell data-focus-mode is true',
        'focus-autosave-warning contains the injected autosave failure',
        'lifecycle-backup-failure-banner contains Lifecycle backup failed',
        'lifecycle-backup-failure-banner contains backup volume unavailable',
      ],
    })
  })
})
