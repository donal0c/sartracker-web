import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OutingControlsSection } from '../../src/components/outing-controls-section'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { useOutingStore } from '../../src/features/outings/outing-store'
import type { Mission, Outing } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('OutingControlsSection mission scope [DON-270]', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    useMissionStore.setState({ currentMission: createMission('mission-a'), governanceMission: null })
    useOutingStore.setState({
      activeMissionId: 'mission-a',
      outings: [createOuting('mission-a')],
      fixSummary: null,
      loading: false,
      saving: false,
      error: null,
      controller: createController(),
    })
  })

  afterEach(() => {
    if (root !== null) act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('suppresses and clears an edit draft when the UI mission identity changes', () => {
    renderSection()

    act(() => click('[data-testid="outing-edit-outing-a"]'))
    expect(host?.querySelector('[data-testid="outing-edit-panel"]')).not.toBeNull()

    act(() => useMissionStore.setState({ currentMission: createMission('mission-b') }))
    expect(host?.querySelector('[data-testid="outing-edit-panel"]')).toBeNull()

    act(() => useOutingStore.setState({
      activeMissionId: 'mission-b',
      outings: [createOuting('mission-b')],
      fixSummary: null,
      loading: false,
      saving: false,
      error: null,
    }))
    expect(host?.querySelector('[data-testid="outing-edit-panel"]')).toBeNull()
  })

  function renderSection(): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(React.createElement(OutingControlsSection)))
  }

  function click(selector: string): void {
    const element = host?.querySelector<HTMLElement>(selector)
    if (element === null || element === undefined) {
      throw new Error(`Expected outing control ${selector} to exist.`)
    }
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }
})

function createMission(id: string): Mission {
  return {
    id,
    name: `Mission ${id}`,
    status: 'active',
    start_time: '2026-08-23T18:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 9,
  }
}

function createOuting(missionId: string): Outing {
  return {
    id: missionId === 'mission-a' ? 'outing-a' : 'outing-b',
    mission_id: missionId,
    label: missionId === 'mission-a' ? 'Alpha outing' : 'Bravo outing',
    started_at: '2026-08-23T20:00:00.000Z',
    ended_at: null,
    created_at: '2026-08-23T20:00:00.000Z',
    updated_at: '2026-08-23T20:00:00.000Z',
  }
}

function createController() {
  return {
    refreshMission: vi.fn(),
    startOuting: vi.fn().mockResolvedValue(null),
    endOuting: vi.fn().mockResolvedValue(null),
    renameOuting: vi.fn().mockResolvedValue(null),
    editOutingBoundaries: vi.fn().mockResolvedValue(null),
    clearError: vi.fn(),
  }
}
