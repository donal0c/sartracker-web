import { useEffect } from 'react'

import { useMissionStore } from '../mission/mission-store'
import { useOutingStore } from '../outings/outing-store'
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
  const watchResumePending = useGpxStore((state) => state.watchResumePending)
  const outingRevision = useOutingStore((state) => state.outings
    .map((outing) => `${outing.id}:${outing.updated_at}`)
    .join('|'))

  useEffect(() => {
    if (controller === null) {
      return
    }

    void controller.refreshMission(missionId)
  }, [controller, missionId, outingRevision])

  // Watches restored after a restart are scanned straight away, not after the first interval [DON-337].
  useEffect(() => {
    if (
      controller === null ||
      !watchResumePending ||
      (missionPhase !== 'active' && missionPhase !== 'paused')
    ) {
      return
    }
    void controller.resumeWatchedDirectories()
  }, [controller, missionPhase, watchResumePending])

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
