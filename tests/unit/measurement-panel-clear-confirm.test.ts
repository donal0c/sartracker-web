import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MeasurementPanel } from '../../src/components/measurement-panel'
import { useMeasurementStore } from '../../src/features/measurements/measurement-store'
import { useMissionStore } from '../../src/features/mission/mission-store'

describe('MeasurementPanel two-stage clear confirmation', () => {
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
    useMeasurementStore.setState(useMeasurementStore.getInitialState())
    useMissionStore.setState(useMissionStore.getInitialState())
  })

  it('does not clear on first click — shows confirmation instead', () => {
    const clearMeasurements = vi.fn()
    setupWithMeasurements(clearMeasurements)

    click('[data-testid="measurement-clear-btn"]')

    expect(clearMeasurements).not.toHaveBeenCalled()
    expect(query('[data-testid="measurement-clear-confirmation"]')).not.toBeNull()
  })

  it('clears on confirmation click after the first stage', () => {
    const clearMeasurements = vi.fn()
    setupWithMeasurements(clearMeasurements)

    click('[data-testid="measurement-clear-btn"]')
    click('[data-testid="measurement-clear-confirm-btn"]')

    expect(clearMeasurements).toHaveBeenCalledTimes(1)
  })

  it('cancels clear when Keep is clicked', () => {
    const clearMeasurements = vi.fn()
    setupWithMeasurements(clearMeasurements)

    click('[data-testid="measurement-clear-btn"]')
    expect(query('[data-testid="measurement-clear-confirmation"]')).not.toBeNull()

    click('[data-testid="measurement-clear-keep-btn"]')

    expect(clearMeasurements).not.toHaveBeenCalled()
    expect(query('[data-testid="measurement-clear-confirmation"]')).toBeNull()
  })

  function setupWithMeasurements(clearMeasurements: ReturnType<typeof vi.fn>): void {
    useMissionStore.setState({
      currentMission: { id: 'mission-1', name: 'Test', startedAt: new Date().toISOString() } as never,
      phase: 'active',
    })
    useMeasurementStore.setState({
      controller: {
        armMeasurement: vi.fn(),
        cancelMeasurement: vi.fn(),
        clearMeasurements,
        addMeasurementFromPoints: vi.fn(),
      },
      mode: 'idle',
      measurements: [{ id: 'm-1', label: '350m @ 045° True' }],
      draftStart: null,
    })
    render(React.createElement(MeasurementPanel))
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
