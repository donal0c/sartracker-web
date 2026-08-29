import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkerDialog } from '../../src/components/marker-dialog'
import { createMarkerDraftAtCoordinate } from '../../src/features/markers/marker-draft'
import { useMarkerStore } from '../../src/features/markers/marker-store'
import type { MarkerRuntimeController } from '../../src/features/markers/start-marker-runtime'

describe('MarkerDialog casualty treatment log', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    vi.useRealTimers()
    vi.clearAllMocks()
    useMarkerStore.setState(useMarkerStore.getInitialState())
  })

  it('appends treatment updates while preserving earlier treatment notes', () => {
    vi.useFakeTimers()
    // Local-time components so the rendered prefix (which uses local time, as
    // operators expect) is "10:15" in any timezone the test runs in.
    vi.setSystemTime(new Date(2026, 5, 2, 10, 15, 0))
    const controller = createController()
    useMarkerStore.setState({
      controller,
      dialog: {
        mode: 'create',
        draft: {
          ...createMarkerDraftAtCoordinate(52.179337, -9.464944, 'casualty'),
          treatment: '[2026-06-02 10:00] Alpha: Blanket applied',
          updatedBy: 'Bravo',
        },
      },
    })

    render(React.createElement(MarkerDialog))
    const treatmentLog = query('[data-testid="marker-treatment-log-input"]')
    expect(treatmentLog).toBeInstanceOf(HTMLTextAreaElement)
    expect((treatmentLog as HTMLTextAreaElement).maxLength).toBe(512 * 1_024)
    expect(query('[data-testid="marker-treatment-log-budget"]')?.textContent)
      .toMatch(/of 524,288 UTF-8 bytes used/i)

    setTextAreaValue('[data-testid="marker-treatment-update-input"]', 'Warm drink given')
    click('[data-testid="marker-treatment-append-btn"]')

    expect(controller.updateDraft).toHaveBeenCalledWith({
      treatment:
        '[2026-06-02 10:00] Alpha: Blanket applied\n\n[2026-06-02 10:15] Bravo: Warm drink given',
    })
  })

  it('clears an unsaved treatment-size error when the dialog closes', () => {
    const controller = createController()
    const casualtyDraft = createMarkerDraftAtCoordinate(52.179337, -9.464944, 'casualty')
    useMarkerStore.setState({
      controller,
      dialog: {
        mode: 'create',
        draft: {
          ...casualtyDraft,
          treatment: 'a'.repeat(512 * 1_024 - 10),
          updatedBy: 'Bravo',
        },
      },
    })

    render(React.createElement(MarkerDialog))
    setTextAreaValue('[data-testid="marker-treatment-update-input"]', 'Warm drink given')
    click('[data-testid="marker-treatment-append-btn"]')
    expect(query('[role="alert"]')?.textContent).toMatch(/524288 UTF-8 bytes or fewer/i)

    click('[data-testid="marker-close-btn"]')

    expect(controller.closeDialog).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toMatch(/524288 UTF-8 bytes or fewer/i)
    expect((query('[data-testid="marker-treatment-update-input"]') as HTMLTextAreaElement).value)
      .toBe('')
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

function createController(): MarkerRuntimeController & {
  readonly updateDraft: ReturnType<typeof vi.fn>
} {
  return {
    refreshMission: vi.fn().mockResolvedValue(undefined),
    beginCreateAt: vi.fn(),
    beginCreateFromDraft: vi.fn(),
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

function setTextAreaValue(selector: string, value: string): void {
  const input = query(selector)
  if (!(input instanceof HTMLTextAreaElement)) {
    throw new Error(`Expected ${selector} to be a textarea.`)
  }

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(selector: string): void {
  const element = query(selector)
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${selector} to be a button.`)
  }

  act(() => element.click())
}
