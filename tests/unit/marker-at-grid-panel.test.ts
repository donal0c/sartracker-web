import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { useMarkerStore } from '../../src/features/markers/marker-store'
import type { MarkerRuntimeController } from '../../src/features/markers/start-marker-runtime'
import { useMissionStore } from '../../src/features/mission/mission-store'

describe('MarkerAtGridPanel', () => {
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
    useMarkerStore.setState({
      activeMissionId: null,
      markers: [],
      loading: false,
      saving: false,
      error: null,
      dialog: null,
      controller: null,
    })
    useMissionStore.setState({
      phase: 'idle',
      currentMission: null,
      recoverableMission: null,
    })
  })

  it('refreshes marker runtime to the active mission before opening a grid marker draft', async () => {
    const controller = createController()
    const { MarkerAtGridPanel } = await import('../../src/components/marker-at-grid-panel')
    useMarkerStore.setState({ controller })
    useMissionStore.setState({
      phase: 'active',
      currentMission: createMission('mission-1'),
      recoverableMission: null,
    })

    render(React.createElement(MarkerAtGridPanel))
    setInputValue('[data-testid="marker-at-grid-reference-input"]', 'Q 99842 04015')

    await act(async () => {
      getButton('[data-testid="marker-at-grid-create-btn"]').click()
    })

    expect(controller.refreshMission).toHaveBeenCalledWith('mission-1')
    expect(controller.beginCreateAt).toHaveBeenCalledWith(
      expect.closeTo(52.179337, 5),
      expect.closeTo(-9.464944, 5),
      'ipp_lkp',
    )
    expect(controller.refreshMission.mock.invocationCallOrder[0]).toBeLessThan(
      controller.beginCreateAt.mock.invocationCallOrder[0] ?? 0,
    )
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
    name: 'Grid Marker Mission',
    status: 'active',
    start_time: '2026-05-16T10:00:00.000Z',
    pause_time: null,
    end_time: null,
    created_at: '2026-05-16T10:00:00.000Z',
    updated_at: '2026-05-16T10:00:00.000Z',
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
