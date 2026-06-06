import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkerDialog } from '../../src/components/marker-dialog'
import { createMarkerDraftAtCoordinate } from '../../src/features/markers/marker-draft'
import { useMarkerStore } from '../../src/features/markers/marker-store'
import type { MarkerRuntimeController } from '../../src/features/markers/start-marker-runtime'

describe('MarkerDialog two-stage delete confirmation', () => {
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
    useMarkerStore.setState(useMarkerStore.getInitialState())
  })

  it('does not delete on first click — shows confirmation instead', () => {
    const controller = renderEditMarker()

    click('[data-testid="marker-delete-btn"]')

    expect(controller.deleteEditingMarker).not.toHaveBeenCalled()
    expect(query('[data-testid="marker-delete-confirmation"]')).not.toBeNull()
  })

  it('deletes on confirmation click after the first stage', () => {
    const controller = renderEditMarker()

    click('[data-testid="marker-delete-btn"]')
    click('[data-testid="marker-delete-confirm-btn"]')

    expect(controller.deleteEditingMarker).toHaveBeenCalledTimes(1)
  })

  it('cancels deletion when Keep is clicked', () => {
    const controller = renderEditMarker()

    click('[data-testid="marker-delete-btn"]')
    expect(query('[data-testid="marker-delete-confirmation"]')).not.toBeNull()

    click('[data-testid="marker-delete-keep-btn"]')

    expect(controller.deleteEditingMarker).not.toHaveBeenCalled()
    expect(query('[data-testid="marker-delete-confirmation"]')).toBeNull()
  })

  it('shows the marker type in the confirmation message', () => {
    renderEditMarker('casualty')

    click('[data-testid="marker-delete-btn"]')

    const confirmation = query('[data-testid="marker-delete-confirmation"]')
    expect(confirmation?.textContent).toContain('casualty')
  })

  function renderEditMarker(type: 'ipp_lkp' | 'clue' | 'hazard' | 'casualty' = 'hazard'): MarkerRuntimeController {
    const controller = createController()
    useMarkerStore.setState({
      controller,
      dialog: {
        mode: 'edit',
        draft: {
          ...createMarkerDraftAtCoordinate(52.0, -9.5, type),
          id: 'marker-existing-1',
          name: 'Test Marker',
          condition: type === 'casualty' ? 'Injured - Conscious' : '',
          evacuationPriority: type === 'casualty' ? 'Urgent' : '',
        },
      },
    })
    render(React.createElement(MarkerDialog))
    return controller
  }

  function render(element: React.ReactElement): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(element)
    })
  }
})

function createController(): MarkerRuntimeController {
  return {
    refreshMission: vi.fn().mockResolvedValue(undefined),
    beginCreateAt: vi.fn(),
    beginEdit: vi.fn(),
    updateDraft: vi.fn(),
    changeDraftType: vi.fn(),
    attachEvidence: vi.fn(),
    clearAttachment: vi.fn(),
    closeDialog: vi.fn(),
    saveDraft: vi.fn(),
    deleteEditingMarker: vi.fn().mockResolvedValue(true),
  }
}

function query(selector: string): Element | null {
  return document.querySelector(selector)
}

function click(selector: string): void {
  const element = query(selector)
  if (element === null) {
    throw new Error(`Element not found: ${selector}`)
  }
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${selector} to be an HTMLElement.`)
  }
  act(() => element.click())
}
