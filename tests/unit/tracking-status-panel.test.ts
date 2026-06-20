import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { TrackingStatusPanel } from '../../src/components/tracking-status-panel'
import { useDeviceWorkspaceStore } from '../../src/features/tracking/device-workspace-store'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'

let root: Root | null = null
let host: HTMLDivElement | null = null

describe('TrackingStatusPanel', () => {
  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    useTrackingStore.setState(useTrackingStore.getInitialState())
    useDeviceWorkspaceStore.setState(useDeviceWorkspaceStore.getInitialState())
  })

  it('renders offline tracking mode and OFFLINE MODE warning as a flashing red alert', () => {
    useTrackingStore.setState({
      status: {
        mode: 'offline',
        consecutiveFailures: 2,
        recovered: false,
        lastSuccessAt: '2026-04-10T12:00:00.000Z',
        warning: 'OFFLINE MODE - showing last known positions.',
      },
    })

    render(React.createElement(TrackingStatusPanel))

    expect(getElement('[data-testid="tracking-mode-chip"]').className).toContain(
      'sar-status-chip-alert',
    )
    expect(getElement('[data-testid="tracking-warning"]').className).toContain(
      'sar-status-alert-panel',
    )
    expect(getText('[data-testid="tracking-warning"]')).toContain('OFFLINE MODE')
  })

  it('renders paused live-refresh suspension as a flashing red alert even while mode is idle', () => {
    useTrackingStore.setState({
      status: {
        mode: 'idle',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: null,
        warning: 'Live refresh suspended while mission is paused.',
      },
    })

    render(React.createElement(TrackingStatusPanel))

    expect(getElement('[data-testid="tracking-mode-chip"]').className).toContain(
      'sar-status-chip-alert',
    )
    expect(getElement('[data-testid="tracking-warning"]').className).toContain(
      'sar-status-alert-panel',
    )
    expect(getText('[data-testid="tracking-warning"]')).toContain('Live refresh suspended')
  })
})

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

function getText(selector: string): string {
  return getElement(selector).textContent ?? ''
}
