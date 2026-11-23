// @vitest-environment jsdom
import React, { act, lazy } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/features/diagnostics/diagnostic-event-log', () => ({
  recordDiagnosticEvent: vi.fn(async () => undefined),
}))

import { LazyScreenBoundary } from '../../src/components/lazy-screen-boundary'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('a lazy screen that fails to load', () => {
  it('is replaced by a plain message while the rest of the app stays up', async () => {
    // As from a damaged or half-replaced install: the screen's code import rejects.
    const Missing = lazy(async () => { throw new Error('old-screen chunk is missing') })
    await act(async () => {
      root.render(
        React.createElement('div', null,
          React.createElement('header', { 'data-testid': 'rest-of-app' }),
          React.createElement(LazyScreenBoundary, { screen: 'Old screen test fixture' }, React.createElement(Missing)),
        ),
      )
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

    const failure = host.querySelector('[data-testid="lazy-screen-load-failure"]')
    expect(failure?.getAttribute('data-screen')).toBe('Old screen test fixture')
    expect(failure?.getAttribute('role')).toBe('alert')
    expect(failure?.textContent).toMatch(/could not be loaded/)
    expect(failure?.textContent).toMatch(/Restart SAR Tracker/)
    expect(failure?.textContent).toMatch(/old-screen chunk is missing/)
    expect(host.querySelector('[data-testid="rest-of-app"]')).not.toBeNull()
  })
})
