import { describe, expect, it, vi } from 'vitest'

import { startMeasurementRuntime } from '../../src/features/measurements/start-measurement-runtime'
import type { MeasurementRuntimeState } from '../../src/features/measurements/measurement-types'

describe('startMeasurementRuntime', () => {
  it('arms, captures two points, and returns to idle after the one-shot measurement', () => {
    const applyRuntime = vi.fn<(runtime: MeasurementRuntimeState) => void>()
    const controller = startMeasurementRuntime({ applyRuntime })

    controller.refreshMission('mission-1')
    controller.armMeasurement()
    expect(latestRuntime(applyRuntime)?.mode).toBe('armed')

    const firstResult = controller.registerPoint(-9.7, 51.97)
    expect(firstResult).toBeNull()
    expect(latestRuntime(applyRuntime)?.draftStart).toEqual([-9.7, 51.97])

    const secondResult = controller.registerPoint(-9.68, 51.98)
    expect(secondResult).not.toBeNull()
    expect(secondResult?.missionId).toBe('mission-1')

    const runtime = latestRuntime(applyRuntime)
    expect(runtime?.mode).toBe('idle')
    expect(runtime?.draftStart).toBeNull()
    expect(runtime?.measurements).toHaveLength(1)
    expect(runtime?.measurements[0]?.label).toMatch(/^\d+(\.\d+)? (m|km) \d+°$/)

    const ignoredResult = controller.registerPoint(-9.67, 51.99)
    expect(ignoredResult).toBeNull()
    expect(latestRuntime(applyRuntime)?.measurements).toHaveLength(1)
  })

  it('clears transient state when the mission changes or is removed', () => {
    const applyRuntime = vi.fn<(runtime: MeasurementRuntimeState) => void>()
    const controller = startMeasurementRuntime({ applyRuntime })

    controller.refreshMission('mission-1')
    controller.armMeasurement()
    controller.registerPoint(-9.7, 51.97)
    controller.registerPoint(-9.68, 51.98)
    expect(latestRuntime(applyRuntime)?.measurements).toHaveLength(1)

    controller.refreshMission('mission-2')
    expect(latestRuntime(applyRuntime)).toMatchObject({
      activeMissionId: 'mission-2',
      mode: 'idle',
      measurements: [],
      draftStart: null,
      hoverPoint: null,
    })

    controller.armMeasurement()
    controller.registerPoint(-9.7, 51.97)
    controller.setHoverPoint(-9.69, 51.975)
    controller.refreshMission(null)
    expect(latestRuntime(applyRuntime)).toMatchObject({
      activeMissionId: null,
      mode: 'idle',
      measurements: [],
      draftStart: null,
      hoverPoint: null,
    })
  })

  it('supports clearing measurements without dropping the mission context', () => {
    const applyRuntime = vi.fn<(runtime: MeasurementRuntimeState) => void>()
    const controller = startMeasurementRuntime({ applyRuntime })

    controller.refreshMission('mission-1')
    controller.armMeasurement()
    controller.registerPoint(-9.7, 51.97)
    controller.registerPoint(-9.68, 51.98)
    expect(latestRuntime(applyRuntime)?.measurements).toHaveLength(1)

    controller.clearMeasurements()
    expect(latestRuntime(applyRuntime)).toMatchObject({
      activeMissionId: 'mission-1',
      measurements: [],
      draftStart: null,
      hoverPoint: null,
    })
  })
})

function latestRuntime(
  applyRuntime: ReturnType<typeof vi.fn<(runtime: MeasurementRuntimeState) => void>>,
): MeasurementRuntimeState | null {
  const lastCall = applyRuntime.mock.lastCall
  return lastCall?.[0] ?? null
}
