import React, { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMissionStore } from '../../src/features/mission/mission-store'
import { useOutingStore } from '../../src/features/outings/outing-store'
import type { OutingControlsViewModel } from '../../src/features/outings/use-outing-controls-view-model'
import { useOutingControlsViewModel } from '../../src/features/outings/use-outing-controls-view-model'
import type { Mission, Outing } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('useOutingControlsViewModel [DON-270]', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    useMissionStore.setState({ currentMission: createMission(), governanceMission: null })
    useOutingStore.setState({
      activeMissionId: 'mission-1',
      outings: [],
      fixSummary: {
        outings: [],
        unassigned_accepted_fix_count: 4,
        total_accepted_fix_count: 4,
      },
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
    vi.clearAllMocks()
  })

  it('states explicitly that fixes are Unassigned when no outing is active', () => {
    const { getModel } = renderHook()

    expect(getModel().noActiveOutingNotice).toBe(
      'No active outing — new fixes will be recorded as Unassigned.',
    )
    expect(getModel().unassignedFixCount).toBe(4)
    expect(getModel().nextDefaultLabel).toBe('Outing 1')
  })

  it('delegates explicit start, end, rename and boundary edits', async () => {
    const controller = createController()
    useOutingStore.setState({
      controller,
      outings: [createOuting()],
      fixSummary: null,
    })
    const { getModel } = renderHook()

    await act(async () => {
      await getModel().startOuting('Night search')
      await getModel().endOuting('outing-1')
      await getModel().renameOuting('outing-1', 'Night search A')
      await getModel().editBoundaries(
        'outing-1',
        '2026-08-23T19:00:00.000Z',
        '2026-08-23T23:00:00.000Z',
      )
    })

    expect(controller.startOuting).toHaveBeenCalledWith({ label: 'Night search' })
    expect(controller.endOuting).toHaveBeenCalledWith('outing-1')
    expect(controller.renameOuting).toHaveBeenCalledWith('outing-1', 'Night search A')
    expect(controller.editOutingBoundaries).toHaveBeenCalledWith('outing-1', {
      started_at: '2026-08-23T19:00:00.000Z',
      ended_at: '2026-08-23T23:00:00.000Z',
    })
  })

  it('keeps finalized mission outing bookkeeping read-only', () => {
    useMissionStore.setState({
      currentMission: null,
      governanceMission: createMission({ status: 'finalized' }),
    })
    const { getModel } = renderHook()

    expect(getModel().canMutate).toBe(false)
  })

  it('hides and disables outing state from a different runtime mission', async () => {
    const controller = createController()
    useMissionStore.setState({
      currentMission: createMission({ id: 'mission-b' }),
      governanceMission: null,
    })
    useOutingStore.setState({
      activeMissionId: 'mission-a',
      outings: [createOuting({ mission_id: 'mission-a' })],
      fixSummary: {
        outings: [{ outing_id: 'outing-1', accepted_fix_count: 7 }],
        unassigned_accepted_fix_count: 3,
        total_accepted_fix_count: 10,
      },
      loading: false,
      saving: false,
      error: null,
      controller,
    })
    const { getModel } = renderHook()

    expect(getModel().outings).toEqual([])
    expect(getModel().activeOuting).toBeNull()
    expect(getModel().unassignedFixCount).toBeNull()
    expect(getModel().loading).toBe(true)
    expect(getModel().error).toBeNull()
    expect(getModel().noActiveOutingNotice).toBeNull()
    expect(getModel().nextDefaultLabel).toBe('Outing 1')
    expect(getModel().canMutate).toBe(false)
    await act(async () => {
      expect(await getModel().endOuting('outing-1')).toBe(false)
    })
    expect(controller.endOuting).not.toHaveBeenCalled()
  })

  it('keeps outing controls read-only while hydration is loading or failed', async () => {
    const controller = createController()
    useOutingStore.setState({ controller, loading: true, error: null })
    const { getModel } = renderHook()

    expect(getModel().canMutate).toBe(false)
    await act(async () => {
      expect(await getModel().startOuting('Outing 1')).toBe(false)
    })
    expect(controller.startOuting).not.toHaveBeenCalled()

    act(() => useOutingStore.setState({ loading: false, error: 'Summary unavailable' }))

    expect(getModel().canMutate).toBe(false)
    await act(async () => {
      expect(await getModel().renameOuting('outing-1', 'Night search')).toBe(false)
    })
    expect(controller.renameOuting).not.toHaveBeenCalled()
  })

  function renderHook(): { readonly getModel: () => OutingControlsViewModel } {
    let currentModel: OutingControlsViewModel | null = null
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(React.createElement(ModelProbe, {
        onModel: (model) => { currentModel = model },
      }))
    })
    return {
      getModel: () => {
        if (currentModel === null) throw new Error('Outing controls model was not rendered.')
        return currentModel
      },
    }
  }
})

function ModelProbe(props: { readonly onModel: (model: OutingControlsViewModel) => void }) {
  const model = useOutingControlsViewModel()
  useEffect(() => props.onModel(model), [model, props])
  return null
}

function createController() {
  return {
    refreshMission: vi.fn(),
    startOuting: vi.fn(),
    endOuting: vi.fn(),
    renameOuting: vi.fn(),
    editOutingBoundaries: vi.fn(),
    clearError: vi.fn(),
  }
}

function createMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1', name: 'Test Mission', status: 'active',
    start_time: '2026-08-23T18:00:00.000Z', pause_time: null, finish_time: null,
    paused_seconds: 0, notes: null, schema_version: 9, ...overrides,
  }
}

function createOuting(overrides: Partial<Outing> = {}): Outing {
  return {
    id: 'outing-1', mission_id: 'mission-1', label: 'Outing 1',
    started_at: '2026-08-23T20:00:00.000Z', ended_at: null,
    created_at: '2026-08-23T20:00:00.000Z', updated_at: '2026-08-23T20:00:00.000Z',
    ...overrides,
  }
}
