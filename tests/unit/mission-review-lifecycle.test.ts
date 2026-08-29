// @vitest-environment jsdom

import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MissionReviewWorkspace } from '../../src/components/mission-review-workspace'
import { MissionReviewRuntimeBridge } from '../../src/features/mission-review/mission-review-runtime-bridge'
import {
  createMissionReviewRuntimeState,
  type MissionReviewController,
} from '../../src/features/mission-review/start-mission-review-runtime'
import { useMissionReviewStore } from '../../src/features/mission-review/mission-review-store'
import { useMissionReviewWorkspaceStore } from '../../src/features/mission-review/mission-review-workspace-store'
import { useMissionStore } from '../../src/features/mission/mission-store'

const mocks = vi.hoisted(() => ({
  startMissionReviewRuntime: vi.fn(),
}))

vi.mock('../../src/features/mission-review/start-mission-review-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/mission-review/start-mission-review-runtime')>()
  return {
    ...actual,
    startMissionReviewRuntime: mocks.startMissionReviewRuntime,
  }
})

vi.mock('../../src/features/mission/mission-browser-harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/mission/mission-browser-harness')>()
  return { ...actual, shouldEnableMissionBrowserHarness: () => true }
})

vi.mock('../../src/features/browser-validation/browser-harness-store', () => ({
  getBrowserHarnessStore: () => ({}),
}))

vi.mock('../../src/features/browser-validation/browser-harness-layer-catalog-store', () => ({
  getBrowserHarnessLayerCatalogStore: () => ({}),
}))

describe('Mission Review lifecycle', () => {
  let container: HTMLDivElement
  let root: Root
  let controller: MissionReviewController

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    controller = {
      load: vi.fn().mockResolvedValue(undefined),
      selectMission: vi.fn().mockResolvedValue(undefined),
      refreshSelectedMission: vi.fn().mockResolvedValue(undefined),
      setIncludeTelemetry: vi.fn().mockResolvedValue(undefined),
    }
    mocks.startMissionReviewRuntime.mockReset().mockResolvedValue(controller)
    useMissionReviewStore.setState({
      ...createMissionReviewRuntimeState({ selectedMissionId: 'mission-1' }),
      controller: null,
    })
    useMissionReviewWorkspaceStore.setState({ open: false })
    useMissionStore.setState({
      phase: 'idle',
      currentMission: null,
      recoverableMission: null,
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('does not load a selected mission while Review is closed [DON-251]', async () => {
    await act(async () => {
      root.render(createElement(MissionReviewRuntimeBridge))
      await Promise.resolve()
    })

    expect(mocks.startMissionReviewRuntime).toHaveBeenCalledTimes(1)
    expect(controller.load).not.toHaveBeenCalled()
  })

  it('loads exactly once when Review opens [DON-251]', async () => {
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(MissionReviewRuntimeBridge),
          createElement(MissionReviewWorkspace),
        ),
      )
      await Promise.resolve()
    })

    expect(controller.load).not.toHaveBeenCalled()

    await act(async () => {
      useMissionReviewWorkspaceStore.getState().openWorkspace()
      await Promise.resolve()
    })

    expect(controller.load).toHaveBeenCalledTimes(1)
    expect(controller.load).toHaveBeenCalledWith('mission-1')
  })

  it('reloads an open Review when the live mission phase changes [DON-279]', async () => {
    useMissionStore.setState({ phase: 'active' })

    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(MissionReviewRuntimeBridge),
          createElement(MissionReviewWorkspace),
        ),
      )
      await Promise.resolve()
      useMissionReviewWorkspaceStore.getState().openWorkspace()
      await Promise.resolve()
    })

    expect(controller.load).toHaveBeenCalledTimes(1)

    await act(async () => {
      useMissionStore.setState({ phase: 'idle' })
      await Promise.resolve()
    })

    expect(controller.load).toHaveBeenCalledTimes(2)
    expect(controller.load).toHaveBeenLastCalledWith('mission-1')
  })
})
