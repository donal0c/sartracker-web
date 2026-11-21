import type {
  CoverageChunkKey,
  CoverageClaim,
  CoverageManifest,
  CoverageManifestChunk,
  CoverageReadResult,
  CoverageStaleResult,
  CoverageTileCatalog,
  Position,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createCoverageScheduler } from './coverage-scheduler'
import type { CoverageRendererUnavailableFailure } from './coverage-renderer-failure'
import {
  classifyCoverageError,
  isCoverageCancellation,
  requireCoverageSequence,
  type CoverageErrorClass,
} from './coverage-diagnostics'
import { createCoverageCatalogActivation } from './coverage-catalog-activation'
import { createCoverageCatalogDeliveryBatches } from './coverage-catalog-delivery-plan'
import { coverageChunkIdentity } from './coverage-identity'
import {
  calculateCoverageProgress,
  calculateDrawnFixCount,
  COVERAGE_CATCH_UP_STALL_MS,
  coverageChunkFixCount,
} from './coverage-progress'
import {
  selectCoverageManifestChunks,
  type CoverageOmissions,
} from './coverage-filter-selection'
import type {
  CoverageRendererFailure,
  CoverageRendererFailureSource,
} from './coverage-tile-protocol'

export const COVERAGE_CHUNK_PAGE_LIMIT = 10_000
const AUTOMATIC_REFRESH_COOLDOWN_MS = 30_000
/**
 * Automatic renderer recovery keeps trying while the failure stays visible,
 * backing off so a persistently failing map is not hammered [DON-338 REN-4].
 */
const AUTOMATIC_RENDERER_RETRY_DELAYS_MS = [250, 5_000, 15_000, 30_000] as const

export type CoverageDelivery = Readonly<Record<string, number>>

export type CoverageState =
  | { readonly status: 'inactive' }
  | {
      readonly status: 'loading' | 'partial' | 'complete' | 'error'
      readonly missionId: string
      readonly rendererGeneration: string
      readonly changeSeq: number
      readonly latestObservedChangeSeq: number
      readonly manifest: CoverageManifest | null
      readonly tileCatalog: CoverageTileCatalog | null
      readonly delivered: CoverageDelivery
      readonly deliveredFixCount: number
      readonly totalFixCount: number
      readonly lastErrorClass?: CoverageErrorClass | null
      readonly retryableStaleCount?: number
      readonly blockers?: readonly string[]
      readonly updatedAt?: string
      readonly message?: string
      /**
       * Fixes the map draws for the selected scope, counting a chunk whose
       * drawn revision is older than the current one at its drawn size.
       */
      readonly drawnFixCount?: number
      /** True while a load runs or an automatic refresh or retry is queued. */
      readonly updating?: boolean
      /** True when the line has been behind without any redraw for the stall interval. */
      readonly stalled?: boolean
    }

type CoverageContext = {
  readonly missionId: string | null
  readonly rendererGeneration: string
  readonly omittedDeviceIds?: readonly string[]
  readonly omittedPeriodKeys?: readonly string[]
}

type NormalizedCoverageContext = Omit<CoverageContext, 'omittedDeviceIds' | 'omittedPeriodKeys'> &
  CoverageOmissions

type CoverageChunkPayload = {
  readonly key: CoverageChunkKey
  readonly contentRev: number
  readonly positions: readonly Position[]
}

export type CoverageController = {
  readonly updateContext: (context: CoverageContext) => Promise<void>
  readonly refresh: (options?: { readonly automatic: boolean }) => Promise<void>
  readonly notifyChanged: (missionId: string, changeSeq: number) => Promise<void>
  readonly notifyCatalogApplied: (
    catalog: CoverageTileCatalog,
    rendererActivation?: CoverageRendererActivation,
  ) => Promise<void>
  readonly notifySelectionApplied: (
    selectedKeys?: readonly CoverageChunkKey[],
  ) => Promise<void>
  readonly notifyRendererFailure: (failure: CoverageRendererFailure) => void
  /**
   * Reports that the tile renderer (worker) is gone. `failure` carries only an
   * allow-listed code from the main process, never raw error text.
   */
  readonly notifyRendererUnavailable: (
    message: string,
    failure?: CoverageRendererUnavailableFailure,
  ) => void
  readonly notifyRendererDetached: (catalog?: CoverageTileCatalog) => void
  readonly cancel: () => void
  readonly resume: () => Promise<void>
  readonly stop: () => void
  readonly getState: () => CoverageState
}

export type CoverageRendererActivation = {
  readonly failureSources?: readonly CoverageRendererFailureSource[]
  readonly commit: () => void
  readonly finalize?: () => void
  readonly rollback: () => void
}

/**
 * Owns the renderer-generation delivery attestation independently of durable
 * SQLite build metadata. It never treats a built row as rendered geometry.
 */
export function createCoverageController(input: {
  readonly monotonicNow?: () => number
  readonly readManifest: (
    missionId: string,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<CoverageReadResult<CoverageManifest>>
  readonly readChunk: (
    query: {
      readonly missionId: string
      readonly key: CoverageChunkKey
      readonly expectedContentRev: number
      readonly cursor?: { readonly timestamp: string; readonly id: string }
      readonly limit: number
    },
    requestId: string,
    signal: AbortSignal,
  ) => Promise<{
    readonly contentRev: number
    readonly positions: readonly Position[]
    readonly nextCursor: { readonly timestamp: string; readonly id: string } | null
  }>
  readonly readClaim: (
    query: { readonly missionId: string; readonly selectedKeys: readonly CoverageChunkKey[] },
    requestId: string,
    signal: AbortSignal,
  ) => Promise<CoverageClaim>
  readonly readCompletenessBlockers?: () => readonly string[]
  readonly applyChunk: (payload: CoverageChunkPayload) => Promise<void>
  readonly deliverSelection?: (input: {
    readonly missionId: string
    readonly manifest: CoverageManifest
    readonly chunks: readonly CoverageManifestChunk[]
    readonly requestId: string
    readonly signal: AbortSignal
  }) => Promise<CoverageReadResult<CoverageTileCatalog>>
  readonly activateCatalog?: (catalog: CoverageTileCatalog) => Promise<void>
  readonly finalizeCatalog?: (catalog: CoverageTileCatalog) => Promise<void>
  readonly discardCatalog?: (catalog: CoverageTileCatalog) => Promise<void>
  readonly publish: (state: CoverageState) => void
}): CoverageController {
  const monotonicNow = input.monotonicNow ?? (() => performance.now())
  let state: CoverageState = { status: 'inactive' }
  let context: NormalizedCoverageContext = normalizeContext({
    missionId: null,
    rendererGeneration: '',
  })
  let desiredContext: NormalizedCoverageContext = context
  let stopped = false
  let stopRequestedDuringFinalization = false
  let operationGeneration = 0
  let requestSequence = 0
  let activeController: AbortController | null = null
  let refreshRequested = false
  let automaticRefreshRequested = false
  let automaticRefreshTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let lastLoadFinishedAtMs = Number.NEGATIVE_INFINITY
  let retryableStaleCount = 0
  let lastErrorClass: CoverageErrorClass | null = null
  let finalizedCatalog: CoverageTileCatalog | null = null
  let finalizedRendererFailureSources: readonly CoverageRendererFailureSource[] = []
  let rendererDetached = false
  let rendererDetachedCompleteCatalog: CoverageTileCatalog | null = null
  let rendererDetachEpoch = 0
  let catalogFinalization: Promise<void> | null = null
  let pendingCatalogRelease: CoverageTileCatalog | null = null
  let catalogApplication: {
    readonly catalog: CoverageTileCatalog
    readonly promise: Promise<void>
  } | null = null
  let activeLoadCompletion: Promise<void> | null = null
  let contextUpdateSequence = 0
  let appliedSelectionKeySet: string | null = expectedSelectionKeySet(null, context)
  let cancelRequested = false
  /** Set by an operator Retry that re-staged the catalog; the map's acknowledgement then verifies with a load. */
  let verifyAfterReapply = false
  let rendererFailureDuringFinalization: Error | null = null
  let rendererFailureEpoch = 0
  let rendererRecoveryEpoch: number | null = null
  let rendererRecoverySupersededFailureKeys: ReadonlySet<string> | null = null
  let automaticRendererRecoveryAvailable = true
  let automaticRendererRecoveryAttempts = 0
  /** Owner of the single pending automatic renderer recovery attempt, if any. */
  let scheduledRendererRecovery: {
    readonly missionId: string
    readonly rendererGeneration: string
  } | null = null
  /** Fix count recorded when the map accepted each chunk revision. */
  const drawnCounts = new Map<string, { readonly contentRev: number; readonly fixCount: number }>()
  let lastAdvanceAtMs = monotonicNow()
  let stallTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  const catalogActivation = createCoverageCatalogActivation()
  const scheduler = createCoverageScheduler({
    now: () => Date.now(),
    openOutingCooldownMs: 30_000,
  })

  const publish = (next: CoverageState): void => {
    if (next.status === 'inactive') {
      lastErrorClass = null
      retryableStaleCount = 0
      state = next
    } else {
      if (next.lastErrorClass !== undefined && next.lastErrorClass !== null) {
        lastErrorClass = next.lastErrorClass
      }
      const blockers = new Set(next.blockers ?? [])
      if (rendererDetached) blockers.add('renderer_detached')
      else blockers.delete('renderer_detached')
      const filterPending = appliedSelectionKeySet !== expectedSelectionKeySet(next.manifest, context)
      if (filterPending) blockers.add('renderer_filter_pending')
      else blockers.delete('renderer_filter_pending')
      const priorObservedSequence = state.status !== 'inactive' &&
        state.missionId === next.missionId && state.rendererGeneration === next.rendererGeneration
        ? state.latestObservedChangeSeq
        : 0
      const latestObservedChangeSeq = Math.max(next.latestObservedChangeSeq, priorObservedSequence)
      const status = (rendererDetached || filterPending || next.changeSeq < latestObservedChangeSeq) &&
        next.status === 'complete'
        ? 'partial'
        : next.status
      if (status === 'complete') {
        lastAdvanceAtMs = monotonicNow()
        verifyAfterReapply = false
      }
      state = {
        ...next,
        latestObservedChangeSeq,
        status,
        blockers: [...blockers],
        lastErrorClass,
        retryableStaleCount,
        drawnFixCount: calculateDrawnFixCount({
          chunks: next.manifest === null ? [] : selectChunks(next.manifest, context),
          delivered: next.delivered,
          drawnCounts,
        }),
        updating: isUpdating(),
        stalled: (status === 'loading' || status === 'partial') &&
          monotonicNow() - lastAdvanceAtMs >= COVERAGE_CATCH_UP_STALL_MS,
      }
    }
    armStallWatchdog()
    input.publish(state)
  }

  /** Reports whether coverage work will continue without the operator. */
  function isUpdating(): boolean {
    return activeController !== null ||
      automaticRefreshTimer !== null ||
      refreshRequested ||
      scheduledRendererRecovery !== null
  }

  /** Republishes when queued work started or stopped without another state change. */
  function refreshUpdatingFlag(): void {
    if (state.status === 'inactive' || state.updating === isUpdating()) return
    publish({ ...state })
  }

  /**
   * Re-evaluates a behind line once it has gone the stall interval without a
   * redraw, so a stuck update becomes visible even when nothing else changes.
   */
  function armStallWatchdog(): void {
    const behind = state.status === 'loading' || state.status === 'partial'
    if (!behind || state.status === 'inactive' || state.stalled === true || stopped) {
      if (stallTimer !== null) globalThis.clearTimeout(stallTimer)
      stallTimer = null
      return
    }
    if (stallTimer !== null) return
    const delay = Math.max(0, lastAdvanceAtMs + COVERAGE_CATCH_UP_STALL_MS - monotonicNow())
    stallTimer = globalThis.setTimeout(() => {
      stallTimer = null
      if (state.status === 'loading' || state.status === 'partial') publish({ ...state })
    }, delay)
  }

  /** Records that the map now draws `chunk` at its current revision. */
  function recordDrawn(chunk: CoverageManifestChunk): void {
    const identity = coverageChunkIdentity(chunk.key)
    const prior = drawnCounts.get(identity)
    if (prior?.contentRev !== chunk.contentRev) lastAdvanceAtMs = monotonicNow()
    drawnCounts.set(identity, { contentRev: chunk.contentRev, fixCount: coverageChunkFixCount(chunk) })
  }

  /**
   * Orders chunks whose current revision is not drawn. A chunk with nothing
   * drawn at all bypasses the open-outing rebuild cooldown, so a renderer
   * restart or a new device never leaves a period off the map [DON-338 REN-5].
   */
  function orderPendingChunks(
    manifest: CoverageManifest,
    chunks: readonly CoverageManifestChunk[],
    delivered: Readonly<Record<string, number>>,
    bypassOpenOutingCooldown: boolean,
  ): readonly CoverageManifestChunk[] {
    const undrawn = chunks.filter((chunk) =>
      delivered[coverageChunkIdentity(chunk.key)] !== chunk.contentRev)
    const ready = new Set(scheduler.order(manifest, undrawn, { bypassOpenOutingCooldown })
      .map((chunk) => coverageChunkIdentity(chunk.key)))
    for (const chunk of undrawn) {
      if (delivered[coverageChunkIdentity(chunk.key)] === undefined) {
        ready.add(coverageChunkIdentity(chunk.key))
      }
    }
    return scheduler.order(
      manifest,
      undrawn.filter((chunk) => ready.has(coverageChunkIdentity(chunk.key))),
      { bypassOpenOutingCooldown: true },
    )
  }

  /** Drops background work when an operator action or ownership boundary supersedes it. */
  const clearAutomaticRefresh = (): void => {
    if (automaticRefreshTimer !== null) globalThis.clearTimeout(automaticRefreshTimer)
    automaticRefreshTimer = null
    automaticRefreshRequested = false
  }

  /** Leaves a full quiet interval after each completed load, including slow or stale reads. */
  const scheduleAutomaticRefresh = (): void => {
    if (activeController !== null || stopped || context.missionId === null) return
    // The dedicated renderer retry owns fresh-source recovery after a failure.
    // Every settle point re-arms it, so one failed attempt never ends the
    // retries silently [DON-338].
    if (state.status === 'error' && rendererRecoveryEpoch !== null) {
      scheduleAutomaticRendererRecovery(null, context.missionId, context.rendererGeneration)
      return
    }
    if (!automaticRefreshRequested || automaticRefreshTimer !== null) return
    const delay = Math.max(0, lastLoadFinishedAtMs + AUTOMATIC_REFRESH_COOLDOWN_MS - monotonicNow())
    automaticRefreshTimer = globalThis.setTimeout(() => {
      automaticRefreshTimer = null
      if (!automaticRefreshRequested || stopped || context.missionId === null) {
        refreshUpdatingFlag()
        return
      }
      automaticRefreshRequested = false
      void runLoad(true)
    }, delay)
    refreshUpdatingFlag()
  }

  /** Retains prior geometry as Partial; an observed sequence is never delivery proof. */
  const publishStaleResult = (result?: CoverageStaleResult): void => {
    if (state.status === 'inactive') return
    // Throws before any state changes, so a malformed race cannot poison the observed sequence.
    if (result !== undefined) requireCoverageSequence(result.changeSeq, 'stale result')
    retryableStaleCount = Math.min(Number.MAX_SAFE_INTEGER, retryableStaleCount + 1)
    automaticRefreshRequested = true
    publish({
      ...withFinalizedCatalog(asPartialState(state), finalizedCatalog),
      latestObservedChangeSeq: Math.max(state.latestObservedChangeSeq, result?.changeSeq ?? 0),
      lastErrorClass: 'chunk_stale',
    })
  }

  /** Completes controller teardown after any irreversible handoff has settled. */
  const settleStoppedState = (): void => {
    stopRequestedDuringFinalization = false
    activeController?.abort()
    activeController = null
    operationGeneration += 1
    refreshRequested = false
    clearAutomaticRefresh()
    cancelRequested = false
    finalizedCatalog = null
    finalizedRendererFailureSources = []
    rendererDetached = false
    rendererDetachedCompleteCatalog = null
    rendererRecoveryEpoch = null
    rendererRecoverySupersededFailureKeys = null
    automaticRendererRecoveryAvailable = false
    scheduledRendererRecovery = null
    rendererFailureDuringFinalization = null
    pendingCatalogRelease = null
    verifyAfterReapply = false
    drawnCounts.clear()
    publish({ status: 'inactive' })
  }

  /** Retries one post-renderer predecessor release before another catalog build. */
  const releasePendingCatalogPredecessor = async (): Promise<void> => {
    const catalog = pendingCatalogRelease
    if (catalog === null) return
    const finalization = input.finalizeCatalog?.(catalog) ?? Promise.resolve()
    catalogFinalization = finalization
    try {
      await finalization
      if (pendingCatalogRelease === catalog) pendingCatalogRelease = null
    } finally {
      if (catalogFinalization === finalization) catalogFinalization = null
    }
  }

  const runLoad = async (
    retainDelivery: boolean,
    bypassOpenOutingCooldown = false,
  ): Promise<void> => {
    if (stopped || context.missionId === null) return
    clearAutomaticRefresh()
    rendererFailureDuringFinalization = null
    rendererDetachedCompleteCatalog = null
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    let resolveLoadCompletion: () => void = () => undefined
    const loadCompletion = new Promise<void>((resolve) => {
      resolveLoadCompletion = resolve
    })
    activeLoadCompletion = loadCompletion
    const operation = ++operationGeneration
    const missionId = context.missionId
    const rendererGeneration = context.rendererGeneration
    const recoveryEpochAtLoad = rendererRecoveryEpoch
    const priorManifest = state.status === 'inactive' ? null : state.manifest
    const priorDelivered = state.status === 'inactive' ? {} : state.delivered
    const retainDeliveryAttestation = retainDelivery && rendererRecoveryEpoch === null
    const priorCatalog = state.status === 'inactive' || !retainDelivery
      ? null
      : finalizedCatalog
    const observedSequence = state.status === 'inactive' ? 0 : state.latestObservedChangeSeq
    publish(createActiveState({
      status: 'loading', missionId, rendererGeneration,
      changeSeq: state.status === 'inactive' ? 0 : state.changeSeq,
      latestObservedChangeSeq: observedSequence,
      manifest: priorManifest,
      tileCatalog: priorCatalog,
      delivered: retainDeliveryAttestation ? priorDelivered : {},
    }, context))

    try {
      await releasePendingCatalogPredecessor()
      if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
      const manifestResult = await input.readManifest(
        missionId,
        nextRequestId('manifest'),
        controller.signal,
      )
      if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
      if (isCoverageStaleResult(manifestResult)) {
        publishStaleResult(manifestResult)
        return
      }
      const manifest = manifestResult
      requireCoverageSequence(manifest.changeSeq, 'manifest')
      const selected = selectChunks(manifest, context)
      const delivered = retainUnchangedDeliveries(
        priorManifest,
        manifest,
        retainDeliveryAttestation ? priorDelivered : {},
      )
      const latestObservedChangeSeq = Math.max(observedSequence, manifest.changeSeq)
      publish(createActiveState({
        status: 'loading', missionId, rendererGeneration,
        changeSeq: manifest.changeSeq,
        latestObservedChangeSeq,
        manifest,
        tileCatalog: priorCatalog,
        delivered,
      }, context))

      let activeManifest = manifest
      let activeSelected = selected
      let activeCatalog = priorCatalog
      if (input.deliverSelection !== undefined) {
        const pending = orderPendingChunks(
          manifest,
          manifest.chunks,
          delivered,
          bypassOpenOutingCooldown,
        )
        const catalogBatches = recoveryEpochAtLoad === null
          ? createCoverageCatalogDeliveryBatches({
              manifest,
              priorManifest,
              priorDelivered: retainDeliveryAttestation ? priorDelivered : {},
              retainDelivery: retainDeliveryAttestation,
              orderedPending: pending,
            })
          : (pending.length === 0 ? [] : [manifest.chunks])
        for (const descriptor of pending) scheduler.recordAttempt(descriptor)
        for (const [batchIndex, chunks] of catalogBatches.entries()) {
          const deliveredCatalog = await input.deliverSelection({
            missionId,
            manifest,
            chunks,
            requestId: nextRequestId('catalog'),
            signal: controller.signal,
          })
          if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
          if (isCoverageStaleResult(deliveredCatalog)) {
            publishStaleResult(deliveredCatalog)
            return
          }
          activeCatalog = {
            ...deliveredCatalog,
            requiresFreshRendererSources: recoveryEpochAtLoad !== null,
            retainPriorPeriods: priorCatalog !== null &&
              batchIndex < catalogBatches.length - 1,
          }
          if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
          const activation = catalogActivation.wait(activeCatalog, controller.signal)
          publish(createActiveState({
            status: 'loading', missionId, rendererGeneration,
            changeSeq: manifest.changeSeq,
            latestObservedChangeSeq,
            manifest,
            tileCatalog: activeCatalog,
            delivered,
          }, context))
          try {
            await activation
          } catch (error) {
            await input.discardCatalog?.(activeCatalog).catch(() => undefined)
            throw error
          }
          if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
          const currentChunks = new Map(manifest.chunks.map((chunk) => [
            coverageChunkIdentity(chunk.key), chunk,
          ]))
          for (const entry of activeCatalog.delivered) {
            const identity = coverageChunkIdentity(entry.key)
            const current = currentChunks.get(identity)
            if (current?.contentRev === entry.contentRev) {
              delivered[identity] = entry.contentRev
              recordDrawn(current)
            }
          }
          publish(createActiveState({
            status: 'loading', missionId, rendererGeneration,
            changeSeq: manifest.changeSeq,
            latestObservedChangeSeq,
            manifest,
            tileCatalog: activeCatalog,
            delivered,
          }, context))
        }
        if (
          recoveryEpochAtLoad !== null &&
          rendererRecoveryEpoch === recoveryEpochAtLoad
        ) {
          rendererRecoveryEpoch = null
          rendererRecoverySupersededFailureKeys = null
          automaticRendererRecoveryAvailable = true
          automaticRendererRecoveryAttempts = 0
        }
        const refreshedManifest = await input.readManifest(
          missionId,
          nextRequestId('manifest'),
          controller.signal,
        )
        if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
        if (isCoverageStaleResult(refreshedManifest)) {
          publishStaleResult(refreshedManifest)
          return
        }
        requireCoverageSequence(refreshedManifest.changeSeq, 'manifest')
        activeManifest = refreshedManifest
        activeSelected = selectChunks(activeManifest, context)
      } else {
        for (const descriptor of orderPendingChunks(
          manifest,
          selected,
          delivered,
          bypassOpenOutingCooldown,
        )) {
          const identity = coverageChunkIdentity(descriptor.key)
          if (delivered[identity] === descriptor.contentRev) continue
          scheduler.recordAttempt(descriptor)
          const payload = await readWholeChunk(
            missionId,
            descriptor,
            controller,
            operation,
            rendererGeneration,
          )
          if (payload === null) return
          await input.applyChunk(payload)
          if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
          delivered[identity] = descriptor.contentRev
          recordDrawn(descriptor)
          publish(createActiveState({
            status: 'loading', missionId, rendererGeneration,
            changeSeq: manifest.changeSeq,
            latestObservedChangeSeq,
            manifest,
            tileCatalog: activeCatalog,
            delivered,
          }, context))
        }
      }
      const claimSequence = Math.max(
        latestObservedChangeSeq,
        activeManifest.changeSeq,
      )
      publish(createActiveState({
        status: 'loading', missionId, rendererGeneration,
        changeSeq: activeManifest.changeSeq,
        latestObservedChangeSeq: claimSequence,
        manifest: activeManifest,
        tileCatalog: activeCatalog,
        delivered,
      }, context))

      const claim = await input.readClaim(
        { missionId, selectedKeys: activeSelected.map((chunk) => chunk.key) },
        nextRequestId('claim'),
        controller.signal,
      )
      if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
      requireCoverageSequence(claim.changeSeq, 'claim')
      const currentObservedSequence = state.status === 'inactive'
        ? claimSequence
        : state.latestObservedChangeSeq
      const finalSequence = Math.max(claimSequence, currentObservedSequence)
      const rendererBlockers = input.readCompletenessBlockers?.() ?? []
      const deferredRendererFailure = rendererFailureDuringFinalization
      const complete = deferredRendererFailure === null &&
        rendererRecoveryEpoch === null &&
        claim.databaseReady &&
        !rendererDetached &&
        !cancelRequested &&
        rendererBlockers.length === 0 &&
        appliedSelectionKeySet === expectedSelectionKeySet(activeManifest, context) &&
        !refreshRequested &&
        claim.changeSeq === finalSequence &&
        claimCoversSelection(claim.chunkRevisions, activeSelected, delivered)
      if (complete) automaticRefreshRequested = false
      // A chunk revision that moved past what was drawn is caught up by the
      // normal cadence even when no further change notification arrives.
      else if (
        deferredRendererFailure === null &&
        activeSelected.some((chunk) =>
          delivered[coverageChunkIdentity(chunk.key)] !== chunk.contentRev)
      ) automaticRefreshRequested = true
      publish(createActiveState({
        status: deferredRendererFailure !== null
          ? 'error'
          : complete ? 'complete' : 'partial',
        missionId,
        rendererGeneration,
        changeSeq: claim.changeSeq,
        latestObservedChangeSeq: finalSequence,
        manifest: activeManifest,
        tileCatalog: activeCatalog,
        delivered,
        blockers: [...new Set([...claim.blockers, ...rendererBlockers])],
        ...(deferredRendererFailure === null
          ? {}
          : {
              lastErrorClass: classifyCoverageError(deferredRendererFailure),
              message: 'Complete mission history is temporarily unavailable. Existing coverage remains shown.',
            }),
      }, context))
    } catch (error) {
      if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
      if (state.status === 'inactive') return
      if (controller.signal.aborted || isAbortError(error)) {
        publish(withFinalizedCatalog(asPartialState(state), finalizedCatalog))
        return
      }
      if (classifyCoverageError(error) === 'chunk_stale') {
        // Older adapters may still reject expected races. Keep their safe
        // Partial behavior and use the same bounded automatic retry.
        publishStaleResult()
        return
      }
      // A failed load stays visible as an error and retries on the normal
      // cadence instead of waiting for the operator [DON-338 REN-4].
      if (rendererRecoveryEpoch === null) automaticRefreshRequested = true
      publish({
        ...withFinalizedCatalog(asPartialState(state), finalizedCatalog),
        status: 'error',
        lastErrorClass: classifyCoverageError(error),
        message: 'Complete mission history is temporarily unavailable. Existing coverage remains shown.',
      })
    } finally {
      if (stopRequestedDuringFinalization) {
        settleStoppedState()
      } else if (activeController === controller) {
        activeController = null
        lastLoadFinishedAtMs = monotonicNow()
        if (cancelRequested) {
          cancelRequested = false
          refreshRequested = false
          clearAutomaticRefresh()
          if (state.status !== 'inactive') {
            publish(withFinalizedCatalog(asPartialState(state), finalizedCatalog))
          }
        } else if (refreshRequested && !stopped && context.missionId !== null) {
          refreshRequested = false
          void runLoad(true)
        } else {
          scheduleAutomaticRefresh()
        }
        refreshUpdatingFlag()
      }
      resolveLoadCompletion()
      if (activeLoadCompletion === loadCompletion) activeLoadCompletion = null
    }
  }

  const requestRefresh = async (): Promise<void> => {
    clearAutomaticRefresh()
    if (activeController !== null) {
      refreshRequested = true
      return
    }
    await runLoad(true)
  }

  const readWholeChunk = async (
    missionId: string,
    descriptor: CoverageManifestChunk,
    controller: AbortController,
    operation: number,
    rendererGeneration: string,
  ): Promise<CoverageChunkPayload | null> => {
    const positions: Position[] = []
    let cursor: { readonly timestamp: string; readonly id: string } | undefined
    do {
      const page = await input.readChunk({
        missionId,
        key: descriptor.key,
        expectedContentRev: descriptor.contentRev,
        ...(cursor === undefined ? {} : { cursor }),
        limit: COVERAGE_CHUNK_PAGE_LIMIT,
      }, nextRequestId('chunk'), controller.signal)
      if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return null
      if (page.contentRev !== descriptor.contentRev) {
        throw new Error('Coverage chunk response revision did not match the request.')
      }
      positions.push(...page.positions)
      cursor = page.nextCursor ?? undefined
    } while (cursor !== undefined)
    return { key: descriptor.key, contentRev: descriptor.contentRev, positions }
  }

  const ownsOperation = (
    operation: number,
    controller: AbortController,
    missionId: string,
    rendererGeneration: string,
  ): boolean => !stopped &&
    operation === operationGeneration &&
    activeController === controller &&
    !controller.signal.aborted &&
    context.missionId === missionId &&
    context.rendererGeneration === rendererGeneration

  const nextRequestId = (kind: string): string =>
    `coverage-${kind}-${++requestSequence}`

  /**
   * Marks the renderer unavailable and queues the coalesced automatic
   * recovery, so every renderer failure (map source, finalization, worker
   * death) rebuilds without the operator [DON-338].
   */
  const publishRendererUnavailable = (message: string, failureCode?: string): void => {
    if (state.status === 'inactive') return
    const failedLoad = activeLoadCompletion
    const missionId = state.missionId
    const rendererGeneration = state.rendererGeneration
    publishRendererUnavailableState(message, failureCode)
    if (rendererRecoveryEpoch !== null) {
      scheduleAutomaticRendererRecovery(failedLoad, missionId, rendererGeneration)
    }
  }

  const publishRendererUnavailableState = (message: string, failureCode?: string): void => {
    if (state.status === 'inactive') return
    clearAutomaticRefresh()
    rendererDetached = false
    rendererDetachedCompleteCatalog = null
    const error: Error & { code?: string } = new Error(message)
    if (failureCode !== undefined) error.code = failureCode
    rendererRecoverySupersededFailureKeys = null
    rendererRecoveryEpoch = ++rendererFailureEpoch
    if (
      catalogFinalization !== null &&
      state.tileCatalog !== null &&
      catalogActivation.isPending(state.tileCatalog)
    ) {
      rendererFailureDuringFinalization = error
      publish({
        ...state,
        status: 'error',
        lastErrorClass: classifyCoverageError(error),
        message: 'Complete mission history is temporarily unavailable. Existing coverage remains shown.',
      })
      return
    }
    cancelRequested = false
    if (
      state.tileCatalog !== null &&
      catalogActivation.isPending(state.tileCatalog)
    ) {
      void input.discardCatalog?.(state.tileCatalog).catch(() => undefined)
    }
    catalogActivation.rejectPending(error)
    activeController?.abort()
    activeController = null
    operationGeneration += 1
    publish(createActiveState({
      status: 'error',
      missionId: state.missionId,
      rendererGeneration: state.rendererGeneration,
      changeSeq: state.changeSeq,
      latestObservedChangeSeq: state.latestObservedChangeSeq,
      manifest: state.manifest,
      tileCatalog: finalizedCatalog,
      delivered: {},
      ...(state.blockers === undefined
        ? {}
        : { blockers: state.blockers.filter((blocker) => blocker !== 'renderer_detached') }),
      lastErrorClass: classifyCoverageError(error),
      message: 'Complete mission history is temporarily unavailable. Existing coverage remains shown.',
    }, context))
  }

  /**
   * Queues one automatic renderer recovery after the failed load has unwound.
   * Coalesced: while an attempt is pending for this mission and renderer,
   * further failures join it, and the attempt rebuilds from whatever failure
   * is current when it runs. Backoff is capped, never exhausted.
   */
  const scheduleAutomaticRendererRecovery = (
    failedLoad: Promise<void> | null,
    missionId: string,
    rendererGeneration: string,
  ): void => {
    if (!automaticRendererRecoveryAvailable || stopped) return
    if (
      scheduledRendererRecovery !== null &&
      scheduledRendererRecovery.missionId === missionId &&
      scheduledRendererRecovery.rendererGeneration === rendererGeneration
    ) return
    const delay = AUTOMATIC_RENDERER_RETRY_DELAYS_MS[
      Math.min(automaticRendererRecoveryAttempts, AUTOMATIC_RENDERER_RETRY_DELAYS_MS.length - 1)
    ]
    automaticRendererRecoveryAttempts += 1
    const owner = { missionId, rendererGeneration }
    scheduledRendererRecovery = owner
    refreshUpdatingFlag()
    void (failedLoad ?? Promise.resolve()).then(async () => {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, delay)
      })
      // An operator Retry or a mission switch supersedes this attempt.
      if (scheduledRendererRecovery !== owner) return
      scheduledRendererRecovery = null
      if (
        stopped ||
        rendererRecoveryEpoch === null ||
        state.status !== 'error' ||
        context.missionId !== missionId ||
        context.rendererGeneration !== rendererGeneration
      ) {
        refreshUpdatingFlag()
        return
      }
      if (activeController !== null) {
        // A load is already running; its settle point re-arms recovery if it fails.
        refreshUpdatingFlag()
        return
      }
      await runLoad(true, true)
    }).catch(() => undefined)
  }

  /**
   * Operator Retry for a stalled map: when the map never reattached the
   * finalized catalog or never applied the selected filter, re-stage the same
   * catalog under a fresh object identity. The overlay hook re-runs on that
   * identity, reinstalls the sources, re-acknowledges the selection and the
   * catalog, and a verifying load follows [DON-338].
   */
  const reapplyFinalizedCatalog = (): void => {
    if (stopped || state.status === 'inactive' || finalizedCatalog === null) return
    const blockers = state.blockers ?? []
    if (!blockers.includes('renderer_detached') && !blockers.includes('renderer_filter_pending')) return
    if (!isCurrentCatalog(state, finalizedCatalog)) return
    const fresh: CoverageTileCatalog = { ...finalizedCatalog }
    if (
      rendererDetachedCompleteCatalog !== null &&
      isSameCatalog(rendererDetachedCompleteCatalog, fresh)
    ) rendererDetachedCompleteCatalog = fresh
    finalizedCatalog = fresh
    verifyAfterReapply = true
    publish({ ...state, tileCatalog: fresh })
  }

  const restoreRendererAttachment = (): void => {
    if (state.status !== 'partial' || !state.blockers?.includes('renderer_detached')) return
    const restoreComplete = rendererDetachedCompleteCatalog !== null &&
      isSameCatalog(finalizedCatalog, rendererDetachedCompleteCatalog) &&
      state.changeSeq === state.latestObservedChangeSeq &&
      activeController === null &&
      !refreshRequested
    rendererDetached = false
    rendererDetachedCompleteCatalog = null
    const verify = verifyAfterReapply
    verifyAfterReapply = false
    const blockers = state.blockers.filter((blocker) => blocker !== 'renderer_detached')
    publish({
      ...state,
      status: restoreComplete && blockers.length === 0 ? 'complete' : 'partial',
      blockers,
    })
    // publish() may still downgrade Complete (for example a pending filter).
    if (verify && !isCoverageComplete()) void requestRefresh()
  }

  /** Reads the current status without control-flow narrowing from an earlier guard. */
  function isCoverageComplete(): boolean {
    return state.status === 'complete'
  }

  /** Waits until an irreversible catalog finalization settles. */
  const waitForCatalogFinalization = async (): Promise<void> => {
    const pendingFinalization = catalogFinalization
    if (pendingFinalization === null) return
    await pendingFinalization.catch(() => undefined)
  }

  /** Applies one catalog through the backend and renderer ownership boundary. */
  const applyCatalog = async (
    catalog: CoverageTileCatalog,
    rendererActivation: CoverageRendererActivation,
  ): Promise<void> => {
    if (!catalogActivation.isPending(catalog)) {
      if (
        isCurrentCatalog(state, catalog) &&
        isSameCatalog(finalizedCatalog, catalog)
      ) {
        rendererActivation.commit()
        rendererActivation.finalize?.()
        finalizedRendererFailureSources = rendererActivation.failureSources ??
          coverageCatalogFailureSources(catalog)
        restoreRendererAttachment()
        return
      }
      rendererActivation.rollback()
      await input.discardCatalog?.(catalog).catch(() => undefined)
      return
    }
    let ownedFinalization: Promise<void> | null = null
    let rendererFinalizationStarted = false
    // The map has started applying this catalog; its own source and backend
    // limits now own failure, so the acceptance timeout must not fire mid-apply.
    catalogActivation.holdTimeout(catalog)
    try {
      const activationEpoch = rendererDetachEpoch
      await input.activateCatalog?.(catalog)
      if (rendererDetachEpoch !== activationEpoch) {
        throw new Error('Coverage map detached while its catalog was activating.')
      }
      if (!catalogActivation.isPending(catalog)) {
        rendererActivation.rollback()
        await input.discardCatalog?.(catalog).catch(() => undefined)
        return
      }
      rendererActivation.commit()
      rendererDetached = false
      rendererDetachedCompleteCatalog = null
      const attachmentEpoch = rendererDetachEpoch
      rendererFinalizationStarted = true
      try {
        rendererActivation.finalize?.()
      } catch (error) {
        const normalized = error instanceof Error
          ? error
          : new Error('Coverage renderer ownership finalization failed.')
        finalizedCatalog = catalog
        finalizedRendererFailureSources = rendererActivation.failureSources ??
          coverageCatalogFailureSources(catalog)
        catalogActivation.notifyApplied(catalog)
        publishRendererUnavailable(normalized.message)
        return
      }
      finalizedCatalog = catalog
      const finalization = input.finalizeCatalog?.(catalog) ?? Promise.resolve()
      ownedFinalization = finalization
      catalogFinalization = finalization
      await finalization
      if (!catalogActivation.isPending(catalog) || !isCurrentCatalog(state, catalog)) {
        return
      }
      if (rendererDetachEpoch === attachmentEpoch) rendererDetached = false
      catalogActivation.notifyApplied(catalog)
      finalizedRendererFailureSources = rendererActivation.failureSources ??
        coverageCatalogFailureSources(catalog)
    } catch (error) {
      const normalized = error instanceof Error
        ? error
        : new Error('Coverage catalog activation failed.')
      if (!catalogActivation.isPending(catalog)) {
        if (!rendererFinalizationStarted) rendererActivation.rollback()
        return
      }
      if (!rendererFinalizationStarted) {
        rendererActivation.rollback()
        await input.discardCatalog?.(catalog).catch(() => undefined)
      } else {
        finalizedCatalog = catalog
        pendingCatalogRelease = catalog
      }
      if (!catalogActivation.isPending(catalog)) return
      catalogActivation.reject(catalog, normalized)
      publishRendererUnavailable(normalized.message)
      throw normalized
    } finally {
      if (
        ownedFinalization !== null &&
        catalogFinalization === ownedFinalization
      ) catalogFinalization = null
    }
  }

  /** Coalesces repeated acknowledgements for the same staged catalog. */
  const notifyCatalogApplied = async (
    catalog: CoverageTileCatalog,
    rendererActivation: CoverageRendererActivation = {
      commit: () => undefined,
      finalize: () => undefined,
      rollback: () => undefined,
    },
  ): Promise<void> => {
    const inFlight = catalogApplication
    if (inFlight !== null && isSameCatalog(inFlight.catalog, catalog)) {
      try {
        await inFlight.promise
      } catch (error) {
        rendererActivation.rollback()
        throw error
      }
      if (isCurrentCatalog(state, catalog) && isSameCatalog(finalizedCatalog, catalog)) {
        rendererActivation.commit()
        rendererActivation.finalize?.()
        restoreRendererAttachment()
        return
      }
      rendererActivation.rollback()
      await input.discardCatalog?.(catalog).catch(() => undefined)
      return
    }

    const application = applyCatalog(catalog, rendererActivation)
    catalogApplication = { catalog, promise: application }
    try {
      await application
    } finally {
      if (catalogApplication?.promise === application) catalogApplication = null
    }
  }

  /** Applies the latest desired mission/filter context, optionally forcing Retry. */
  const applyDesiredContext = async (
    forceReload: boolean,
    bypassOpenOutingCooldown = false,
  ): Promise<void> => {
    const identityChanged = context.missionId !== desiredContext.missionId ||
      context.rendererGeneration !== desiredContext.rendererGeneration
    const selectionChanged = omissionSet(context) !== omissionSet(desiredContext)
    if (!identityChanged && !selectionChanged) {
      if (forceReload) await runLoad(true, bypassOpenOutingCooldown)
      return
    }
    rendererDetachedCompleteCatalog = null
    activeController?.abort()
    if (identityChanged) lastErrorClass = null
    if (identityChanged) retryableStaleCount = 0
    if (identityChanged) lastLoadFinishedAtMs = Number.NEGATIVE_INFINITY
    clearAutomaticRefresh()
    if (identityChanged) finalizedCatalog = null
    if (identityChanged) finalizedRendererFailureSources = []
    if (identityChanged) rendererDetached = false
    if (identityChanged) {
      rendererRecoveryEpoch = null
      rendererRecoverySupersededFailureKeys = null
    }
    if (identityChanged) automaticRendererRecoveryAvailable = true
    if (identityChanged) automaticRendererRecoveryAttempts = 0
    if (identityChanged) scheduledRendererRecovery = null
    if (identityChanged) verifyAfterReapply = false
    if (identityChanged) rendererFailureDuringFinalization = null
    if (identityChanged) {
      drawnCounts.clear()
      lastAdvanceAtMs = monotonicNow()
    }
    operationGeneration += 1
    refreshRequested = false
    context = desiredContext
    if (identityChanged) appliedSelectionKeySet = expectedSelectionKeySet(null, context)
    if (context.missionId === null) {
      publish({ status: 'inactive' })
      return
    }
    await runLoad(!identityChanged)
  }

  return {
    updateContext: async (nextContext) => {
      const normalizedContext = normalizeContext(nextContext)
      const desiredIdentityChanged = desiredContext.missionId !== normalizedContext.missionId ||
        desiredContext.rendererGeneration !== normalizedContext.rendererGeneration
      const desiredSelectionChanged = omissionSet(desiredContext) !== omissionSet(normalizedContext)
      if (!desiredIdentityChanged && !desiredSelectionChanged) return
      if (!desiredIdentityChanged && desiredSelectionChanged && state.status !== 'inactive') {
        appliedSelectionKeySet = null
        publish(createActiveState({ ...state, status: 'partial' }, normalizedContext))
      }
      desiredContext = normalizedContext
      const updateSequence = ++contextUpdateSequence
      await waitForCatalogFinalization()
      if (stopped || updateSequence !== contextUpdateSequence) return
      await applyDesiredContext(false)
    },
    refresh: async (options) => {
      if (options?.automatic !== true) return requestRefresh()
      if (activeController !== null) return
      automaticRefreshRequested = true
      scheduleAutomaticRefresh()
    },
    notifyChanged: async (missionId, changeSeq) => {
      if (
        stopped ||
        context.missionId !== missionId ||
        !Number.isSafeInteger(changeSeq) ||
        state.status === 'inactive' ||
        changeSeq <= state.latestObservedChangeSeq
      ) return
      rendererDetachedCompleteCatalog = null
      publish({
        ...state,
        // New evidence revokes Complete but cannot clear a display/load failure
        // or disqualify the renderer's separate prompt recovery attempt.
        status: state.status === 'error' ? 'error' : 'partial',
        latestObservedChangeSeq: changeSeq,
      })
      // Error recovery owns its retry timing and fresh renderer sources.
      // A live fix is not evidence that the failed display/load recovered.
      if (state.status === 'error') return
      automaticRefreshRequested = true
      scheduleAutomaticRefresh()
    },
    notifyCatalogApplied,
    notifySelectionApplied: async (selectedKeys) => {
      const appliedKeySet = selectedKeySet(selectedKeys)
      if (stopped) return
      const expectedDesiredKeySet = expectedSelectionKeySet(
        state.status === 'inactive' ? null : state.manifest,
        desiredContext,
      )
      if (appliedKeySet !== expectedDesiredKeySet) {
        if (state.status !== 'inactive') {
          appliedSelectionKeySet = null
          publish({ ...state, status: 'partial' })
        }
        return
      }
      appliedSelectionKeySet = appliedKeySet
      if (
        state.status === 'inactive' ||
        appliedKeySet !== expectedSelectionKeySet(state.manifest, context)
      ) return
      const wasPending = state.blockers?.includes('renderer_filter_pending') === true
      if (!wasPending) return
      publish({
        ...state,
        blockers: (state.blockers ?? [])
          .filter((blocker) => blocker !== 'renderer_filter_pending'),
      })
      await requestRefresh()
    },
    notifyRendererFailure: (failure) => {
      if (
        state.status === 'inactive' ||
        state.missionId !== failure.missionId ||
        !catalogActivation.containsRevision(
        state.tileCatalog,
        failure.periodKey,
        failure.revisionDigest,
        )
      ) return
      const failedCatalog = state.tileCatalog
      const activeFailureSources = [
        ...finalizedRendererFailureSources,
        ...(failedCatalog === null ? [] : coverageCatalogFailureSources(failedCatalog)),
      ]
      if (!matchesRendererFailureSource(activeFailureSources, failure)) return
      const failureKey = rendererFailureSourceKey(failure)
      if (
        rendererRecoveryEpoch !== null &&
        rendererRecoverySupersededFailureKeys?.has(failureKey) === true
      ) return
      const supersededFailureKeys = new Set(
        activeFailureSources.map(rendererFailureSourceKey),
      )
      publishRendererUnavailable(failure.message)
      rendererRecoverySupersededFailureKeys = supersededFailureKeys
    },
    notifyRendererUnavailable: (message, failure) => {
      publishRendererUnavailable(message, failure?.code)
    },
    notifyRendererDetached: (catalog) => {
      if (state.status === 'inactive') return
      if (
        catalog !== undefined &&
        (finalizedCatalog === null || !isSameCatalog(finalizedCatalog, catalog))
      ) return
      if (
        catalog === undefined &&
        finalizedCatalog === null &&
        state.tileCatalog === null
      ) return
      if (catalog === undefined) rendererDetachEpoch += 1
      if (rendererDetached) {
        return
      }
      if (catalog !== undefined) rendererDetachEpoch += 1
      rendererDetachedCompleteCatalog = state.status === 'complete' ? finalizedCatalog : null
      rendererDetached = true
      const blockers = new Set(state.blockers ?? [])
      blockers.add('renderer_detached')
      publish({
        ...state,
        status: state.status === 'complete' ? 'partial' : state.status,
        blockers: [...blockers],
      })
    },
    cancel: () => {
      contextUpdateSequence += 1
      rendererDetachedCompleteCatalog = null
      refreshRequested = false
      clearAutomaticRefresh()
      if (catalogFinalization !== null) {
        cancelRequested = true
        if (state.status !== 'inactive') publish(asPartialState(state))
        return
      }
      activeController?.abort()
      activeController = null
      operationGeneration += 1
      if (state.status !== 'inactive') {
        publish(withFinalizedCatalog(asPartialState(state), finalizedCatalog))
      }
    },
    resume: async () => {
      const resumeSequence = contextUpdateSequence
      automaticRendererRecoveryAvailable = true
      automaticRendererRecoveryAttempts = 0
      // The operator retries now; a queued automatic attempt is superseded and
      // the next failure starts the backoff again from its shortest delay.
      scheduledRendererRecovery = null
      await waitForCatalogFinalization()
      if (stopped || resumeSequence !== contextUpdateSequence) return
      await applyDesiredContext(true, true)
      if (stopped || resumeSequence !== contextUpdateSequence) return
      reapplyFinalizedCatalog()
    },
    stop: () => {
      stopped = true
      contextUpdateSequence += 1
      refreshRequested = false
      clearAutomaticRefresh()
      if (catalogFinalization !== null) {
        stopRequestedDuringFinalization = true
        return
      }
      settleStoppedState()
    },
    getState: () => state,
  }
}

/** Requires an exact, unique revision attestation for every selected chunk. */
function claimCoversSelection(
  revisions: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[],
  selected: readonly CoverageManifestChunk[],
  delivered: Readonly<Record<string, number>>,
): boolean {
  if (revisions.length !== selected.length) return false
  const claimed = new Map<string, number>()
  for (const revision of revisions) {
    const identity = coverageChunkIdentity(revision.key)
    if (claimed.has(identity)) return false
    claimed.set(identity, revision.contentRev)
  }
  return selected.every((chunk) => {
    const identity = coverageChunkIdentity(chunk.key)
    return claimed.get(identity) === chunk.contentRev && delivered[identity] === chunk.contentRev
  })
}

function withFinalizedCatalog(
  state: Exclude<CoverageState, { readonly status: 'inactive' }>,
  finalizedCatalog: CoverageTileCatalog | null,
): Exclude<CoverageState, { readonly status: 'inactive' }> {
  return { ...state, tileCatalog: finalizedCatalog }
}

/** Matches only the catalog currently attested by the controller state. */
function isCurrentCatalog(state: CoverageState, catalog: CoverageTileCatalog): boolean {
  if (state.status === 'inactive' || state.tileCatalog === null) return false
  return isSameCatalog(state.tileCatalog, catalog)
}

/** Matches a renderer catalog without relying on revisions that can repeat by mission. */
function isSameCatalog(
  left: CoverageTileCatalog | null,
  right: CoverageTileCatalog,
): boolean {
  if (left === null || left.missionId !== right.missionId) return false
  if (left.activationId !== right.activationId) return false
  const revisions = (value: CoverageTileCatalog): string => value.periods
    .map((period) => `${period.periodKey}\u0000${period.revisionDigest}`)
    .sort()
    .join('\n')
  return revisions(left) === revisions(right)
}

/** Describes the fallback source owner before a renderer provides per-period ownership. */
function coverageCatalogFailureSources(
  catalog: CoverageTileCatalog,
): readonly CoverageRendererFailureSource[] {
  return catalog.periods.map((period) => ({
    periodKey: period.periodKey,
    revisionDigest: period.revisionDigest,
    ...(catalog.activationId === undefined ? {} : { activationId: catalog.activationId }),
  }))
}

/** Matches one tile failure to a source that can still contribute visible coverage. */
function matchesRendererFailureSource(
  sources: readonly CoverageRendererFailureSource[],
  failure: CoverageRendererFailureSource,
): boolean {
  const failureKey = rendererFailureSourceKey(failure)
  return sources.some((source) => rendererFailureSourceKey(source) === failureKey)
}

/** Creates an exact period, revision, and renderer-activation failure identity. */
function rendererFailureSourceKey(source: CoverageRendererFailureSource): string {
  return `${source.periodKey}\u0000${source.revisionDigest}\u0000${source.activationId ?? ''}`
}

function selectChunks(
  manifest: CoverageManifest,
  context: CoverageOmissions,
): readonly CoverageManifestChunk[] {
  return selectCoverageManifestChunks(manifest, context)
}

function retainUnchangedDeliveries(
  prior: CoverageManifest | null,
  next: CoverageManifest,
  delivered: CoverageDelivery,
): Record<string, number> {
  if (prior === null) return {}
  const nextRevisions = new Map(next.chunks.map((chunk) => [
    coverageChunkIdentity(chunk.key), chunk.contentRev,
  ]))
  return Object.fromEntries(Object.entries(delivered).filter(([identity, revision]) =>
    nextRevisions.has(identity) && Number.isSafeInteger(revision)))
}

function createActiveState(input: Omit<Exclude<CoverageState, { status: 'inactive' }>,
  'deliveredFixCount' | 'totalFixCount'>,
context: CoverageOmissions,
): Exclude<CoverageState, { status: 'inactive' }> {
  const selected = input.manifest === null ? [] : selectChunks(input.manifest, context)
  const { deliveredFixCount, totalFixCount } = calculateCoverageProgress({
    chunks: selected,
    delivered: input.delivered,
  })
  return {
    ...input,
    deliveredFixCount,
    totalFixCount,
    updatedAt: new Date().toISOString(),
  }
}

function asPartialState(
  current: Exclude<CoverageState, { status: 'inactive' }>,
): Exclude<CoverageState, { status: 'inactive' }> {
  return { ...current, status: 'partial' }
}

function selectedKeySet(keys: readonly CoverageChunkKey[] | undefined): string {
  return keys === undefined ? '*' : keys.map(coverageChunkIdentity).sort().join('\n')
}

/** Resolves the renderer filter acknowledgement expected for one manifest. */
function expectedSelectionKeySet(
  manifest: CoverageManifest | null,
  context: CoverageOmissions,
): string {
  if (context.omittedDeviceIds.length === 0 && context.omittedPeriodKeys.length === 0) {
    return '*'
  }
  return selectedKeySet(manifest === null
    ? []
    : selectChunks(manifest, context).map((chunk) => chunk.key))
}

/** Creates a stable identity for normalized omission predicates. */
function omissionSet(context: CoverageOmissions): string {
  return JSON.stringify([context.omittedDeviceIds, context.omittedPeriodKeys])
}

/** Copies, de-duplicates, and orders renderer omission predicates. */
function normalizeContext(context: CoverageContext): NormalizedCoverageContext {
  return {
    missionId: context.missionId,
    rendererGeneration: context.rendererGeneration,
    omittedDeviceIds: [...new Set(context.omittedDeviceIds ?? [])].sort(),
    omittedPeriodKeys: [...new Set(context.omittedPeriodKeys ?? [])].sort(),
  }
}

function isAbortError(error: unknown): boolean {
  return isCoverageCancellation(error)
}

/** Separates an expected revision race from inventory and catalog payloads. */
function isCoverageStaleResult<T extends object>(
  result: CoverageReadResult<T>,
): result is CoverageStaleResult {
  return 'kind' in result && result.kind === 'stale'
}
