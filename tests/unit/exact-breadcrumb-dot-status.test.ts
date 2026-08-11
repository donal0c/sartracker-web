import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ExactBreadcrumbDotController,
  ExactBreadcrumbDotState,
} from '../../src/features/tracking/exact-breadcrumb-dot-controller'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

type ExactDotStatusProps = {
  readonly state:
    | {
        readonly status: 'ready'
        readonly totalPositionCount: number
        readonly pagePositionCount: number
        readonly fromTimestamp: string
        readonly toTimestamp: string
        readonly hasEarlier: boolean
        readonly hasLater: boolean
      }
    | { readonly status: 'unavailable'; readonly message: string }
  readonly onEarlier: () => void
  readonly onLater: () => void
}

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount())
  }
  host?.remove()
  root = null
  host = null
})

describe('ExactBreadcrumbDotStatus', () => {
  it('shows an explicit exact-page count/range with Earlier and Later controls', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    const onEarlier = vi.fn()
    const onLater = vi.fn()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: {
        status: 'ready',
        totalPositionCount: 10_001,
        pagePositionCount: 10_000,
        fromTimestamp: '2026-08-08T00:00:00.000Z',
        toTimestamp: '2026-08-09T12:00:00.000Z',
        hasEarlier: true,
        hasLater: false,
      },
      onEarlier,
      onLater,
    }))

    expect(getText('[data-testid="exact-breadcrumb-dot-page-summary"]')).toBe(
      'Showing 10,000 exact fixes of 10,001 — 2026-08-08T00:00:00.000Z to 2026-08-09T12:00:00.000Z',
    )
    const earlier = getButton('[data-testid="exact-breadcrumb-dots-earlier"]')
    const later = getButton('[data-testid="exact-breadcrumb-dots-later"]')
    expect(earlier.disabled).toBe(false)
    expect(later.disabled).toBe(true)
    click(earlier)
    expect(onEarlier).toHaveBeenCalledOnce()
    expect(onLater).not.toHaveBeenCalled()
  })

  it('shows exact-dot failure visibly without implying line representatives are dots', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: {
        status: 'unavailable',
        message: 'Exact breadcrumb dots are unavailable. No representative dots are shown.',
      },
      onEarlier: vi.fn(),
      onLater: vi.fn(),
    }))

    const alert = getElement('[data-testid="exact-breadcrumb-dots-unavailable"]')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Exact breadcrumb dots are unavailable')
    expect(alert.textContent).toContain('No representative dots are shown')
    expect(document.querySelector('[data-testid="exact-breadcrumb-dot-page-summary"]')).toBeNull()
  })

  it('honors an immediate operator Earlier click at the ready publication boundary', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    const controllerModule = await import(
      '../../src/features/tracking/exact-breadcrumb-dot-controller'
    )
    const latest = createControllerPage(
      createControllerPosition('latest', 100),
      { hasEarlier: true, earlierCursor: 'before-latest' },
    )
    const earlier = createControllerPage(
      createControllerPosition('earlier', 10),
      { hasLater: true, laterCursor: 'after-earlier' },
    )
    const queryPage = vi.fn((input: { readonly direction: string }) =>
      Promise.resolve(input.direction === 'earlier' ? earlier : latest),
    )
    const controllerReference: {
      current: ExactBreadcrumbDotController | null
    } = { current: null }
    let clickedEarlier = false
    const publish = (state: ExactBreadcrumbDotState): void => {
      if (
        state.status !== 'ready' ||
        state.fromTimestamp === null ||
        state.toTimestamp === null
      ) {
        return
      }
      const element = React.createElement(ExactBreadcrumbDotStatus, {
        state: {
          status: 'ready',
          totalPositionCount: state.totalPositionCount,
          pagePositionCount: state.pagePositionCount,
          fromTimestamp: state.fromTimestamp,
          toTimestamp: state.toTimestamp,
          hasEarlier: state.hasEarlier,
          hasLater: state.hasLater,
        },
        onEarlier: () => controllerReference.current?.showEarlier(),
        onLater: () => controllerReference.current?.showLater(),
      })
      if (root === null) {
        render(element)
      } else {
        act(() => root?.render(element))
      }
      if (!clickedEarlier && state.positions[0]?.id === 'latest') {
        clickedEarlier = true
        click(getButton('[data-testid="exact-breadcrumb-dots-earlier"]'))
      }
    }
    const controller = controllerModule.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish,
    })
    controllerReference.current = controller

    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: [],
    })

    await vi.waitFor(() => expect(queryPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        direction: 'earlier',
        cursor: 'before-latest',
      }),
    ))
    await vi.waitFor(() => expect(getText(
      '[data-testid="exact-breadcrumb-dot-page-summary"]',
    )).toContain(earlier.fromTimestamp))
    expect(queryPage).toHaveBeenCalledTimes(2)
  })
})

function createControllerPosition(
  id: string,
  ordinal: number,
): NormalizedTrackingPosition {
  return {
    id,
    device_id: 'device-1',
    lat: 52 + ordinal / 10_000_000,
    lon: -9.7 - ordinal / 10_000_000,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(Date.UTC(2026, 7, 8) + ordinal * 5_000).toISOString(),
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

function createControllerPage(
  position: NormalizedTrackingPosition,
  navigation: {
    readonly hasEarlier?: boolean
    readonly hasLater?: boolean
    readonly earlierCursor?: string
    readonly laterCursor?: string
  },
) {
  return {
    positions: [position],
    totalPositionCount: 2,
    pagePositionCount: 1,
    fromTimestamp: position.timestamp,
    toTimestamp: position.timestamp,
    hasEarlier: navigation.hasEarlier ?? false,
    hasLater: navigation.hasLater ?? false,
    earlierCursor: navigation.earlierCursor ?? null,
    laterCursor: navigation.laterCursor ?? null,
  }
}

async function loadStatusComponent(): Promise<React.ComponentType<ExactDotStatusProps>> {
  try {
    const modulePath = '../../src/components/exact-breadcrumb-dot-status'
    const module = await import(/* @vite-ignore */ modulePath)
    return module.ExactBreadcrumbDotStatus as React.ComponentType<ExactDotStatusProps>
  } catch (error) {
    throw new Error(
      'Exact dot paging requires a visible ExactBreadcrumbDotStatus component.',
      { cause: error },
    )
  }
}

function render(element: React.ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(element))
}

function getElement(selector: string): HTMLElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${selector} to exist.`)
  }
  return element
}

function getButton(selector: string): HTMLButtonElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${selector} to be a button.`)
  }
  return element
}

function getText(selector: string): string {
  return getElement(selector).textContent ?? ''
}

function click(element: HTMLElement): void {
  act(() => element.click())
}
