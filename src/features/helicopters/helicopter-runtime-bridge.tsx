import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import { useHelicopterStore } from './helicopter-store'

export function HelicopterRuntimeBridge() {
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const controller = useHelicopterStore((state) => state.controller)

  useEffect(() => {
    if (controller === null) {
      return
    }

    void controller.refreshMission(missionId)
  }, [controller, missionId])

  return null
}
