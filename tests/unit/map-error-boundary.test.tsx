import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { MapErrorBoundary } from '../../src/components/map-error-boundary'

const fake = vi.hoisted(() => ({ recordDiagnosticEvent: vi.fn<(event: unknown) => Promise<void>>(async () => undefined) }))
vi.mock('../../src/features/diagnostics/diagnostic-event-log', () => ({ recordDiagnosticEvent: fake.recordDiagnosticEvent }))

let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.(); vi.restoreAllMocks() })

/** Throws during render, like a map failure that escapes its own handling. */
function BrokenMap(): React.ReactElement {
  throw new Error('style worker crashed')
}

it('keeps the shell and shows the map failure instead of a blank window [DON-288]', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }

  await act(async () => root.render(<div><p>shell</p><MapErrorBoundary><BrokenMap /></MapErrorBoundary></div>))

  expect(host.textContent).toContain('shell')
  const panel = host.querySelector('[data-testid="map-error-boundary"]')
  expect(panel?.getAttribute('role')).toBe('alert')
  expect(panel?.textContent).toContain('The map stopped working')
  expect(panel?.textContent).toContain('style worker crashed')
  expect(fake.recordDiagnosticEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'map_view_crashed' }))
})
