import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMissionStore } from '../../src/features/mission/mission-store'
import { startMissionTrackingStatusBridge } from '../../src/features/tracking/mission-tracking-status-bridge'

describe('mission tracking status bridge', () => {
  beforeEach(() => {
    useMissionStore.setState({
      phase: 'active',
      currentMission: null,
      recoverableMission: null,
    })
  })

  it('marks tracking idle immediately when the mission finishes between polling ticks', () => {
    const applySnapshot = vi.fn()
    const applyStatus = vi.fn()
    const stop = startMissionTrackingStatusBridge({ applySnapshot, applyStatus })

    useMissionStore.setState({
      phase: 'idle',
      currentMission: null,
      recoverableMission: null,
    })

    expect(applySnapshot).toHaveBeenLastCalledWith({
      devices: [],
      positions: [],
      breadcrumbs: [],
    })
    expect(applyStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'idle',
        lastSuccessAt: null,
        warning: 'Waiting for an active mission.',
      }),
    )

    stop()
  })

  it('gives recovery-specific reconnect guidance after a reload recovery state appears', () => {
    const applySnapshot = vi.fn()
    const applyStatus = vi.fn()
    const stop = startMissionTrackingStatusBridge({ applySnapshot, applyStatus })

    useMissionStore.setState({
      phase: 'recovery',
      currentMission: null,
      recoverableMission: null,
    })

    expect(applySnapshot).toHaveBeenLastCalledWith({
      devices: [],
      positions: [],
      breadcrumbs: [],
    })
    expect(applyStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'idle',
        warning: 'Resume the mission before reconnecting live tracking.',
      }),
    )

    stop()
  })
})
