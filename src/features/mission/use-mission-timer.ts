import { useEffect, useMemo, useState } from 'react'

import type { Mission } from '../../infrastructure/mission-store/tauri-mission-store'
import { calculateMissionTimerState, type MissionTimerState } from './mission-timers'

/**
 * Maintains the live mission timer clock for any UI surface that displays
 * elapsed and active-search time.
 */
export function useMissionTimer(currentMission: Mission | null): MissionTimerState | null {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return useMemo(() => {
    if (currentMission === null) {
      return null
    }

    return calculateMissionTimerState(currentMission, now)
  }, [currentMission, now])
}
