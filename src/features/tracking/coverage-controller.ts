import type {
  CoverageChunkKey,
  CoverageClaim,
  CoverageManifest,
  CoverageManifestChunk,
  CoverageTileCatalog,
  Position,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createCoverageScheduler } from './coverage-scheduler'

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
  readonly cancel: () => void
  readonly resume: () => Promise<void>
  readonly stop: () => void
  readonly getState: () => CoverageState
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
  readonly applyChunk: (payload: CoverageChunkPayload) => Promise<void>
  readonly deliverSelection?: (input: {
    readonly missionId: string
    readonly manifest: CoverageManifest
    readonly chunks: readonly CoverageManifestChunk[]
    readonly requestId: string
    readonly signal: AbortSignal
  }) => Promise<CoverageTileCatalog>
  readonly publish: (state: CoverageState) => void
}): CoverageController {
  let state: CoverageState = { status: 'inactive' }
  let context: CoverageContext = { missionId: null, rendererGeneration: '' }
  let stopped = false
  let operationGeneration = 0
  let requestSequence = 0
  let activeController: AbortController | null = null
  let refreshRequested = false
  const scheduler = createCoverageScheduler({
    now: () => Date.now(),
    openOutingCooldownMs: 30_000,
  })

  const publish = (next: CoverageState): void => {
    state = next
    input.publish(next)
  }

  const runLoad = async (retainDelivery: boolean): Promise<void> => {
    if (stopped || context.missionId === null) return
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
      : state.tileCatalog
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
        activeCatalog = await input.deliverSelection({
          missionId,
          manifest,
          chunks: selected,
          requestId: nextRequestId('catalog'),
          signal: controller.signal,
        })
        if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
        for (const entry of activeCatalog.delivered) {
          delivered[coverageChunkIdentity(entry.key)] = entry.contentRev
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
      const complete = claim.databaseReady &&
        claim.changeSeq === claimSequence &&
        claim.chunkRevisions.every(({ key, contentRev }) =>
          delivered[coverageChunkIdentity(key)] === contentRev)
      publish(createActiveState({
        status: complete ? 'complete' : 'partial',
        missionId,
        rendererGeneration,
        changeSeq: claim.changeSeq,
        latestObservedChangeSeq: claimSequence,
        manifest: activeManifest,
        tileCatalog: activeCatalog,
        delivered,
      }, context.selectedKeys))
    } catch (error) {
      if (!ownsOperation(operation, controller, missionId, rendererGeneration)) return
      if (state.status === 'inactive') return
      if (controller.signal.aborted || isAbortError(error)) {
        publish(asPartialState(state))
        return
      }
      publish({
        ...asPartialState(state),
        status: 'error',
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

  return {
    updateContext: async (nextContext) => {
      if (stopped) return
      const identityChanged = context.missionId !== nextContext.missionId ||
        context.rendererGeneration !== nextContext.rendererGeneration
      const selectionChanged = selectedKeySet(context.selectedKeys) !==
        selectedKeySet(nextContext.selectedKeys)
      if (!identityChanged && !selectionChanged) return
      activeController?.abort()
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
      publish({
        ...state,
        status: 'partial',
        latestObservedChangeSeq: changeSeq,
      })
      await requestRefresh()
    },
    cancel: () => {
      activeController?.abort()
      activeController = null
      operationGeneration += 1
      refreshRequested = false
      if (state.status !== 'inactive') publish(asPartialState(state))
    },
    resume: () => runLoad(true),
    stop: () => {
      stopped = true
      activeController?.abort()
      activeController = null
      operationGeneration += 1
      refreshRequested = false
      publish({ status: 'inactive' })
    },
    getState: () => state,
  }
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
  return { ...input, deliveredFixCount, totalFixCount }
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
