import {
  formatDistance,
  geodesicBearing,
  geodesicBearingEndpoint,
  geodesicDistance,
  trueToMagnetic,
  type LonLat,
} from '../drawings/drawing-math'
import type { Measurement, MeasurementRuntimeState } from './measurement-types'

type MutableMeasurementState = {
  activeMissionId: string | null
  mode: 'idle' | 'armed'
  measurements: Measurement[]
  draftStart: LonLat | null
  hoverPoint: LonLat | null
}

export type MeasurementRuntimeController = {
  readonly refreshMission: (missionId: string | null) => void
  readonly armMeasurement: () => void
  readonly cancelMeasurement: () => void
  readonly registerPoint: (lon: number, lat: number) => Measurement | null
  readonly setHoverPoint: (lon: number | null, lat: number | null) => void
  readonly clearMeasurements: () => void
}

type StartMeasurementRuntimeDependencies = {
  readonly applyRuntime: (runtime: MeasurementRuntimeState) => void
}

/**
 * Starts the measurement runtime controller used by the sidebar panel and the map.
 */
export function startMeasurementRuntime(
  dependencies: StartMeasurementRuntimeDependencies,
): MeasurementRuntimeController {
  const state: MutableMeasurementState = {
    activeMissionId: null,
    mode: 'idle',
    measurements: [],
    draftStart: null,
    hoverPoint: null,
  }

  publishRuntime()

  return {
    refreshMission: (missionId) => {
      if (state.activeMissionId === missionId) {
        return
      }

      state.activeMissionId = missionId
      state.mode = 'idle'
      state.measurements = []
      state.draftStart = null
      state.hoverPoint = null
      publishRuntime()
    },
    armMeasurement: () => {
      if (state.activeMissionId === null) {
        return
      }

      state.mode = 'armed'
      state.draftStart = null
      state.hoverPoint = null
      publishRuntime()
    },
    cancelMeasurement: () => {
      state.mode = 'idle'
      state.draftStart = null
      state.hoverPoint = null
      publishRuntime()
    },
    registerPoint: (lon, lat) => {
      if (state.activeMissionId === null || state.mode !== 'armed') {
        return null
      }

      const nextPoint: LonLat = [lon, lat]
      if (state.draftStart === null) {
        state.draftStart = nextPoint
        state.hoverPoint = null
        publishRuntime()
        return null
      }

      const measurement = createMeasurement(
        state.activeMissionId,
        state.draftStart,
        nextPoint,
      )
      state.measurements = [...state.measurements, measurement]
      state.draftStart = null
      state.hoverPoint = null
      publishRuntime()
      return measurement
    },
    setHoverPoint: (lon, lat) => {
      if (state.mode !== 'armed' || state.draftStart === null) {
        if (state.hoverPoint !== null) {
          state.hoverPoint = null
          publishRuntime()
        }
        return
      }

      if (lon === null || lat === null) {
        if (state.hoverPoint !== null) {
          state.hoverPoint = null
          publishRuntime()
        }
        return
      }

      state.hoverPoint = [lon, lat]
      publishRuntime()
    },
    clearMeasurements: () => {
      state.measurements = []
      state.draftStart = null
      state.hoverPoint = null
      publishRuntime()
    },
  }

  function publishRuntime(): void {
    dependencies.applyRuntime({
      activeMissionId: state.activeMissionId,
      mode: state.mode,
      measurements: state.measurements,
      draftStart: state.draftStart,
      hoverPoint: state.hoverPoint,
    })
  }
}

/**
 * Builds a stable operator-facing measurement model from two clicked points.
 */
export function createMeasurement(
  missionId: string,
  start: LonLat,
  end: LonLat,
): Measurement {
  const distanceM = geodesicDistance(start[0], start[1], end[0], end[1])
  const trueBearing = geodesicBearing(start[0], start[1], end[0], end[1])
  const magneticBearing = trueToMagnetic(trueBearing)
  const midpoint = geodesicBearingEndpoint(start[0], start[1], trueBearing, distanceM / 2)

  return {
    id: crypto.randomUUID(),
    missionId,
    start,
    end,
    midpoint,
    distanceM,
    trueBearing,
    magneticBearing,
    label: formatMeasurementLabel(distanceM, trueBearing),
  }
}

/**
 * Formats the permanent map/sidebar label for a measurement.
 */
export function formatMeasurementLabel(
  distanceM: number,
  trueBearing: number,
): string {
  return `${formatDistance(distanceM)} ${Math.round(trueBearing)}°`
}
