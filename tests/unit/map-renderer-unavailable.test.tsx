import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { MapRendererUnavailable } from '../../src/components/map-renderer-unavailable'
import { describeRendererFailure } from '../../src/features/map/describe-renderer-failure'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  Reflect.deleteProperty(window, 'sartrackerElectron')
})

/** Renders the panel with an optional Electron bridge. */
async function mount(bridge?: Record<string, unknown>) {
  if (bridge !== undefined) Object.defineProperty(window, 'sartrackerElectron', { configurable: true, value: bridge })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(<MapRendererUnavailable reason="Failed to initialize WebGL" />))
  await act(async () => undefined)
  return host
}

it('explains the failure and offers the operator a software-rendering restart [DON-288]', async () => {
  const restartWithSoftwareRendering = vi.fn(async () => undefined)
  const host = await mount({
    readGpuRenderingState: async () => ({ softwareRendering: false, problem: null }),
    restartWithSoftwareRendering,
  })

  const panel = host.querySelector('[data-testid="map-renderer-unavailable"]')
  expect(panel?.getAttribute('role')).toBe('alert')
  expect(panel?.textContent).toContain('The map cannot be shown')
  expect(panel?.textContent).toContain('Tracking, devices and mission records still work')
  const button = host.querySelector<HTMLButtonElement>('[data-testid="restart-with-software-rendering"]')
  expect(button?.textContent).toBe('Restart with software rendering')

  await act(async () => button?.click())
  expect(restartWithSoftwareRendering).toHaveBeenCalledOnce()
})

it('does not offer the restart again when software rendering is already on [DON-288]', async () => {
  const host = await mount({
    readGpuRenderingState: async () => ({ softwareRendering: true, problem: null }),
    restartWithSoftwareRendering: vi.fn(),
  })

  expect(host.querySelector('[data-testid="restart-with-software-rendering"]')).toBeNull()
  expect(host.textContent).toContain('Software rendering is already on')
})

it('shows a restart failure instead of hiding it [DON-288]', async () => {
  const host = await mount({
    readGpuRenderingState: async () => ({ softwareRendering: false, problem: null }),
    restartWithSoftwareRendering: async () => { throw new Error('disk full') },
  })

  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="restart-with-software-rendering"]')?.click())

  expect(host.textContent).toContain('Could not restart with software rendering: disk full')
})

it('names the cause outside the desktop app, without a restart button [DON-288]', async () => {
  const host = await mount()

  expect(host.querySelector('[data-testid="restart-with-software-rendering"]')).toBeNull()
  expect(host.textContent).toContain('Failed to initialize WebGL')
})

it('reduces the MapLibre WebGL error object to readable text [DON-288]', () => {
  const raw = JSON.stringify({ requestedAttributes: { alpha: true }, statusMessage: 'Disabled by command line switch', type: 'webglcontextcreationerror', message: 'Failed to initialize WebGL' })
  expect(describeRendererFailure(raw)).toBe('Failed to initialize WebGL (Disabled by command line switch)')
  expect(describeRendererFailure('plain failure')).toBe('plain failure')
})

it('reports a restart that did not happen and allows another try [DON-288]', async () => {
  vi.useFakeTimers()
  try {
    const host = await mount({
      readGpuRenderingState: async () => ({ softwareRendering: false, problem: null }),
      // Main accepted the request, but shutdown was refused and the app stayed open.
      restartWithSoftwareRendering: async () => undefined,
    })
    const button = () => host.querySelector<HTMLButtonElement>('[data-testid="restart-with-software-rendering"]')
    await act(async () => button()?.click())
    expect(button()?.disabled).toBe(true)

    await act(async () => { vi.advanceTimersByTime(60_000) })

    expect(host.textContent).toContain('SAR Tracker did not restart')
    expect(button()?.disabled).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})
