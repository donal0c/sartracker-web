import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkerDialog } from '../../src/components/marker-dialog'
import { createMarkerDraftAtCoordinate } from '../../src/features/markers/marker-draft'
import { useMarkerStore } from '../../src/features/markers/marker-store'
import type { MarkerRuntimeController } from '../../src/features/markers/start-marker-runtime'

describe('MarkerDialog casualty required-field validation', () => {
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

  it('disables Save when casualty condition is empty', () => {
    renderCasualtyDialog({ name: 'Subject A', condition: '', evacuationPriority: 'Urgent' })

    const saveBtn = query('[data-testid="marker-save-btn"]') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })

  it('disables Save when casualty evacuation priority is empty', () => {
    renderCasualtyDialog({ name: 'Subject A', condition: 'Injured - Conscious', evacuationPriority: '' })

    const saveBtn = query('[data-testid="marker-save-btn"]') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })

  it('disables Save when casualty name is empty', () => {
    renderCasualtyDialog({ name: '', condition: 'Injured - Conscious', evacuationPriority: 'Urgent' })

    const saveBtn = query('[data-testid="marker-save-btn"]') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })

  it('enables Save when all required casualty fields are filled', () => {
    renderCasualtyDialog({ name: 'Subject A', condition: 'Injured - Conscious', evacuationPriority: 'Urgent' })

    const saveBtn = query('[data-testid="marker-save-btn"]') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(false)
  })

  it('shows a validation error message when casualty fields are missing', () => {
    renderCasualtyDialog({ name: '', condition: '', evacuationPriority: '' })

    const errorMsg = query('[data-testid="marker-casualty-validation-error"]')
    expect(errorMsg).not.toBeNull()
    expect(errorMsg?.textContent).toContain('Name, Condition, and Evacuation Priority')
  })

  it('does not show validation error for non-casualty markers with empty fields', () => {
    const controller = createController()
    useMarkerStore.setState({
      controller,
      dialog: {
        mode: 'create',
        draft: {
          ...createMarkerDraftAtCoordinate(52.0, -9.5, 'hazard'),
          name: '',
          condition: '',
          evacuationPriority: '',
        },
      },
    })
    render(React.createElement(MarkerDialog))

    const errorMsg = query('[data-testid="marker-casualty-validation-error"]')
    expect(errorMsg).toBeNull()
  })

  it('marks condition field with aria-invalid when empty on casualty', () => {
    renderCasualtyDialog({ name: 'Subject A', condition: '', evacuationPriority: 'Urgent' })

    const conditionSelect = query('[data-testid="marker-condition-input"]')
    expect(conditionSelect?.getAttribute('aria-invalid')).toBe('true')
  })

  function renderCasualtyDialog(fields: { name: string; condition: string; evacuationPriority: string }): void {
    const controller = createController()
    useMarkerStore.setState({
      controller,
      dialog: {
        mode: 'create',
        draft: {
          ...createMarkerDraftAtCoordinate(52.0, -9.5, 'casualty'),
          ...fields,
        },
      },
    })
    render(React.createElement(MarkerDialog))
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
    deleteEditingMarker: vi.fn(),
  }
}

function query(selector: string): Element | null {
  return document.querySelector(selector)
}
