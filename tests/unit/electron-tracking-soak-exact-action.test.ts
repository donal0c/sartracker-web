import { describe, expect, it, vi } from 'vitest'

import {
  clickExactDotPageControl,
  readExactDotPageControlDisabled,
} from '../../build/electron-tracking-soak-exact-action-lib.js'

type ControlObservation = {
  readonly bbox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly intercept: {
    readonly tag: string
    readonly testId: string | null
    readonly className: string
  } | null
}

function createControlHarness(input: {
  readonly observations: readonly ControlObservation[]
  readonly clickError?: Error
  readonly clickNeverSettles?: boolean
  readonly disabled?: boolean
  readonly evaluateNeverSettles?: boolean
  readonly isDisabledNeverSettles?: boolean
}) {
  const evaluate = input.evaluateNeverSettles === true
    ? vi.fn().mockReturnValue(new Promise(() => undefined))
    : vi.fn()
  if (input.evaluateNeverSettles !== true) {
    for (const observation of input.observations) {
      evaluate.mockResolvedValueOnce(observation)
    }
  }
  const click = input.clickNeverSettles === true
    ? vi.fn().mockReturnValue(new Promise(() => undefined))
    : input.clickError === undefined
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(input.clickError)
  const isDisabled = input.isDisabledNeverSettles === true
    ? vi.fn().mockReturnValue(new Promise(() => undefined))
    : vi.fn().mockResolvedValue(input.disabled ?? false)
  const locator = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    isDisabled,
    evaluate,
    click,
  }
  return {
    page: { getByTestId: vi.fn().mockReturnValue(locator) },
    locator,
  }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 250) {
  const timeout = Symbol('timeout')
  const result = await Promise.race([
    promise,
    new Promise<typeof timeout>((resolve) => {
      setTimeout(() => resolve(timeout), timeoutMs)
    }),
  ])
  expect(result).not.toBe(timeout)
  return result as T
}

describe('packaged exact-dot page action safety [DON-260]', () => {
  it('requires an unobstructed ordinary click to advance beyond a covered latest page', async () => {
    const harness = createControlHarness({ observations: [] })
    let workspaceOverlayOpen = true
    let pageIndexFromLatest = 0
    harness.locator.click.mockImplementation(async (options?: { force?: boolean }) => {
      if (options?.force === true) return
      if (workspaceOverlayOpen) throw new Error('covered by Devices workspace')
      pageIndexFromLatest = 1
    })

    await harness.locator.click({ force: true })
    expect(pageIndexFromLatest).toBe(0)

    workspaceOverlayOpen = false
    await clickExactDotPageControl({
      page: harness.page,
      testId: 'exact-breadcrumb-dots-earlier',
      pageIndexFromLatest: 1,
      timeoutMs: 5_000,
    })

    expect(pageIndexFromLatest).toBe(1)
    expect(harness.locator.click).toHaveBeenLastCalledWith({ timeout: 5_000 })
  })

  it('lets an ordinary Playwright click settle a transiently obstructed preflight', async () => {
    const harness = createControlHarness({
      observations: [{
        bbox: { x: 1_094, y: 774, width: 80, height: 28 },
        intercept: {
          tag: 'ASIDE',
          testId: 'devices-inspector',
          className: 'fixed inset-y-0 right-0',
        },
      }],
    })

    await expect(clickExactDotPageControl({
      page: harness.page,
      testId: 'exact-breadcrumb-dots-earlier',
      pageIndexFromLatest: 1,
      timeoutMs: 5_000,
    })).resolves.toBeUndefined()

    expect(harness.locator.click).toHaveBeenCalledWith({ timeout: 5_000 })
    expect(harness.locator.click).not.toHaveBeenCalledWith(
      expect.objectContaining({ force: true }),
    )
  })

  it('fails a persistently obstructed normal click with bounded sanitized first/last evidence', async () => {
    const persistentObservation = {
      bbox: { x: 1_094.12345, y: 774, width: 79.6796875, height: 27.875 },
      intercept: {
        tag: 'ASIDE',
        testId: 'devices-inspector',
        className: 'fixed inset-y-0 right-0 pointer-events-auto',
      },
    }
    const harness = createControlHarness({
      observations: [persistentObservation, persistentObservation],
      clickError: new Error(
        'raw provider failure for device Alpha at 52.123456,-9.123456',
      ),
    })

    let thrown: unknown
    try {
      await clickExactDotPageControl({
        page: harness.page,
        testId: 'exact-breadcrumb-dots-later',
        pageIndexFromLatest: 17,
        timeoutMs: 5_000,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      'Exact breadcrumb page control did not become actionable.',
    )
    expect((thrown as Error & { exactDotActionFailure?: unknown }).exactDotActionFailure)
      .toEqual({
        action: 'later',
        pageIndexFromLatest: 17,
        failureClass: 'click_timeout_or_interception',
        first: {
          bbox: { x: 1_094.123, y: 774, width: 79.68, height: 27.875 },
          intercept: {
            tag: 'aside',
            testId: 'devices-inspector',
            className: 'fixed inset-y-0 right-0 pointer-events-auto',
          },
        },
        last: {
          bbox: { x: 1_094.123, y: 774, width: 79.68, height: 27.875 },
          intercept: {
            tag: 'aside',
            testId: 'devices-inspector',
            className: 'fixed inset-y-0 right-0 pointer-events-auto',
          },
        },
      })
    expect(JSON.stringify(thrown)).not.toMatch(
      /Alpha|52\.123456|-9\.123456|provider failure/iu,
    )
  })

  it('does not let a never-resolving evidence sample delay or reclassify the click failure', async () => {
    const harness = createControlHarness({
      observations: [],
      evaluateNeverSettles: true,
      clickError: new Error('raw click failure that must not escape'),
    })

    const thrown = await settleWithin(
      clickExactDotPageControl({
        page: harness.page,
        testId: 'exact-breadcrumb-dots-earlier',
        pageIndexFromLatest: 3,
        timeoutMs: 25,
      }).catch((error: unknown) => error),
    ) as Error & { exactDotActionFailure?: {
      readonly failureClass?: string
      readonly first?: unknown
      readonly last?: unknown
    } }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.exactDotActionFailure).toMatchObject({
      failureClass: 'click_timeout_or_interception',
      first: null,
      last: null,
    })
    expect(harness.locator.click).toHaveBeenCalledWith({ timeout: 25 })
    expect(JSON.stringify(thrown)).not.toContain('raw click failure')
  })

  it('does not call a never-resolving manual enabled-state preflight', async () => {
    const harness = createControlHarness({
      observations: [],
      evaluateNeverSettles: true,
      isDisabledNeverSettles: true,
    })

    await settleWithin(clickExactDotPageControl({
      page: harness.page,
      testId: 'exact-breadcrumb-dots-later',
      pageIndexFromLatest: 2,
      timeoutMs: 25,
    }))

    expect(harness.locator.click).toHaveBeenCalledWith({ timeout: 25 })
    expect(harness.locator.isDisabled).not.toHaveBeenCalled()
  })

  it('applies an absolute deadline when the ordinary Playwright click never settles', async () => {
    const harness = createControlHarness({
      observations: [],
      evaluateNeverSettles: true,
      clickNeverSettles: true,
    })

    const thrown = await settleWithin(
      clickExactDotPageControl({
        page: harness.page,
        testId: 'exact-breadcrumb-dots-earlier',
        pageIndexFromLatest: 4,
        timeoutMs: 25,
      }).catch((error: unknown) => error),
    ) as Error & { exactDotActionFailure?: { readonly failureClass?: string } }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.exactDotActionFailure?.failureClass).toBe(
      'click_timeout_or_interception',
    )
  })

  it('bounds the explicit oldest/latest disabled-state terminal gate', async () => {
    const disabled = createControlHarness({ observations: [], disabled: true })
    await expect(readExactDotPageControlDisabled({
      page: disabled.page,
      testId: 'exact-breadcrumb-dots-earlier',
      timeoutMs: 25,
    })).resolves.toBe(true)

    const stuck = createControlHarness({
      observations: [],
      isDisabledNeverSettles: true,
    })
    const thrown = await settleWithin(
      readExactDotPageControlDisabled({
        page: stuck.page,
        testId: 'exact-breadcrumb-dots-later',
        timeoutMs: 25,
      }).catch((error: unknown) => error),
    )
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      'Exact breadcrumb terminal page-control state was unavailable.',
    )
  })
})
