import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDrawingStore } from '../../src/features/drawings/drawing-store'
import { useMeasurementStore } from '../../src/features/measurements/measurement-store'
import { useMissionStore } from '../../src/features/mission/mission-store'

/**
 * DON-72: the visible Map Tools list must not offer a "Select" button, while
 * the internal select mode remains the default/fallback after tools complete
 * or cancel (so editing existing drawings still works).
 */

describe('DrawingToolbar', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    useDrawingStore.setState({
      controller: { setActiveTool: vi.fn(), cancelActiveTool: vi.fn() } as never,
      activeTool: 'select',
      dialog: null,
    })
    useMeasurementStore.setState({ controller: null as never, mode: 'idle' as never })
    useMissionStore.setState({
      currentMission: { id: 'mission-1' } as never,
      phase: 'active' as never,
    })
  })

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    vi.clearAllMocks()
    useDrawingStore.setState(useDrawingStore.getInitialState())
    useMeasurementStore.setState(useMeasurementStore.getInitialState())
    useMissionStore.setState(useMissionStore.getInitialState())
  })

  it('does not render a Select button in the expanded Map Tools list', async () => {
    const { DrawingToolbar } = await import('../../src/components/drawing-toolbar')
    render(React.createElement(DrawingToolbar))

    click('[data-testid="drawing-toolbar-expand"]')

    expect(document.querySelector('[data-testid="drawing-tool-select"]')).toBeNull()
    expect(document.querySelector('[data-testid="drawing-tool-line"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="drawing-tool-range_ring"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="drawing-tool-search_sector"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="drawing-tool-text_label"]')).not.toBeNull()
  })

  it('still shows Select as the active-mode chip when select mode is the fallback', async () => {
    const { DrawingToolbar } = await import('../../src/components/drawing-toolbar')
    useDrawingStore.setState({ activeTool: 'select' })

    render(React.createElement(DrawingToolbar))

    const chip = document.querySelector('[data-testid="drawing-toolbar-active-mode"]')
    expect(chip?.textContent).toContain('Select')
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

function click(selector: string): void {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${selector} to be an HTML element.`)
  }
  act(() => {
    element.click()
  })
}
