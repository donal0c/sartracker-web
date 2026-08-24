import type {
  CoverageClaim,
  CoverageManifest,
  CoverageTileCatalog,
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { isCoverageEnabled } from '../runtime/coverage-flag'
import { useMissionStore } from '../mission/mission-store'
import { createCoverageController } from './coverage-controller'
import {
  applyCoverageController,
  applyCoverageState,
  resetCoverageStore,
} from './coverage-store'

const COVERAGE_REFRESH_INTERVAL_MS = 30_000

export type CoverageRuntimeMissionStore = Pick<
  Required<MissionStore>,
  | 'readCoverageManifest'
  | 'readCoverageClaim'
  | 'syncCoverageTileCatalog'
  | 'cancelCoverageQuery'
>

type CoverageChangedEvent = { readonly missionId: string; readonly changeSeq: number }

/** Starts the mission-keyed Candidate-B renderer delivery runtime. */
export function startCoverageRuntime(
  missionStore: Partial<CoverageRuntimeMissionStore>,
  options: {
    readonly enabled?: boolean
    readonly rendererGeneration?: string
    readonly subscribeCoverageChanged?: (
      listener: (event: CoverageChangedEvent) => void,
    ) => () => void
    readonly schedulePeriodicRefresh?: (
      callback: () => void,
      intervalMs: number,
    ) => () => void
  } = {},
): () => void {
  if ((options.enabled ?? isCoverageEnabled()) === false) {
    resetCoverageStore()
    return () => undefined
  }
  if (!hasCoverageRuntimeBoundary(missionStore)) {
    throw new Error('Complete coverage storage is unavailable in this runtime.')
  }
  const rendererGeneration = options.rendererGeneration ?? createRendererGeneration()
  const controller = createCoverageController({
    readManifest: (missionId, requestId, signal) => runCancelable(
      signal,
      requestId,
      () => missionStore.readCoverageManifest(missionId, requestId),
      missionStore.cancelCoverageQuery,
    ) as Promise<CoverageManifest>,
    readClaim: (query, requestId, signal) => runCancelable(
      signal,
      requestId,
      () => missionStore.readCoverageClaim(query, requestId),
      missionStore.cancelCoverageQuery,
    ) as Promise<CoverageClaim>,
    deliverSelection: ({ missionId, chunks, requestId, signal }) => runCancelable(
      signal,
      requestId,
      () => missionStore.syncCoverageTileCatalog({
        missionId,
        chunks: chunks.map((chunk) => ({
          key: chunk.key,
          contentRev: chunk.contentRev,
        })),
      }, requestId),
      missionStore.cancelCoverageQuery,
    ) as Promise<CoverageTileCatalog>,
    readChunk: async () => {
      throw new Error('Candidate B does not deliver coverage through renderer GeoJSON pages.')
    },
    applyChunk: async () => {
      throw new Error('Candidate B delivery must be attested by the active tile catalog.')
    },
    publish: applyCoverageState,
  })
  applyCoverageController(controller)

  const updateMission = (): void => {
    void controller.updateContext({
      missionId: useMissionStore.getState().currentMission?.id ?? null,
      rendererGeneration,
    })
  }
  const unsubscribeMission = useMissionStore.subscribe(updateMission)
  const subscribeCoverageChanged = options.subscribeCoverageChanged ??
    ((listener: (event: CoverageChangedEvent) => void) =>
      window.sartrackerElectron?.onCoverageChanged?.(listener) ?? (() => undefined))
  const unsubscribeChanged = subscribeCoverageChanged((event) => {
    void controller.notifyChanged(event.missionId, event.changeSeq)
  })
  const schedulePeriodicRefresh = options.schedulePeriodicRefresh ??
    ((callback: () => void, intervalMs: number) => {
      const handle = setInterval(callback, intervalMs)
      return () => clearInterval(handle)
    })
  const cancelPeriodicRefresh = schedulePeriodicRefresh(() => {
    void controller.refresh()
  }, COVERAGE_REFRESH_INTERVAL_MS)
  updateMission()

  return () => {
    unsubscribeMission()
    unsubscribeChanged()
    cancelPeriodicRefresh()
    controller.stop()
    applyCoverageController(null)
  }
}

/** Returns whether the runtime exposes every Candidate-B safety boundary. */
export function hasCoverageRuntimeBoundary(
  missionStore: Partial<CoverageRuntimeMissionStore>,
): missionStore is CoverageRuntimeMissionStore {
  return typeof missionStore.readCoverageManifest === 'function' &&
    typeof missionStore.readCoverageClaim === 'function' &&
    typeof missionStore.syncCoverageTileCatalog === 'function' &&
    typeof missionStore.cancelCoverageQuery === 'function'
}

async function runCancelable<T>(
  signal: AbortSignal,
  requestId: string,
  run: () => Promise<T>,
  cancel: (requestId: string) => Promise<boolean>,
): Promise<T> {
  const handleAbort = () => { void cancel(requestId).catch(() => undefined) }
  signal.addEventListener('abort', handleAbort, { once: true })
  try {
    const result = await run()
    if (signal.aborted) throw createAbortError()
    return result
  } catch (error) {
    if (signal.aborted) throw createAbortError()
    throw error
  } finally {
    signal.removeEventListener('abort', handleAbort)
  }
}

function createAbortError(): Error {
  const error = new Error('Coverage request was cancelled.')
  error.name = 'AbortError'
  return error
}

function createRendererGeneration(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
