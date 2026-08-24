import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import { useOutingStore } from './outing-store'

/** Keeps outing state aligned with the active or most recent governance mission. */
export function OutingRuntimeBridge() {
  const missionId = useMissionStore((state) =>
    state.currentMission?.id ?? state.governanceMission?.id ?? null)
  const controller = useOutingStore((state) => state.controller)

  useEffect(() => {
    if (controller !== null) void controller.refreshMission(missionId)
  }, [controller, missionId])

  return null
}
