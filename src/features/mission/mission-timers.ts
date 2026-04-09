import type { Mission } from '../../infrastructure/mission-store/tauri-mission-store'

export type MissionTimerState = {
  readonly elapsedSeconds: number
  readonly activeSeconds: number
  readonly isPaused: boolean
}

/**
 * Calculates elapsed and active-search timers for a mission at a given clock time.
 */
export function calculateMissionTimerState(
  mission: Mission,
  now: Date,
): MissionTimerState {
  const endTimestamp = mission.finish_time ?? now.toISOString()
  const elapsedSeconds = calculateDurationSeconds(mission.start_time, endTimestamp)
  const currentPauseSeconds =
    mission.status === 'paused' && mission.pause_time !== null
      ? calculateDurationSeconds(mission.pause_time, now.toISOString())
      : 0
  const activeSeconds = Math.max(0, elapsedSeconds - mission.paused_seconds - currentPauseSeconds)

  return {
    elapsedSeconds,
    activeSeconds,
    isPaused: mission.status === 'paused',
  }
}

/**
 * Formats a mission timer duration as hh:mm:ss.
 */
export function formatMissionDuration(totalSeconds: number): string {
  const normalized = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const seconds = normalized % 60

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function calculateDurationSeconds(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 1000))
}
