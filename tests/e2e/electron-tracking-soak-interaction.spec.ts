import { expect, test } from '@playwright/test'

import { clickActionablePointerTarget } from '../../build/electron-tracking-soak-lib.js'

test.describe('packaged tracking soak operator interaction [DON-262]', () => {
  test('re-resolves a trusted click target after the panel moves', async ({ page }) => {
    await page.setContent(`
      <button
        data-testid="stale-location"
        style="position: absolute; left: 20px; top: 20px; width: 160px; height: 40px"
        type="button"
      >
        Stale location
      </button>
      <button
        data-testid="moving-target"
        style="position: absolute; left: 20px; top: 20px; width: 160px; height: 40px"
        type="button"
      >
        Moving target
      </button>
      <script>
        window.clicks = { stale: 0, target: 0, targetTrusted: false }
        document.querySelector('[data-testid="stale-location"]').addEventListener('click', () => {
          window.clicks.stale += 1
        })
        document.querySelector('[data-testid="moving-target"]').addEventListener('click', (event) => {
          window.clicks.target += 1
          window.clicks.targetTrusted = event.isTrusted
        })
      </script>
    `)

    const preflight = {
      documentFocused: true,
      targetFound: true,
      targetReceivesPointer: true,
      centerPoint: { x: 100, y: 40 },
    }
    await page.getByTestId('moving-target').evaluate((target) => {
      target.style.top = '220px'
    })

    await clickActionablePointerTarget({
      page,
      preflight,
      testId: 'moving-target',
      timeoutMs: 2_000,
    })

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                clicks: {
                  stale: number
                  target: number
                  targetTrusted: boolean
                }
              }
            ).clicks,
        ),
      )
      .toEqual({ stale: 0, target: 1, targetTrusted: true })
  })

  test('does not retry onto the control restored after the target unmounts', async ({
    page,
  }) => {
    await page.setContent(`
      <button data-testid="restored-target" type="button">Restored target</button>
      <button data-testid="unmounting-target" type="button">Close</button>
      <script>
        window.clicks = { restored: 0, close: 0 }
        const restored = document.querySelector('[data-testid="restored-target"]')
        const close = document.querySelector('[data-testid="unmounting-target"]')
        restored.addEventListener('click', () => {
          window.clicks.restored += 1
        })
        close.addEventListener('click', () => {
          window.clicks.close += 1
          close.remove()
          restored.focus()
        })
      </script>
    `)

    const preflight = {
      documentFocused: true,
      targetFound: true,
      targetReceivesPointer: true,
      centerPoint: { x: 0, y: 0 },
    }
    await clickActionablePointerTarget({
      page,
      preflight,
      testId: 'unmounting-target',
      timeoutMs: 2_000,
      stableDurationMs: 150,
    })
    await page.waitForTimeout(250)

    expect(
      await page.evaluate(
        () =>
          (
            window as Window & {
              clicks: { restored: number; close: number }
            }
          ).clicks,
      ),
    ).toEqual({ restored: 0, close: 1 })
  })

  test('waits through active layout movement before dispatching input', async ({
    page,
  }) => {
    await page.setContent(`
      <button
        data-testid="moving-target"
        style="position: absolute; left: 20px; top: 20px; width: 160px; height: 40px"
        type="button"
      >
        Moving target
      </button>
      <script>
        window.motionEvidence = {
          clickCount: 0,
          clickTrusted: false,
          stableForMsBeforeClick: null,
          lastMoveAt: performance.now(),
        }
        const target = document.querySelector('[data-testid="moving-target"]')
        let movementCount = 0
        const movement = window.setInterval(() => {
          movementCount += 1
          target.style.top = movementCount % 2 === 0 ? '20px' : '220px'
          window.motionEvidence.lastMoveAt = performance.now()
          if (movementCount >= 8) {
            window.clearInterval(movement)
          }
        }, 20)
        target.addEventListener('click', (event) => {
          window.motionEvidence.clickCount += 1
          window.motionEvidence.clickTrusted = event.isTrusted
          window.motionEvidence.stableForMsBeforeClick =
            performance.now() - window.motionEvidence.lastMoveAt
        })
      </script>
    `)

    await clickActionablePointerTarget({
      page,
      preflight: {
        documentFocused: true,
        targetFound: true,
        targetReceivesPointer: true,
        centerPoint: { x: 100, y: 40 },
      },
      testId: 'moving-target',
      timeoutMs: 2_000,
      stableDurationMs: 150,
    })

    const evidence = await page.evaluate(
      () =>
        (
          window as Window & {
            motionEvidence: {
              clickCount: number
              clickTrusted: boolean
              stableForMsBeforeClick: number
            }
          }
        ).motionEvidence,
    )
    expect(evidence.clickCount).toBe(1)
    expect(evidence.clickTrusted).toBe(true)
    expect(evidence.stableForMsBeforeClick).toBeGreaterThanOrEqual(140)
  })
})
