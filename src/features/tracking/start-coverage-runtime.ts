import type {
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createMapOverlaySyncWarning } from '../../lib/map-health'
import { recordDiagnosticEvent } from '../diagnostics/diagnostic-event-log'
import { useMapOverlayWarningStore } from '../map/map-overlay-warning-store'
import { isCoverageEnabled } from '../runtime/coverage-flag'
import { useMissionStore } from '../mission/mission-store'
import { createCoverageController } from './coverage-controller'
import { createCoverageStalenessMonitor } from './coverage-staleness-monitor'
import { useIngestHealthStore } from './ingest-health-store'
import {
  applyCoverageController,
  applyCoverageState,
  resetCoverageStore,
} from './coverage-store'
import { useCoverageFilterStore } from './coverage-filter-store'

const COVERAGE_REFRESH_INTERVAL_MS = 30_000

export type CoverageRuntimeMissionStore = Pick<
  Required<MissionStore>,
  | 'readCoverageManifest'
  | 'readCoverageClaim'
  | 'syncCoverageTileCatalog'
  | 'activateCoverageTileCatalog'
  | 'finalizeCoverageTileCatalog'
  | 'discardCoverageTileCatalog'
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
    readonly subscribeIngestEvidenceHealth?: (listener: () => void) => () => void
    readonly subscribeCoverageRendererFailure?: (listener: () => void) => () => void
    readonly schedulePeriodicRefresh?: (
      callback: () => void,
      intervalMs: number,
    ) => () => void
  } = {},
): () => void {
  if ((options.enabled ?? isCoverageEnabled()) === false) {
    resetCoverageStore()
    useCoverageFilterStore.getState().resetMission(null)
    return () => undefined
  }
  if (!hasCoverageRuntimeBoundary(missionStore)) {
    throw new Error('Complete coverage storage is unavailable in this runtime.')
  }
  const rendererGeneration = options.rendererGeneration ?? createRendererGeneration()
  const stalenessMonitor = createCoverageStalenessMonitor({
    onPersistent: ({ staleForMs, staleResults }) => {
      useMapOverlayWarningStore.getState().raiseWarning(
        createMapOverlaySyncWarning('coverage-history', 'coverage'),
      )
      void recordDiagnosticEvent({
        level: 'warn',
        category: 'tracking',
        event: 'coverage_refresh_persistently_stale',
        fields: { staleForMs, staleResults },
      })
    },
    onRecovered: ({ reason, staleForMs }) => {
      useMapOverlayWarningStore.getState().clearWarning('coverage-history')
      void recordDiagnosticEvent({
        level: 'info',
        category: 'tracking',
        event: 'coverage_refresh_stale_recovered',
        fields: { reason, staleForMs },
      })
    },
  })
  const controller = createCoverageController({
    readManifest: (missionId, requestId, signal) => runCancelable(
      signal,
      requestId,
      () => missionStore.readCoverageManifest(missionId, requestId),
      missionStore.cancelCoverageQuery,
    ),
    readClaim: (query, requestId, signal) => runCancelable(
      signal,
      requestId,
      () => missionStore.readCoverageClaim(query, requestId),
      missionStore.cancelCoverageQuery,
    ),
    readCompletenessBlockers: readRendererEvidenceBlockers,
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
    ),
    activateCatalog: async (catalog) => {
      if (catalog.activationId === undefined) return
      await missionStore.activateCoverageTileCatalog({
        activationId: catalog.activationId,
      })
    },
    finalizeCatalog: async (catalog) => {
      if (catalog.activationId === undefined) return
      await missionStore.finalizeCoverageTileCatalog({
        activationId: catalog.activationId,
      })
    },
    discardCatalog: async (catalog) => {
      if (catalog.activationId === undefined) return
      await missionStore.discardCoverageTileCatalog({
        activationId: catalog.activationId,
      })
    },
    readChunk: async () => {
      throw new Error('Candidate B does not deliver coverage through renderer GeoJSON pages.')
    },
    applyChunk: async () => {
      throw new Error('Candidate B delivery must be attested by the active tile catalog.')
    },
    publish: (state) => {
      applyCoverageState(state)
      stalenessMonitor.observe(state)
      if (state.status !== 'inactive' && state.manifest !== null) {
        useCoverageFilterStore.getState().reconcile(state.missionId, state.manifest)
      }
    },
  })
  applyCoverageController(controller)

  const updateMission = (): void => {
    const missionId = useMissionStore.getState().currentMission?.id ?? null
    useCoverageFilterStore.getState().resetMission(missionId)
    const filters = useCoverageFilterStore.getState()
    void controller.updateContext({
      missionId,
      rendererGeneration,
      omittedDeviceIds: filters.omittedDeviceIds,
      omittedPeriodKeys: filters.omittedPeriodKeys,
    })
  }
  const unsubscribeMission = useMissionStore.subscribe(updateMission)
  const unsubscribeFilters = useCoverageFilterStore.subscribe(updateMission)
  const subscribeCoverageChanged = options.subscribeCoverageChanged ??
    ((listener: (event: CoverageChangedEvent) => void) =>
      window.sartrackerElectron?.onCoverageChanged?.(listener) ?? (() => undefined))
  const unsubscribeChanged = subscribeCoverageChanged((event) => {
    void controller.notifyChanged(event.missionId, event.changeSeq)
  })
  const subscribeCoverageRendererFailure = options.subscribeCoverageRendererFailure ??
    ((listener: () => void) =>
      window.sartrackerElectron?.onCoverageRendererFailed?.(listener) ?? (() => undefined))
  const unsubscribeCoverageRendererFailure = subscribeCoverageRendererFailure(() => {
    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.')
  })
  const subscribeIngestEvidenceHealth = options.subscribeIngestEvidenceHealth ??
    ((listener: () => void) => {
      let prior = readRendererEvidenceBlockers()[0] ?? null
      return useIngestHealthStore.subscribe(() => {
        const next = readRendererEvidenceBlockers()[0] ?? null
        if (next === prior) return
        prior = next
        listener()
      })
    })
  const unsubscribeIngestEvidenceHealth = subscribeIngestEvidenceHealth(() => {
    void controller.refresh()
  })
  const schedulePeriodicRefresh = options.schedulePeriodicRefresh ??
    ((callback: () => void, intervalMs: number) => {
      const handle = setInterval(callback, intervalMs)
      return () => clearInterval(handle)
    })
  const cancelPeriodicRefresh = schedulePeriodicRefresh(() => {
    void controller.refresh({ automatic: true })
  }, COVERAGE_REFRESH_INTERVAL_MS)
  updateMission()

  return () => {
    unsubscribeMission()
    unsubscribeFilters()
    unsubscribeChanged()
    unsubscribeCoverageRendererFailure()
    unsubscribeIngestEvidenceHealth()
    cancelPeriodicRefresh()
    // Before the controller publishes inactive, so the log says why it ended.
    stalenessMonitor.stop()
    controller.stop()
    useCoverageFilterStore.getState().resetMission(null)
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
    typeof missionStore.activateCoverageTileCatalog === 'function' &&
    typeof missionStore.finalizeCoverageTileCatalog === 'function' &&
    typeof missionStore.discardCoverageTileCatalog === 'function' &&
    typeof missionStore.cancelCoverageQuery === 'function'
}

/** Returns renderer-memory evidence blockers at the final Complete decision. */
function readRendererEvidenceBlockers(): readonly string[] {
  const evidenceHealth = useIngestHealthStore.getState().evidenceHealth
  if (evidenceHealth.state === 'healthy') return []
  return [evidenceHealth.reason === 'renderer_evidence_pending'
    ? 'renderer_evidence_pending'
    : 'renderer_evidence_degraded']
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
