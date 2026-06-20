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

  it('does not derive device rows from tracking updates while the workspace is closed [DON-213]', async () => {
    const model = await import('../../src/features/tracking/device-workspace-model')
    const buildRows = vi.spyOn(model, 'buildDeviceWorkspaceRows')
    const { DevicesWorkspace } = await import('../../src/components/devices-workspace')

    useDeviceWorkspaceStore.setState({ open: false })
    render(React.createElement(DevicesWorkspace))

    act(() => {
      useTrackingStore.setState({ snapshot: SNAPSHOT, status: STATUS })
    })

    expect(buildRows).not.toHaveBeenCalled()
  })

  it('selects a device when non-control status, time, or source cells are clicked', async () => {
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

    expect(useDeviceWorkspaceStore.getState().selectedDeviceId).toBe('bravo')
    expect(getText('[data-testid="devices-inspector-title"]')).toContain('Bravo Team')
  })

  it('adds and removes mission-active devices via filter tabs', async () => {
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

    expect(document.querySelector('[data-testid="device-row-alpha"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="device-row-bravo"]')).not.toBeNull()

    click('[data-testid="device-active-toggle-bravo"]')

    expect(useActiveMissionDevicesStore.getState().getActiveDeviceIds('mission-1')).toEqual([
      'bravo',
    ])

    click('[data-testid="device-filter-active"]')

    expect(document.querySelector('[data-testid="device-row-bravo"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="device-row-alpha"]')).toBeNull()

    click('[data-testid="device-active-toggle-bravo"]')

    expect(useActiveMissionDevicesStore.getState().getActiveDeviceIds('mission-1')).toEqual([])
    expect(getText('[data-testid="device-filter-empty-state"]')).toContain(
      'No active mission devices selected',
    )
  })

  it('keeps selected device and search scoped to the active filter list', async () => {
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
    useActiveMissionDevicesStore.getState().setDeviceActive('mission-1', 'bravo', true)
    useDeviceWorkspaceStore.setState({ open: true, selectedDeviceId: 'alpha' })

    render(React.createElement(DevicesWorkspace))
    await waitForElement('[data-testid="devices-workspace"]')

    click('[data-testid="device-filter-active"]')

    expect(useDeviceWorkspaceStore.getState().selectedDeviceId).toBe('bravo')
    expect(getText('[data-testid="devices-inspector-title"]')).toContain('Bravo Team')
    expect(document.querySelector('[data-testid="device-row-alpha"]')).toBeNull()

    changeInput('[data-testid="device-list-search"]', 'Alpha')

    expect(document.querySelector('[data-testid="device-row-alpha"]')).toBeNull()
    expect(document.querySelector('[data-testid="device-row-bravo"]')).toBeNull()
    expect(getText('[data-testid="device-filter-empty-state"]')).toContain(
      'No devices match Alpha in Active',
    )
    expect(useDeviceWorkspaceStore.getState().selectedDeviceId).toBeNull()
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

  it('sets the global trail mode and makes the size control label match that mode', async () => {
    const { DevicesWorkspace } = await import('../../src/components/devices-workspace')
    useTrackingStore.setState({ snapshot: SNAPSHOT, status: STATUS })
    useDeviceWorkspaceStore.setState({ open: true, selectedDeviceId: 'alpha' })

    render(React.createElement(DevicesWorkspace))
    await waitForElement('[data-testid="devices-workspace"]')

    expect(getText('[data-testid="breadcrumb-size-label"]')).toContain('trail width')

    click('[data-testid="breadcrumb-mode-dots"]')

    expect(useTrackingStyleStore.getState().breadcrumbTrailMode).toBe('dots')
    expect(getText('[data-testid="breadcrumb-size-label"]')).toContain('dot diameter')

    click('[data-testid="breadcrumb-mode-line"]')

    expect(useTrackingStyleStore.getState().breadcrumbTrailMode).toBe('line')
    expect(getText('[data-testid="breadcrumb-size-label"]')).toContain('trail width')
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
