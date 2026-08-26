import type {
  CoverageChunkKey,
  CoverageClaim,
  CoverageManifest,
  CoverageManifestChunk,
  CoverageTileCatalog,
  Position,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createCoverageScheduler } from './coverage-scheduler'
import { classifyCoverageError, type CoverageErrorClass } from './coverage-diagnostics'
import { createCoverageCatalogActivation } from './coverage-catalog-activation'
import { createCoverageCatalogDeliveryBatches } from './coverage-catalog-delivery-plan'
import { coverageChunkIdentity } from './coverage-identity'
import { calculateCoverageProgress } from './coverage-progress'
import {
  selectCoverageManifestChunks,
  type CoverageOmissions,
} from './coverage-filter-selection'
import type {
  CoverageRendererFailure,
  CoverageRendererFailureSource,
} from './coverage-tile-protocol'

export const COVERAGE_CHUNK_PAGE_LIMIT = 10_000
const AUTOMATIC_RENDERER_RETRY_DELAY_MS = 250

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
      readonly blockers?: readonly string[]
      readonly updatedAt?: string
      readonly message?: string
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
  readonly refresh: () => Promise<void>
  readonly notifyChanged: (missionId: string, changeSeq: number) => Promise<void>
  readonly notifyCatalogApplied: (
    catalog: CoverageTileCatalog,
    rendererActivation?: CoverageRendererActivation,
  ) => Promise<void>
  readonly notifySelectionApplied: (
    selectedKeys?: readonly CoverageChunkKey[],
  ) => Promise<void>
  readonly notifyRendererFailure: (failure: CoverageRendererFailure) => void
  readonly notifyRendererUnavailable: (message: string) => void
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
  readonly readManifest: (
    missionId: string,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<CoverageManifest>
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
  }) => Promise<CoverageTileCatalog>
  readonly activateCatalog?: (catalog: CoverageTileCatalog) => Promise<void>
  readonly finalizeCatalog?: (catalog: CoverageTileCatalog) => Promise<void>
  readonly discardCatalog?: (catalog: CoverageTileCatalog) => Promise<void>
  readonly publish: (state: CoverageState) => void
}): CoverageController {
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
  let rendererFailureDuringFinalization: Error | null = null
  let rendererFailureEpoch = 0
  let rendererRecoveryEpoch: number | null = null
  let rendererRecoverySupersededFailureKeys: ReadonlySet<string> | null = null
  let automaticRendererRecoveryAvailable = true
  const catalogActivation = createCoverageCatalogActivation()
  const scheduler = createCoverageScheduler({
    now: () => Date.now(),
    openOutingCooldownMs: 30_000,
  })

  const publish = (next: CoverageState): void => {
    if (next.status === 'inactive') {
      lastErrorClass = null
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
      state = {
        ...next,
        status: (rendererDetached || filterPending) && next.status === 'complete'
          ? 'partial'
          : next.status,
        blockers: [...blockers],
        lastErrorClass,
      }
    }
    input.publish(state)
  }

  /** Completes controller teardown after any irreversible handoff has settled. */
  const settleStoppedState = (): void => {
    stopRequestedDuringFinalization = false
    activeController?.abort()
    activeController = null
    operationGeneration += 1
    refreshRequested = false
    cancelRequested = false
    finalizedCatalog = null
    finalizedRendererFailureSources = []
    rendererDetached = false
    rendererDetachedCompleteCatalog = null
    rendererRecoveryEpoch = null
    rendererRecoverySupersededFailureKeys = null
    automaticRendererRecoveryAvailable = false
    rendererFailureDuringFinalization = null
    pendingCatalogRelease = null
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
      const manifest = await input.readManifest(
        missionId,
        nextRequestId('manifest'),
        controller.signal,
      )
      if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
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
        const pending = scheduler.order(
          manifest,
          manifest.chunks.filter((chunk) =>
            delivered[coverageChunkIdentity(chunk.key)] !== chunk.contentRev),
          { bypassOpenOutingCooldown },
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
          const currentRevisions = new Map(manifest.chunks.map((chunk) => [
            coverageChunkIdentity(chunk.key), chunk.contentRev,
          ]))
          for (const entry of activeCatalog.delivered) {
            const identity = coverageChunkIdentity(entry.key)
            if (currentRevisions.get(identity) === entry.contentRev) {
              delivered[identity] = entry.contentRev
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
        }
        activeManifest = await input.readManifest(
          missionId,
          nextRequestId('manifest'),
          controller.signal,
        )
        if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
        activeSelected = selectChunks(activeManifest, context)
      } else {
        for (const descriptor of scheduler.order(
          manifest,
          selected,
          { bypassOpenOutingCooldown },
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
        if (cancelRequested) {
          cancelRequested = false
          refreshRequested = false
          if (state.status !== 'inactive') {
            publish(withFinalizedCatalog(asPartialState(state), finalizedCatalog))
          }
        } else if (refreshRequested && !stopped && context.missionId !== null) {
          refreshRequested = false
          void runLoad(true)
        }
      }
      resolveLoadCompletion()
      if (activeLoadCompletion === loadCompletion) activeLoadCompletion = null
    }
  }

  const requestRefresh = async (): Promise<void> => {
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

  const publishRendererUnavailable = (message: string): void => {
    if (state.status === 'inactive') return
    rendererDetached = false
    rendererDetachedCompleteCatalog = null
    const error = new Error(message)
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

  /** Retries one failed renderer activation after its owning load has unwound. */
  const scheduleAutomaticRendererRecovery = (
    failedLoad: Promise<void> | null,
    recoveryEpoch: number,
    missionId: string,
    rendererGeneration: string,
  ): void => {
    if (!automaticRendererRecoveryAvailable) return
    automaticRendererRecoveryAvailable = false
    void (failedLoad ?? Promise.resolve()).then(async () => {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, AUTOMATIC_RENDERER_RETRY_DELAY_MS)
      })
      if (
        stopped ||
        rendererRecoveryEpoch !== recoveryEpoch ||
        state.status !== 'error' ||
        context.missionId !== missionId ||
        context.rendererGeneration !== rendererGeneration
      ) return
      await runLoad(true, true)
    }).catch(() => undefined)
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
    const blockers = state.blockers.filter((blocker) => blocker !== 'renderer_detached')
    publish({
      ...state,
      status: restoreComplete && blockers.length === 0 ? 'complete' : 'partial',
      blockers,
    })
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
    if (identityChanged) finalizedCatalog = null
    if (identityChanged) finalizedRendererFailureSources = []
    if (identityChanged) rendererDetached = false
    if (identityChanged) {
      rendererRecoveryEpoch = null
      rendererRecoverySupersededFailureKeys = null
    }
    if (identityChanged) automaticRendererRecoveryAvailable = true
    if (identityChanged) rendererFailureDuringFinalization = null
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
    refresh: requestRefresh,
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
        status: 'partial',
        latestObservedChangeSeq: changeSeq,
      })
      await requestRefresh()
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
      const failedLoad = activeLoadCompletion
      const missionId = state.missionId
      const rendererGeneration = state.rendererGeneration
      const supersededFailureKeys = new Set(
        activeFailureSources.map(rendererFailureSourceKey),
      )
      publishRendererUnavailable(failure.message)
      rendererRecoverySupersededFailureKeys = supersededFailureKeys
      if (rendererRecoveryEpoch !== null) {
        scheduleAutomaticRendererRecovery(
          failedLoad,
          rendererRecoveryEpoch,
          missionId,
          rendererGeneration,
        )
      }
    },
    notifyRendererUnavailable: publishRendererUnavailable,
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
      await waitForCatalogFinalization()
      if (stopped || resumeSequence !== contextUpdateSequence) return
      await applyDesiredContext(true, true)
    },
    stop: () => {
      stopped = true
      contextUpdateSequence += 1
      refreshRequested = false
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
  return error instanceof Error && error.name === 'AbortError'
}
