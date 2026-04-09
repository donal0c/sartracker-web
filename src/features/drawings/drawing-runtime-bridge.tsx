import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import { useDrawingStore } from './drawing-store'

/**
 * Keeps drawing runtime state aligned with the currently active mission context.
 */
export function DrawingRuntimeBridge() {
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const controller = useDrawingStore((state) => state.controller)

  useEffect(() => {
    if (controller === null) {
      return
    }

    void controller.refreshMission(missionId)
  }, [controller, missionId])

  return null
}
