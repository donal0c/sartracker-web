import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MarkerDialog } from '../../src/components/marker-dialog'
import { MarkerStatusBanner } from '../../src/components/marker-status-banner'
import { useMarkerStore } from '../../src/features/markers/marker-store'
import { casualtyDraft, createMarkerDialogRuntime } from './marker-dialog-runtime-fixture'

describe('marker status banner [DON-348 M-68]', () => {
  let host: HTMLDivElement
  let root: Root
  let runtime: Awaited<ReturnType<typeof createMarkerDialogRuntime>>

  beforeEach(async () => {
    runtime = await createMarkerDialogRuntime()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root.render(React.createElement(React.Fragment, null,
      React.createElement(MarkerStatusBanner), React.createElement(MarkerDialog))))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useMarkerStore.setState(useMarkerStore.getInitialState())
  })

  it('shows a failed mission load, retries the real store and clears on success', async () => {
    runtime.listMarkers.mockRejectedValueOnce(new Error('marker database unavailable'))
    await act(async () => runtime.controller.refreshMission('mission-1'))

    expect(banner()?.getAttribute('role')).toBe('alert')
    expect(banner()?.textContent).toContain('marker database unavailable')
    expect(banner()?.textContent).toMatch(/may be incomplete/i)
    expect(runtime.recordDiagnosticEvent).toHaveBeenCalledWith({
      level: 'error', category: 'marker', event: 'marker_load_failed',
    })
    const callsBeforeRetry = runtime.listMarkers.mock.calls.length

    await act(async () => click('marker-status-retry-btn'))

    expect(runtime.listMarkers).toHaveBeenCalledTimes(callsBeforeRetry + 1)
    expect(runtime.listMarkers).toHaveBeenLastCalledWith('mission-1')
    expect(banner()).toBeNull()
  })

  it('retains an unseen load failure across opening and closing a marker', async () => {
    runtime.listMarkers.mockRejectedValueOnce(new Error('load failed'))
    await act(async () => runtime.controller.refreshMission('mission-1'))
    act(() => runtime.controller.beginCreateFromDraft(casualtyDraft()))
    expect(banner()).toBeNull()

    act(() => runtime.controller.closeDialog())

    expect(banner()?.textContent).toContain('load failed')
  })

  it('shows a rejected placement with no open dialog and lets the operator dismiss it', () => {
    act(() => runtime.controller.beginCreateAt(0, 0))

    expect(useMarkerStore.getState().dialog).toBeNull()
    expect(banner()?.getAttribute('role')).toBe('alert')
    expect(banner()?.textContent).toContain(useMarkerStore.getState().error)
    expect(banner()?.textContent).toMatch(/could not be placed/i)
    expect(runtime.recordDiagnosticEvent).toHaveBeenCalledWith({
      level: 'error', category: 'marker', event: 'marker_create_begin_failed',
    })
    expect(host.querySelector('[data-testid="marker-status-retry-btn"]')).toBeNull()

    click('marker-status-dismiss-btn')
    expect(banner()).toBeNull()
  })

  it('dismisses only the action error when a load failure also exists', async () => {
    runtime.listMarkers.mockRejectedValueOnce(new Error('load failed'))
    await act(async () => runtime.controller.refreshMission('mission-1'))
    act(() => runtime.controller.beginEdit('missing-marker'))

    expect(runtime.recordDiagnosticEvent).toHaveBeenCalledWith({
      level: 'error', category: 'marker', event: 'marker_edit_begin_failed',
    })
    click('marker-status-dismiss-btn')

    expect(useMarkerStore.getState().error).toBeNull()
    expect(banner()?.textContent).toContain('load failed')
    expect(host.querySelector('[data-testid="marker-status-retry-btn"]')).not.toBeNull()
  })

  /** Finds the always-mounted component's conditional alert. */
  function banner(): Element | null {
    return host.querySelector('[data-testid="marker-status-banner"]')
  }

  /** Activates a rendered banner action. */
  function click(testId: string): void {
    const button = host.querySelector(`[data-testid="${testId}"]`)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${testId}`)
    act(() => button.click())
  }
})
