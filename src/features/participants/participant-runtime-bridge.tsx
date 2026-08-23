import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import { useParticipantStore } from './participant-store'

/** Keeps participant evidence aligned with the active or reviewable mission. */
export function ParticipantRuntimeBridge() {
  const missionId = useMissionStore((state) =>
    state.currentMission?.id ?? state.governanceMission?.id ?? null)
  const controller = useParticipantStore((state) => state.controller)

  useEffect(() => {
    if (controller !== null) void controller.refreshMission(missionId)
  }, [controller, missionId])

  return null
}
