import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDrawingStore } from '../../src/features/drawings/drawing-store'
import type {
  LineDrawingDraft,
  SearchAreaDrawingDraft,
  SearchSectorDrawingDraft,
} from '../../src/features/drawings/drawing-types'

/**
 * DON-72: operator-facing Line and Search Area dialogs must not show a
 * "Vertices" readout — coordinators do not need that value.
 */

const LINE_DRAFT: LineDrawingDraft = {
  id: null,
  type: 'line',
  name: 'Test Line',
  description: '',
  points: [
    [-9.7, 52.0],
    [-9.69, 52.01],
    [-9.68, 52.02],
  ],
}

const SEARCH_AREA_DRAFT: SearchAreaDrawingDraft = {
  id: null,
  type: 'search_area',
  name: 'Test Area',
  description: '',
  points: [
    [-9.7, 52.0],
    [-9.69, 52.0],
    [-9.69, 52.01],
  ],
  team: '',
  status: 'Planned',
  poaPercent: '',
  labelFontSize: '12',
  fillColor: '#F59E0B',
  terrain: '',
  notes: '',
}

const SEARCH_SECTOR_DRAFT: SearchSectorDrawingDraft = {
  id: null,
  type: 'search_sector',
  name: '',
  description: '',
  center: [-9.7, 52],
  startBearing: '0',
  endBearing: '90',
  radiusM: '1000',
}

describe('DrawingDialog vertices readout', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    useDrawingStore.setState({
      controller: {
        closeDialog: vi.fn(),
        updateDraft: vi.fn(),
        saveDialog: vi.fn(),
        deleteSelectedDrawing: vi.fn(),
      } as never,
      saving: false,
      error: null,
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
  })

  it('does not render a Vertices readout for line drawings', async () => {
    useDrawingStore.setState({ dialog: { mode: 'create', draft: LINE_DRAFT } })
    await renderDialog()

    expect(document.body.textContent).not.toContain('Vertices')
    // The useful readouts remain.
    expect(document.querySelector('[data-testid="drawing-line-distance-readout"]')).not.toBeNull()
  })

  it('does not render a Vertices readout for search area drawings', async () => {
    useDrawingStore.setState({ dialog: { mode: 'create', draft: SEARCH_AREA_DRAFT } })
    await renderDialog()

    expect(document.body.textContent).not.toContain('Vertices')
  })

  it('preserves search sector details when the radius control is used', async () => {
    const updateDraft = vi.fn((nextDraft: SearchSectorDrawingDraft) => {
      useDrawingStore.setState({
        dialog: {
          mode: 'create',
          draft: nextDraft,
        },
      })
    })
    useDrawingStore.setState({
      controller: {
        closeDialog: vi.fn(),
        updateDraft,
        saveDialog: vi.fn(),
        deleteSelectedDrawing: vi.fn(),
      } as never,
      dialog: { mode: 'create', draft: SEARCH_SECTOR_DRAFT },
    })
    await renderDialog()

    setInputValue('[data-testid="drawing-name-input"]', 'Sector North')
    setInputValue('[data-testid="drawing-sector-start-input"]', '350')
    setInputValue('[data-testid="drawing-sector-end-input"]', '20')
    setInputValue('[data-testid="drawing-sector-radius-input"]', '1500')

    expect(getInput('[data-testid="drawing-name-input"]').value).toBe('Sector North')
    expect(getInput('[data-testid="drawing-sector-start-input"]').value).toBe('350')
    expect(getInput('[data-testid="drawing-sector-end-input"]').value).toBe('20')
    expect(getInput('[data-testid="drawing-sector-radius-input"]').value).toBe('1500')
  })

  async function renderDialog(): Promise<void> {
    const { DrawingDialog } = await import('../../src/components/drawing-dialog')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(React.createElement(DrawingDialog))
    })
  }
})

function setInputValue(selector: string, value: string): void {
  const input = getInput(selector)
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function getInput(selector: string): HTMLInputElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected ${selector} to be an input.`)
  }

  return element
}
