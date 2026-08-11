import { useMissionStore } from '../mission/mission-store'
import { useActiveMissionDevicesStore } from './active-mission-devices-store'
import {
  createExactBreadcrumbDotController,
  EXACT_BREADCRUMB_DOT_PAGE_LIMIT,
  type ExactBreadcrumbDotPage,
} from './exact-breadcrumb-dot-controller'
import {
  applyExactBreadcrumbDotController,
  applyExactBreadcrumbDotState,
} from './exact-breadcrumb-dot-store'
import { useTrackingStyleStore } from './tracking-style-store'
import type { TrackingDataOrigin } from './tracking-types'

type StoredExactBreadcrumbDot = {
  readonly id: string
  readonly source_position_id: string | null
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
  readonly data_origin: TrackingDataOrigin
}

type StoredExactBreadcrumbDotPage = Omit<ExactBreadcrumbDotPage, 'positions'> & {
  readonly positions: readonly StoredExactBreadcrumbDot[]
}

export type ExactBreadcrumbDotMissionStore = {
  readonly listExactBreadcrumbDotPage?: (
    input: {
      readonly missionId: string
      readonly activeDeviceIds: readonly string[]
      readonly limit: number
      readonly cursor?: string | null
      readonly direction: 'earlier' | 'later' | 'latest'
    },
    requestId?: string,
  ) => Promise<StoredExactBreadcrumbDotPage>
  readonly cancelExactBreadcrumbDotQuery?: (requestId: string) => Promise<boolean>
}

let nextExactDotRuntime = 0
const exactDotRendererSessionId = createExactDotRendererSessionId()

/**
 * Starts the exact-dot read model and binds it to mission, style, and active
 * device context. Persistence remains the sole source of dot truth.
 */
export function startExactBreadcrumbDotRuntime(
  missionStore: ExactBreadcrumbDotMissionStore,
): () => void {
  const runtimeId = ++nextExactDotRuntime
  let requestSequence = 0
  const controller = createExactBreadcrumbDotController({
    limit: EXACT_BREADCRUMB_DOT_PAGE_LIMIT,
    queryPage: async (input) => {
      if (missionStore.listExactBreadcrumbDotPage === undefined) {
        throw new Error('Exact breadcrumb-dot storage query is unavailable.')
      }
      const requestId =
        `exact-dot-renderer-${exactDotRendererSessionId}-${runtimeId}-${++requestSequence}`
      const cancel = () => {
        void missionStore.cancelExactBreadcrumbDotQuery?.(requestId).catch(() => undefined)
      }
      input.signal.addEventListener('abort', cancel, { once: true })
      try {
        let page: StoredExactBreadcrumbDotPage
        try {
          page = await missionStore.listExactBreadcrumbDotPage(
            {
              missionId: input.missionId,
              activeDeviceIds: input.activeDeviceIds,
              limit: input.limit,
              cursor: input.cursor,
              direction: input.direction,
            },
            requestId,
          )
        } catch (error) {
          if (input.signal.aborted) {
            throw createAbortError()
          }
          throw error
        }
        if (input.signal.aborted) {
          throw createAbortError()
        }
        return {
          ...page,
          positions: page.positions.map((position) => ({
            id: position.source_position_id?.trim() || position.id,
            source_position_id: position.source_position_id?.trim() || null,
            device_id: position.device_id,
            lat: position.lat,
            lon: position.lon,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            timestamp: position.timestamp,
            source: 'traccar',
            data_origin: position.data_origin,
            cache_age_seconds: null,
            device_cache_stale: false,
          })),
        }
      } finally {
        input.signal.removeEventListener('abort', cancel)
      }
    },
    publish: applyExactBreadcrumbDotState,
  })
  applyExactBreadcrumbDotController(controller)

  const updateContext = (): void => {
    const missionId = useMissionStore.getState().currentMission?.id ?? null
    controller.updateContext({
      missionId,
      trailMode: useTrackingStyleStore.getState().breadcrumbTrailMode,
      activeDeviceIds:
        useActiveMissionDevicesStore.getState().getActiveDeviceIds(missionId),
    })
  }
  const unsubscribeMission = useMissionStore.subscribe(updateContext)
  const unsubscribeStyle = useTrackingStyleStore.subscribe(updateContext)
  const unsubscribeDevices = useActiveMissionDevicesStore.subscribe(updateContext)
  updateContext()

  return () => {
    unsubscribeMission()
    unsubscribeStyle()
    unsubscribeDevices()
    controller.stop()
    applyExactBreadcrumbDotController(null)
  }
}

function createAbortError(): Error {
  const error = new Error('Exact breadcrumb-dot query was cancelled.')
  error.name = 'AbortError'
  return error
}

/** Creates a renderer-session nonce so a reloaded renderer cannot collide with stale requests. */
function createExactDotRendererSessionId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
