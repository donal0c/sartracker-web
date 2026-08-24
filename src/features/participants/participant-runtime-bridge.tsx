import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import { resolveParticipantMissionId } from './participant-mission-context'
import { useParticipantStore } from './participant-store'

/** Keeps participant evidence aligned with the active or reviewable mission. */
export function ParticipantRuntimeBridge() {
  const missionId = useMissionStore(resolveParticipantMissionId)
  const controller = useParticipantStore((state) => state.controller)

  useEffect(() => {
    if (controller !== null) void controller.refreshMission(missionId)
  }, [controller, missionId])

  return null
}
