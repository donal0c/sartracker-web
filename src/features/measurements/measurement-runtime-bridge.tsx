import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import {
  applyMeasurementController,
  applyMeasurementRuntime,
  useMeasurementStore,
} from './measurement-store'
import { startMeasurementRuntime } from './start-measurement-runtime'

/**
 * Keeps measurement runtime state aligned with the current mission context.
 */
export function MeasurementRuntimeBridge() {
  const controller = useMeasurementStore((state) => state.controller)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)

  useEffect(() => {
    if (controller !== null) {
      return
    }

    applyMeasurementController(
      startMeasurementRuntime({
        applyRuntime: applyMeasurementRuntime,
      }),
    )
  }, [controller])

  useEffect(() => {
    if (controller === null) {
      return
    }

    controller.refreshMission(missionId)
  }, [controller, missionId])

  return null
}
