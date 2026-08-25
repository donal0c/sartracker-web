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

export const COVERAGE_CHUNK_PAGE_LIMIT = 10_000

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
  readonly selectedKeys?: readonly CoverageChunkKey[]
}

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
  readonly notifyRendererFailure: (failure: {
    readonly missionId: string
    readonly periodKey: string
    readonly revisionDigest: string
    readonly message: string
  }) => void
  readonly notifyRendererUnavailable: (message: string) => void
  readonly notifyRendererDetached: (catalog?: CoverageTileCatalog) => void
  readonly cancel: () => void
  readonly resume: () => Promise<void>
  readonly stop: () => void
  readonly getState: () => CoverageState
}

export type CoverageRendererActivation = {
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
  let context: CoverageContext = { missionId: null, rendererGeneration: '' }
  let stopped = false
  let operationGeneration = 0
  let requestSequence = 0
  let activeController: AbortController | null = null
  let refreshRequested = false
  let lastErrorClass: CoverageErrorClass | null = null
  let finalizedCatalog: CoverageTileCatalog | null = null
  let rendererDetached = false
  let rendererDetachedCompleteCatalog: CoverageTileCatalog | null = null
  let rendererDetachEpoch = 0
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
      state = {
        ...next,
        status: rendererDetached && next.status === 'complete' ? 'partial' : next.status,
        blockers: [...blockers],
        lastErrorClass,
      }
    }
    input.publish(state)
  }

  const runLoad = async (retainDelivery: boolean): Promise<void> => {
    if (stopped || context.missionId === null) return
    rendererDetachedCompleteCatalog = null
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const operation = ++operationGeneration
    const missionId = context.missionId
    const rendererGeneration = context.rendererGeneration
    const priorManifest = state.status === 'inactive' ? null : state.manifest
    const priorDelivered = state.status === 'inactive' ? {} : state.delivered
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
      delivered: retainDelivery ? priorDelivered : {},
    }, context.selectedKeys))

    try {
      const manifest = await input.readManifest(
        missionId,
        nextRequestId('manifest'),
        controller.signal,
      )
      if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
      const selected = selectChunks(manifest, context.selectedKeys)
      const delivered = retainUnchangedDeliveries(
        priorManifest,
        manifest,
        retainDelivery ? priorDelivered : {},
      )
      const latestObservedChangeSeq = Math.max(observedSequence, manifest.changeSeq)
      publish(createActiveState({
        status: 'loading', missionId, rendererGeneration,
        changeSeq: manifest.changeSeq,
        latestObservedChangeSeq,
        manifest,
        tileCatalog: priorCatalog,
        delivered,
      }, context.selectedKeys))

      let activeManifest = manifest
      let activeSelected = selected
      let activeCatalog = priorCatalog
      if (input.deliverSelection !== undefined) {
        const pending = scheduler.order(
          manifest,
          manifest.chunks.filter((chunk) =>
            delivered[coverageChunkIdentity(chunk.key)] !== chunk.contentRev),
        )
        const catalogBatches = createCoverageCatalogDeliveryBatches({
          manifest,
          priorManifest,
          priorDelivered,
          retainDelivery,
          orderedPending: pending,
        })
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
          }, context.selectedKeys))
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
          }, context.selectedKeys))
        }
        activeManifest = await input.readManifest(
          missionId,
          nextRequestId('manifest'),
          controller.signal,
        )
        if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
        activeSelected = selectChunks(activeManifest, context.selectedKeys)
      } else {
        for (const descriptor of scheduler.order(manifest, selected)) {
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
          }, context.selectedKeys))
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
      }, context.selectedKeys))

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
      const complete = claim.databaseReady &&
        !rendererDetached &&
        rendererBlockers.length === 0 &&
        !refreshRequested &&
        claim.changeSeq === finalSequence &&
        claim.chunkRevisions.every(({ key, contentRev }) =>
          delivered[coverageChunkIdentity(key)] === contentRev)
      publish(createActiveState({
        status: complete ? 'complete' : 'partial',
        missionId,
        rendererGeneration,
        changeSeq: claim.changeSeq,
        latestObservedChangeSeq: finalSequence,
        manifest: activeManifest,
        tileCatalog: activeCatalog,
        delivered,
        blockers: [...new Set([...claim.blockers, ...rendererBlockers])],
      }, context.selectedKeys))
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
      if (activeController === controller) {
        activeController = null
        if (refreshRequested && !stopped && context.missionId !== null) {
          refreshRequested = false
          void runLoad(true)
        }
      }
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
    }, context.selectedKeys))
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

  return {
    updateContext: async (nextContext) => {
      if (stopped) return
      const identityChanged = context.missionId !== nextContext.missionId ||
        context.rendererGeneration !== nextContext.rendererGeneration
      const selectionChanged = selectedKeySet(context.selectedKeys) !==
        selectedKeySet(nextContext.selectedKeys)
      if (!identityChanged && !selectionChanged) return
      rendererDetachedCompleteCatalog = null
      activeController?.abort()
      if (identityChanged) lastErrorClass = null
      if (identityChanged) finalizedCatalog = null
      if (identityChanged) rendererDetached = false
      operationGeneration += 1
      refreshRequested = false
      context = nextContext.selectedKeys === undefined
        ? {
            missionId: nextContext.missionId,
            rendererGeneration: nextContext.rendererGeneration,
          }
        : { ...nextContext, selectedKeys: [...nextContext.selectedKeys] }
      if (context.missionId === null) {
        publish({ status: 'inactive' })
        return
      }
      await runLoad(!identityChanged)
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
    notifyCatalogApplied: async (catalog, rendererActivation = {
      commit: () => undefined,
      finalize: () => undefined,
      rollback: () => undefined,
    }) => {
      if (!catalogActivation.isPending(catalog)) {
        if (
          isCurrentCatalog(state, catalog) &&
          isSameCatalog(finalizedCatalog, catalog)
        ) {
          rendererActivation.commit()
          rendererActivation.finalize?.()
          restoreRendererAttachment()
          return
        }
        rendererActivation.rollback()
        await input.discardCatalog?.(catalog).catch(() => undefined)
        return
      }
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
        await input.finalizeCatalog?.(catalog)
        if (!catalogActivation.isPending(catalog) || !isCurrentCatalog(state, catalog)) {
          rendererActivation.rollback()
          await input.discardCatalog?.(catalog).catch(() => undefined)
          return
        }
        rendererActivation.finalize?.()
        finalizedCatalog = catalog
        if (rendererDetachEpoch === attachmentEpoch) rendererDetached = false
        catalogActivation.notifyApplied(catalog)
      } catch (error) {
        const normalized = error instanceof Error
          ? error
          : new Error('Coverage catalog activation failed.')
        if (!catalogActivation.isPending(catalog)) {
          rendererActivation.rollback()
          return
        }
        rendererActivation.rollback()
        await input.discardCatalog?.(catalog).catch(() => undefined)
        if (!catalogActivation.isPending(catalog)) return
        catalogActivation.reject(catalog, normalized)
        publishRendererUnavailable(normalized.message)
        throw normalized
      }
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
      publishRendererUnavailable(failure.message)
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
      rendererDetachedCompleteCatalog = null
      activeController?.abort()
      activeController = null
      operationGeneration += 1
      refreshRequested = false
      if (state.status !== 'inactive') {
        publish(withFinalizedCatalog(asPartialState(state), finalizedCatalog))
      }
    },
    resume: () => runLoad(true),
    stop: () => {
      stopped = true
      activeController?.abort()
      activeController = null
      operationGeneration += 1
      refreshRequested = false
      finalizedCatalog = null
      rendererDetached = false
      publish({ status: 'inactive' })
    },
    getState: () => state,
  }
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

/** Creates the stable tagged renderer identity for one logical chunk. */
export function coverageChunkIdentity(key: CoverageChunkKey): string {
  return `${key.device_id}\u0000${key.period_kind}\u0000${key.period_id}`
}

function selectChunks(
  manifest: CoverageManifest,
  selectedKeys: readonly CoverageChunkKey[] | undefined,
): readonly CoverageManifestChunk[] {
  if (selectedKeys === undefined) return manifest.chunks
  const selected = new Set(selectedKeys.map(coverageChunkIdentity))
  return manifest.chunks.filter((chunk) => selected.has(coverageChunkIdentity(chunk.key)))
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
selectedKeys: readonly CoverageChunkKey[] | undefined,
): Exclude<CoverageState, { status: 'inactive' }> {
  const selected = input.manifest === null ? [] : selectChunks(input.manifest, selectedKeys)
  let deliveredFixCount = 0
  let totalFixCount = 0
  for (const chunk of selected) {
    const fresh = chunk.builtRev === chunk.contentRev
    const count = fresh && chunk.fixCount !== null ? chunk.fixCount : chunk.exactCount
    totalFixCount += count
    if (fresh && input.delivered[coverageChunkIdentity(chunk.key)] === chunk.contentRev) {
      deliveredFixCount += count
    }
  }
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
