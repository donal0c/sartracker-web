import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDrawingStore } from '../../src/features/drawings/drawing-store'
import type {
  LineDrawingDraft,
  SearchAreaDrawingDraft,
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
