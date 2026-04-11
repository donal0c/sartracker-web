import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import { useGpxStore } from './gpx-store'

const WATCH_RESCAN_INTERVAL_MS = 30_000

/**
 * Keeps GPX imports aligned with the active mission and periodically rescans
 * watched folders while a mission is open.
 */
export function GpxRuntimeBridge() {
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)
  const controller = useGpxStore((state) => state.controller)
  const watchedDirectories = useGpxStore((state) => state.watchedDirectories)

  useEffect(() => {
    if (controller === null) {
      return
    }

    void controller.refreshMission(missionId)
  }, [controller, missionId])

  useEffect(() => {
    if (
      controller === null ||
      watchedDirectories.length === 0 ||
      (missionPhase !== 'active' && missionPhase !== 'paused')
    ) {
      return
    }

    const intervalId = window.setInterval(() => {
      void controller.rescanWatchedDirectories()
    }, WATCH_RESCAN_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [controller, missionPhase, watchedDirectories])

  return null
}
