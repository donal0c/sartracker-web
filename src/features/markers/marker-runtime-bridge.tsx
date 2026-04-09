import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import { useMarkerStore } from './marker-store'

/**
 * Keeps marker runtime state aligned with the currently editable mission context.
 */
export function MarkerRuntimeBridge() {
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const controller = useMarkerStore((state) => state.controller)

  useEffect(() => {
    if (controller === null) {
      return
    }

    void controller.refreshMission(missionId)
  }, [controller, missionId])

  return null
}
