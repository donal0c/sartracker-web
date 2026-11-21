import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ExactBreadcrumbDotController,
  ExactBreadcrumbDotState,
} from '../../src/features/tracking/exact-breadcrumb-dot-controller'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'
import {
  summarizeTrailDrawing,
  type TrailDrawingSummary,
} from '../../src/features/tracking/trail-line-visibility'

/** What the renderers would draw, from the same inputs they use. */
function drawing(input: {
  readonly trailsVisible?: boolean
  readonly hidden?: readonly string[]
  readonly line?: readonly string[]
  readonly dot?: readonly string[]
} = {}): TrailDrawingSummary {
  const line = input.line ?? ['device-1']
  return summarizeTrailDrawing({
    trailsVisible: input.trailsVisible ?? true,
    hiddenBreadcrumbDeviceIds: input.hidden ?? [],
    lineDeviceIds: new Set(line),
    // By default the exact page holds fixes from the same devices as the line.
    dotDeviceIds: new Set(input.dot ?? line),
  })
}

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
  readonly timeZone?: string
  readonly trailDrawing: TrailDrawingSummary
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
  it('shows canonical fix times as explicit local operator time with offset [DON-267] [SAR-QA-021]', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    const onEarlier = vi.fn()
    const onLater = vi.fn()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: {
        status: 'ready',
        totalPositionCount: 10_001,
        pagePositionCount: 10_000,
        fromTimestamp: '2026-08-22T15:10:17.000Z',
        toTimestamp: '2026-08-22T15:10:17.000Z',
        hasEarlier: true,
        hasLater: false,
      },
      onEarlier,
      onLater,
      trailDrawing: drawing(),
      timeZone: 'Europe/Dublin',
    }))

    expect(getText('[data-testid="exact-breadcrumb-dot-page-summary"]')).toBe(
      'Exact fix inspection — showing 10,000 of 10,001 — 22/08/2026, 16:10:17 GMT+01:00 (Europe/Dublin)',
    )
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toBe(
      'The line on the map shows the whole trail. The dots mark 10,000 of 10,001 exact recorded fixes, at 22/08/2026, 16:10:17 GMT+01:00 (Europe/Dublin). Use Earlier and Later to move through the rest.',
    )
    const earlier = getButton('[data-testid="exact-breadcrumb-dots-earlier"]')
    const later = getButton('[data-testid="exact-breadcrumb-dots-later"]')
    expect(earlier.disabled).toBe(false)
    expect(later.disabled).toBe(true)
    click(earlier)
    expect(onEarlier).toHaveBeenCalledOnce()
    expect(onLater).not.toHaveBeenCalled()
  })

  it('shows exact-dot failure visibly, says the line still shows the whole trail, and never implies line representatives are dots', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: {
        status: 'unavailable',
        message: 'Exact breadcrumb dots are unavailable: the recorded fixes could not be loaded. Simplified points are never shown as dots.',
      },
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      trailDrawing: drawing(),
    }))

    const alert = getElement('[data-testid="exact-breadcrumb-dots-unavailable"]')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Exact breadcrumb dots are unavailable')
    expect(alert.textContent).toContain('Simplified points are never shown as dots')
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toBe(
      'The line on the map shows the whole trail. No dots are drawn until the exact fixes load.',
    )
    expect(document.querySelector('[data-testid="exact-breadcrumb-dot-page-summary"]')).toBeNull()
  })

  it('says the line shows the whole trail while the exact page loads [DON-338]', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: { status: 'loading', missionId: 'mission-a' } as never,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      trailDrawing: drawing(),
    }))

    expect(getElement('[data-testid="exact-breadcrumb-dots-loading"]').getAttribute('role')).toBe('status')
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toBe(
      'The line on the map shows the whole trail. Loading exact recorded fixes to mark as dots…',
    )
  })

  it('states the page, total and time range in plain words for a trail longer than one page [DON-338]', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: {
        status: 'ready',
        totalPositionCount: 25_123,
        pagePositionCount: 10_000,
        fromTimestamp: '2026-08-08T09:00:00.000Z',
        toTimestamp: '2026-08-08T17:20:00.000Z',
        hasEarlier: true,
        hasLater: true,
      },
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      trailDrawing: drawing(),
      timeZone: 'Europe/Dublin',
    }))

    const note = getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
    expect(note).toBe(
      'The line on the map shows the whole trail. The dots mark 10,000 of 25,123 exact recorded fixes, from 08/08/2026, 10:00:00 GMT+01:00 (Europe/Dublin) to 08/08/2026, 18:20:00 GMT+01:00 (Europe/Dublin). Use Earlier and Later to move through the rest.',
    )
    expect(note).not.toMatch(/dots (show|are) the (whole|full) trail/iu)
    expect(getButton('[data-testid="exact-breadcrumb-dots-earlier"]').disabled).toBe(false)
    expect(getButton('[data-testid="exact-breadcrumb-dots-later"]').disabled).toBe(false)
  })

  it('says every exact fix is marked when one page holds them all', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: {
        status: 'ready',
        totalPositionCount: 1_234,
        pagePositionCount: 1_234,
        fromTimestamp: '2026-08-08T09:00:00.000Z',
        toTimestamp: '2026-08-08T10:00:00.000Z',
        hasEarlier: false,
        hasLater: false,
      },
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      trailDrawing: drawing(),
      timeZone: 'Europe/Dublin',
    }))

    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toBe(
      'The line on the map shows the whole trail. The dots mark all 1,234 exact recorded fixes, from 08/08/2026, 10:00:00 GMT+01:00 (Europe/Dublin) to 08/08/2026, 11:00:00 GMT+01:00 (Europe/Dublin).',
    )
  })

  it('warns that hidden trails are counted but not drawn [LIV-2]', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    const state = {
      status: 'ready' as const,
      totalPositionCount: 20_000,
      pagePositionCount: 10_000,
      fromTimestamp: '2026-08-08T09:00:00.000Z',
      toTimestamp: '2026-08-08T10:00:00.000Z',
      hasEarlier: true,
      hasLater: false,
    }
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      trailDrawing: drawing({ line: ['a', 'b', 'c'], hidden: ['a', 'b'] }),
    }))
    expect(getText('[data-testid="exact-breadcrumb-dots-hidden-trails"]')).toBe(
      '2 devices have their trails hidden on the Layers tab. Their fixes are counted here but their lines and dots are not drawn.',
    )

    act(() => root?.render(React.createElement(ExactBreadcrumbDotStatus, {
      state,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      trailDrawing: drawing({ line: ['a', 'b', 'c'] }),
    })))
    expect(document.querySelector('[data-testid="exact-breadcrumb-dots-hidden-trails"]')).toBeNull()
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
        trailDrawing: drawing(),
        timeZone: 'Europe/Dublin',
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
    )).toBe(
      'Exact fix inspection — showing 1 of 2 — 08/08/2026, 01:00:50 GMT+01:00 (Europe/Dublin)',
    ))
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

describe('ExactBreadcrumbDotStatus trail visibility [DON-338]', () => {
  const PAGED_READY = {
    status: 'ready' as const,
    totalPositionCount: 20_000,
    pagePositionCount: 10_000,
    fromTimestamp: '2026-08-08T09:00:00.000Z',
    toTimestamp: '2026-08-08T10:00:00.000Z',
    hasEarlier: true,
    hasLater: false,
  }
  const RANGE = 'from 08/08/2026, 10:00:00 GMT+01:00 (Europe/Dublin) to 08/08/2026, 11:00:00 GMT+01:00 (Europe/Dublin)'
  const UNAVAILABLE = {
    status: 'unavailable' as const,
    message: 'Exact breadcrumb dots are unavailable: the recorded fixes could not be loaded. Simplified points are never shown as dots.',
  }
  const LOADING = { status: 'loading', missionId: 'mission-a' } as never

  it('never says the line or dots are on the map when Trails are switched off, in any page state', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: PAGED_READY,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      timeZone: 'Europe/Dublin',
      trailDrawing: drawing({ trailsVisible: false }),
    }))
    const readyNote = getElement('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
    expect(readyNote.getAttribute('data-trail-line')).toBe('off')
    expect(readyNote.textContent).toBe(
      `Trails are switched off on the Layers tab, so no trail line or dots are drawn on the map. This page holds 10,000 of 20,000 exact recorded fixes, ${RANGE}. None are drawn while trails are not shown. Use Earlier and Later to move through the rest.`,
    )
    expect(getText('[data-testid="exact-breadcrumb-dot-page-summary"]')).toBe(
      `Exact fix inspection — showing 10,000 of 20,000 — 08/08/2026, 10:00:00 GMT+01:00 (Europe/Dublin) to 08/08/2026, 11:00:00 GMT+01:00 (Europe/Dublin)`,
    )

    for (const state of [LOADING, UNAVAILABLE, { ...PAGED_READY, totalPositionCount: 0, pagePositionCount: 0, hasEarlier: false }]) {
      act(() => root?.render(React.createElement(ExactBreadcrumbDotStatus, {
        state,
        onEarlier: vi.fn(),
        onLater: vi.fn(),
        timeZone: 'Europe/Dublin',
        trailDrawing: drawing({ trailsVisible: false }),
      })))
      const note = getElement('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
      expect(note.getAttribute('data-trail-line')).toBe('off')
      expect(note.textContent).toMatch(/^Trails are switched off on the Layers tab, so no trail line or dots are drawn on the map\./u)
      expect(note.textContent).not.toContain('shows the whole trail')
      expect(note.textContent).not.toContain('The dots mark')
      expect(note.textContent).not.toContain('to mark as dots')
    }
  })

  it('says no line is drawn when every device has its trail hidden', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: PAGED_READY,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      timeZone: 'Europe/Dublin',
      trailDrawing: drawing({ line: ['a', 'b', 'c'], hidden: ['a', 'b', 'c'] }),
    }))
    const note = getElement('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
    expect(note.getAttribute('data-trail-line')).toBe('off')
    expect(note.textContent).toBe(
      `Every device has its trail hidden on the Layers tab, so no trail line or dots are drawn on the map. This page holds 10,000 of 20,000 exact recorded fixes, ${RANGE}. None are drawn while trails are not shown. Use Earlier and Later to move through the rest.`,
    )
  })

  it('separates fixes loaded from fixes drawn and shows the hidden-trail notice in every page state', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: PAGED_READY,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      timeZone: 'Europe/Dublin',
      trailDrawing: drawing({ line: ['a', 'b', 'c'], hidden: ['a'] }),
    }))
    const readyNote = getElement('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
    expect(readyNote.getAttribute('data-trail-line')).toBe('partly-hidden')
    expect(readyNote.textContent).toBe(
      `The line on the map shows the whole trail of each device whose trail is shown. This page holds 10,000 of 20,000 exact recorded fixes, ${RANGE}. Dots are drawn only for devices whose trail is shown. Use Earlier and Later to move through the rest.`,
    )

    for (const state of [LOADING, UNAVAILABLE]) {
      act(() => root?.render(React.createElement(ExactBreadcrumbDotStatus, {
        state,
        onEarlier: vi.fn(),
        onLater: vi.fn(),
        trailDrawing: drawing({ line: ['a', 'b', 'c'], hidden: ['a'] }),
      })))
      expect(getText('[data-testid="exact-breadcrumb-dots-hidden-trails"]')).toBe(
        '1 device has its trail hidden on the Layers tab. Its fixes are counted here but its line and dots are not drawn.',
      )
      expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toMatch(
        /^The line on the map shows the whole trail of each device whose trail is shown\./u,
      )
    }
  })

  it('never claims a trail line when there is no trail geometry yet, in any page state', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    const empty = drawing({ line: [], dot: [] })
    const states = [
      LOADING,
      UNAVAILABLE,
      { ...PAGED_READY, totalPositionCount: 0, pagePositionCount: 0, hasEarlier: false },
    ]
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: states[0]!,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      trailDrawing: empty,
    }))
    for (const state of states) {
      act(() => root?.render(React.createElement(ExactBreadcrumbDotStatus, {
        state,
        onEarlier: vi.fn(),
        onLater: vi.fn(),
        trailDrawing: empty,
      })))
      const note = getElement('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
      expect(note.getAttribute('data-trail-line')).toBe('none')
      expect(note.textContent).toMatch(/^No trail line is on the map yet\./u)
      expect(note.textContent).not.toContain('shows the whole trail')
    }
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toBe(
      'No trail line is on the map yet. There are no exact recorded fixes to mark as dots yet.',
    )
  })

  it('judges hidden trails by the devices that have trail geometry, not by the roster', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    // Device A is on the roster with no fixes; device B has history but no roster entry.
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: PAGED_READY,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      timeZone: 'Europe/Dublin',
      trailDrawing: drawing({ line: ['B'], dot: ['B'], hidden: ['A'] }),
    }))
    const note = getElement('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
    expect(note.getAttribute('data-trail-line')).toBe('drawn')
    expect(note.textContent).toMatch(/^The line on the map shows the whole trail\. The dots mark 10,000 of 20,000/u)
    expect(document.querySelector('[data-testid="exact-breadcrumb-dots-hidden-trails"]')).toBeNull()

    act(() => root?.render(React.createElement(ExactBreadcrumbDotStatus, {
      state: PAGED_READY,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      timeZone: 'Europe/Dublin',
      trailDrawing: drawing({ line: ['B'], dot: ['B'], hidden: ['A', 'B'] }),
    })))
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toMatch(
      /^Every device has its trail hidden on the Layers tab, so no trail line or dots are drawn on the map\./u,
    )
  })

  it('keeps the plain wording when every trail is drawn', async () => {
    const ExactBreadcrumbDotStatus = await loadStatusComponent()
    render(React.createElement(ExactBreadcrumbDotStatus, {
      state: PAGED_READY,
      onEarlier: vi.fn(),
      onLater: vi.fn(),
      trailDrawing: drawing({ line: ['a', 'b', 'c'] }),
    }))
    expect(getElement('[data-testid="exact-breadcrumb-dots-whole-trail-note"]').getAttribute('data-trail-line')).toBe('drawn')
    expect(document.querySelector('[data-testid="exact-breadcrumb-dots-hidden-trails"]')).toBeNull()
  })
})

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
