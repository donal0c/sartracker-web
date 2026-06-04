import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CoordinateConverterDialog } from '../../src/components/coordinate-converter-dialog'
import { useCoordinateToolStore } from '../../src/features/coordinates/coordinate-tool-store'
import { useMapTargetStore } from '../../src/features/map/map-target-store'
import { useMarkerStore } from '../../src/features/markers/marker-store'
import type { MarkerRuntimeController } from '../../src/features/markers/start-marker-runtime'
import { useMissionStore } from '../../src/features/mission/mission-store'
import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('CoordinateConverterDialog marker workflow', () => {
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
    useCoordinateToolStore.setState(useCoordinateToolStore.getInitialState())
    useMapTargetStore.setState(useMapTargetStore.getInitialState())
    useMarkerStore.setState(useMarkerStore.getInitialState())
    useMissionStore.setState(useMissionStore.getInitialState())
  })

  it('opens the normal marker form from a converted grid location', async () => {
    const controller = createController()
    useCoordinateToolStore.setState({ open: true })
    useMarkerStore.setState({ controller })
    useMissionStore.setState({
      phase: 'active',
      currentMission: createMission('mission-1'),
      recoverableMission: null,
    })

    render(React.createElement(CoordinateConverterDialog))
    setInputValue('[data-testid="coordinate-input-irish-grid-ref"]', 'Q 99842 04015')

    await act(async () => {
      getButton('[data-testid="coordinate-convert-btn"]').click()
    })
    await act(async () => {
      getButton('[data-testid="coordinate-create-marker-btn"]').click()
    })

    expect(controller.refreshMission).toHaveBeenCalledWith('mission-1')
    expect(controller.beginCreateAt).toHaveBeenCalledWith(
      expect.closeTo(52.179337, 5),
      expect.closeTo(-9.464944, 5),
    )
    expect(useCoordinateToolStore.getState().open).toBe(false)
  })

  it('keeps marker creation available after going to a converted grid location', async () => {
    const controller = createController()
    useCoordinateToolStore.setState({ open: true })
    useMarkerStore.setState({ controller })
    useMissionStore.setState({
      phase: 'active',
      currentMission: createMission('mission-1'),
      recoverableMission: null,
    })

    render(React.createElement(CoordinateConverterDialog))
    setInputValue('[data-testid="coordinate-input-irish-grid-ref"]', 'Q 99842 04015')

    await act(async () => {
      getButton('[data-testid="coordinate-convert-btn"]').click()
    })
    await act(async () => {
      getButton('[data-testid="coordinate-go-to-btn"]').click()
    })

    expect(useMapTargetStore.getState().activeTarget).toEqual(
      expect.objectContaining({
        label: 'Coordinate Target',
        latitude: expect.closeTo(52.179337, 5),
        longitude: expect.closeTo(-9.464944, 5),
      }),
    )
    expect(useCoordinateToolStore.getState().open).toBe(true)
    expect(getButton('[data-testid="coordinate-create-marker-btn"]').disabled).toBe(false)

    await act(async () => {
      getButton('[data-testid="coordinate-create-marker-btn"]').click()
    })

    expect(controller.beginCreateAt).toHaveBeenCalledWith(
      expect.closeTo(52.179337, 5),
      expect.closeTo(-9.464944, 5),
    )
  })

  it('renders coordinate modes with distinct active and inactive tab chrome', async () => {
    useCoordinateToolStore.setState({ open: true })

    render(React.createElement(CoordinateConverterDialog))

    await act(async () => {
      getElement('[data-testid="coordinate-mode-dd"]').click()
    })

    expect(getElement('[data-testid="coordinate-mode-dd"]').className).toContain('sar-segment-option-active')
    expect(getElement('[data-testid="coordinate-mode-dd"]').className).not.toContain('bg-amber')
    expect(getElement('[data-testid="coordinate-mode-ig"]').className).toContain('sar-segment-option')
    expect(getElement('[data-testid="coordinate-mode-ig"]').className).not.toContain('sar-segment-option-active')
    expect(getElement('[data-testid="coordinate-mode-ig"]').className).not.toContain('sar-button')
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
  readonly refreshMission: ReturnType<typeof vi.fn>
  readonly beginCreateAt: ReturnType<typeof vi.fn>
} {
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

function createMission(id: string): Mission {
  return {
    id,
    name: 'Coordinate Marker Mission',
    status: 'active',
    start_time: '2026-06-02T10:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 1,
  }
}

function setInputValue(selector: string, value: string): void {
  const input = document.querySelector(selector)
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Expected ${selector} to be an input.`)
  }

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function getButton(selector: string): HTMLButtonElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${selector} to be a button.`)
  }
  return element
}

function getElement(selector: string): HTMLElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${selector} to be an element.`)
  }
  return element
}
