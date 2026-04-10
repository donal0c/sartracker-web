import type { LonLat } from '../drawings/drawing-math'

export type MeasurementMode = 'idle' | 'armed'

export type Measurement = {
  readonly id: string
  readonly missionId: string
  readonly start: LonLat
  readonly end: LonLat
  readonly midpoint: LonLat
  readonly distanceM: number
  readonly trueBearing: number
  readonly magneticBearing: number
  readonly label: string
}

export type MeasurementRuntimeState = {
  readonly activeMissionId: string | null
  readonly mode: MeasurementMode
  readonly measurements: readonly Measurement[]
  readonly draftStart: LonLat | null
  readonly hoverPoint: LonLat | null
}
