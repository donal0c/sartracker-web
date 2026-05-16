import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RuntimeBootGate } from '../../src/App'

describe('RuntimeBootGate', () => {
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

  it('shows a calm preparing state during runtime startup', () => {
    render(
      React.createElement(RuntimeBootGate, {
        phase: 'booting',
        error: null,
        onReload: vi.fn(),
      }),
    )

    expect(document.querySelector('[data-testid="runtime-booting-shell"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Preparing operational runtime')
    expect(document.body.textContent).toContain('Loading mission, tracking, and map services...')
  })

  it('shows the startup fault and reload action when boot fails', () => {
    const onReload = vi.fn()

    render(
      React.createElement(RuntimeBootGate, {
        phase: 'failed',
        error: 'SQLite mission store unavailable.',
        onReload,
      }),
    )

    const button = document.querySelector('button')
    expect(document.querySelector('[data-testid="runtime-failed-shell"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Runtime startup failed')
    expect(document.body.textContent).toContain('SQLite mission store unavailable.')
    button?.click()
    expect(onReload).toHaveBeenCalledTimes(1)
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
