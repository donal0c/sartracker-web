import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'
import { useMapTargetStore } from '../../src/features/map/map-target-store'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { useActiveMissionDevicesStore } from '../../src/features/tracking/active-mission-devices-store'
import { useDeviceWorkspaceStore } from '../../src/features/tracking/device-workspace-store'
import { useTrackingStyleStore } from '../../src/features/tracking/tracking-style-store'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'
import type {
  TrackingConnectionStatus,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

vi.mock('../../src/features/runtime/app-runtime-controller', () => ({
  getAppRuntimeController: vi.fn(() => null),
}))

const SNAPSHOT: TrackingSnapshot = {
  devices: [
    {
      device_id: 'alpha',
      name: 'Alpha Team',
      status: 'online',
      last_seen: '2026-04-10T17:00:00.000Z',
      unique_id: null,
      category: null,
    },
    {
      device_id: 'bravo',
      name: 'Bravo Team',
      status: 'offline',
      last_seen: '2026-04-10T16:40:00.000Z',
      unique_id: null,
      category: null,
    },
  ],
  positions: [
    {
      id: 'pos-alpha',
      device_id: 'alpha',
      lat: 51.99917,
      lon: -9.74406,
      altitude: null,
      speed: 3.5,
      battery: 82,
      accuracy: null,
      timestamp: '2026-04-10T17:00:00.000Z',
      source: 'osmand',
      data_origin: 'live',
      cache_age_seconds: null,
      device_cache_stale: false,
    },
    {
      id: 'pos-bravo',
      device_id: 'bravo',
      lat: 52.05944,
      lon: -9.50722,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp: '2026-04-10T16:40:00.000Z',
      source: 'osmand',
      data_origin: 'cache',
      cache_age_seconds: 1200,
      device_cache_stale: true,
    },
  ],
  breadcrumbs: [],
}

const STATUS: TrackingConnectionStatus = {
  mode: 'offline',
  consecutiveFailures: 1,
  recovered: false,
  lastSuccessAt: '2026-04-10T17:00:00.000Z',
  warning: 'OFFLINE MODE - showing last known positions.',
}

describe('DevicesWorkspace', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    vi.clearAllMocks()
    useDeviceWorkspaceStore.setState(useDeviceWorkspaceStore.getInitialState())
    useTrackingStore.setState(useTrackingStore.getInitialState())
    useActiveMissionDevicesStore.setState(useActiveMissionDevicesStore.getInitialState())
    useTrackingStyleStore.setState(useTrackingStyleStore.getInitialState())
    useMissionStore.setState(useMissionStore.getInitialState())
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    useMapTargetStore.setState(useMapTargetStore.getInitialState())
  })

  it('does not select a different device when passive status, time, or source cells are clicked', async () => {
    const { DevicesWorkspace } = await import('../../src/components/devices-workspace')
    useTrackingStore.setState({ snapshot: SNAPSHOT, status: STATUS })
    useDeviceWorkspaceStore.setState({ open: true, selectedDeviceId: 'alpha' })

    render(React.createElement(DevicesWorkspace))
    await waitForElement('[data-testid="devices-workspace"]')
    expect(getText('[data-testid="devices-inspector-title"]')).toContain('Alpha Team')
    expect(getElement('[data-testid="device-row-alpha"]').className).toContain('sar-selected-row')

    click('[data-testid="device-status-bravo"]')
    click('[data-testid="device-last-seen-bravo"]')
    click('[data-testid="device-source-bravo"]')

    expect(useDeviceWorkspaceStore.getState().selectedDeviceId).toBe('alpha')
    expect(getText('[data-testid="devices-inspector-title"]')).toContain('Alpha Team')
  })

  it('adds and removes mission-active devices while keeping the full roster visible', async () => {
    const { DevicesWorkspace } = await import('../../src/components/devices-workspace')
    useTrackingStore.setState({ snapshot: SNAPSHOT, status: STATUS })
    useMissionStore.setState({
      currentMission: {
        id: 'mission-1',
        name: 'Devices Mission',
        status: 'active',
        start_time: '2026-04-10T17:00:00.000Z',
        pause_time: null,
        finish_time: null,
        paused_seconds: 0,
        notes: null,
        schema_version: 1,
      },
      phase: 'active',
    })
    useDeviceWorkspaceStore.setState({ open: true, selectedDeviceId: 'alpha' })

    render(React.createElement(DevicesWorkspace))
    await waitForElement('[data-testid="devices-workspace"]')

    expect(getText('[data-testid="active-devices-empty-state"]')).toContain(
      'No active mission devices selected',
    )
    expect(document.querySelector('[data-testid="device-row-alpha"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="device-row-bravo"]')).not.toBeNull()

    click('[data-testid="device-active-toggle-bravo"]')

    expect(useActiveMissionDevicesStore.getState().getActiveDeviceIds('mission-1')).toEqual([
      'bravo',
    ])
    expect(getText('[data-testid="active-device-row-bravo"]')).toContain('Bravo Team')
    expect(document.querySelector('[data-testid="device-row-alpha"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="device-row-bravo"]')).not.toBeNull()

    click('[data-testid="active-device-remove-bravo"]')

    expect(useActiveMissionDevicesStore.getState().getActiveDeviceIds('mission-1')).toEqual([])
    expect(getText('[data-testid="active-devices-empty-state"]')).toContain(
      'No active mission devices selected',
    )
  })

  it('updates per-device breadcrumb colour via palette swatch and global breadcrumb size', async () => {
    const { DevicesWorkspace } = await import('../../src/components/devices-workspace')
    useTrackingStore.setState({ snapshot: SNAPSHOT, status: STATUS })
    useDeviceWorkspaceStore.setState({ open: true, selectedDeviceId: 'alpha' })

    render(React.createElement(DevicesWorkspace))
    await waitForElement('[data-testid="devices-workspace"]')

    click('[data-testid="device-breadcrumb-color-alpha"]')
    await waitForElement('[data-testid="device-color-popover-alpha"]')
    click('[data-testid="device-color-option-FF7A00"]')

    changeInput('[data-testid="breadcrumb-size-control"]', '7')

    expect(useTrackingStyleStore.getState().deviceColors.alpha).toBe('#FF7A00')
    expect(useTrackingStyleStore.getState().breadcrumbSize).toBe(7)
  })

  function render(element: React.ReactElement): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(element)
    })
  }
})

async function waitForElement(selector: string): Promise<Element> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const element = document.querySelector(selector)
    if (element !== null) {
      return element
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Timed out waiting for ${selector}.`)
}

function click(selector: string): void {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${selector} to be an HTML element.`)
  }
  act(() => element.click())
}

function changeInput(selector: string, value: string): void {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected ${selector} to be an input element.`)
  }

  act(() => {
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function getText(selector: string): string {
  return getElement(selector).textContent ?? ''
}

function getElement(selector: string): Element {
  const element = document.querySelector(selector)
  if (element === null) {
    throw new Error(`Expected ${selector} to exist.`)
  }
  return element
}
