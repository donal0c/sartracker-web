import type { BreadcrumbTrailMode } from './tracking-style-store'
import type { NormalizedTrackingPosition, TrackingSnapshot } from './tracking-types'

export const EXACT_BREADCRUMB_DOT_PAGE_LIMIT = 10_000
export const EXACT_BREADCRUMB_DOT_DURABLE_REFRESH_INTERVAL_MS = 1_000

type ExactBreadcrumbDotRefreshScheduler = {
  readonly now: () => number
  readonly schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  readonly cancel: (handle: ReturnType<typeof setTimeout>) => void
}

export type ExactBreadcrumbDotPage = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly totalPositionCount: number
  readonly pagePositionCount: number
  readonly fromTimestamp: string | null
  readonly toTimestamp: string | null
  readonly hasEarlier: boolean
  readonly hasLater: boolean
  readonly earlierCursor: string | null
  readonly laterCursor: string | null
}

export type ExactBreadcrumbDotState =
  | { readonly status: 'inactive' }
  | { readonly status: 'loading'; readonly missionId: string }
  | ({
      readonly status: 'ready'
      readonly missionId: string
      readonly refreshing?: boolean
    } & ExactBreadcrumbDotPage)
  | { readonly status: 'unavailable'; readonly missionId: string; readonly message: string }

type ExactBreadcrumbDotContext = {
  readonly missionId: string | null
  readonly trailMode: BreadcrumbTrailMode
  readonly activeDeviceIds: readonly string[]
}

type ExactBreadcrumbDotPageRequest = {
  readonly missionId: string
  readonly activeDeviceIds: readonly string[]
  readonly limit: number
  readonly cursor: string | null
  readonly direction: 'earlier' | 'later' | 'latest'
  readonly signal: AbortSignal
}

export type ExactBreadcrumbDotController = {
  readonly updateContext: (input: ExactBreadcrumbDotContext) => void
  readonly showEarlier: () => void
  readonly showLater: () => void
  readonly notifyDurableChange: (changedPositionCount: number) => void
  readonly stop: () => void
  readonly getState: () => ExactBreadcrumbDotState
}

/**
 * Owns the cancellable SQLite-backed exact-dot page independently of the
 * bounded breadcrumb line projection.
 */
export function createExactBreadcrumbDotController(input: {
  readonly limit: number
  readonly queryPage: (input: ExactBreadcrumbDotPageRequest) => Promise<ExactBreadcrumbDotPage>
  readonly publish: (state: ExactBreadcrumbDotState) => void
  readonly refreshScheduler?: ExactBreadcrumbDotRefreshScheduler
}): ExactBreadcrumbDotController {
  const refreshScheduler = input.refreshScheduler ?? {
    now: () => Date.now(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle),
  }
  let state: ExactBreadcrumbDotState = { status: 'inactive' }
  let context: ExactBreadcrumbDotContext = {
    missionId: null,
    trailMode: 'line',
    activeDeviceIds: [],
  }
  let contextKey = createContextKey(context)
  let generation = 0
  let stopped = false
  let activeRequest: AbortController | null = null
  let activeRequestKind: 'foreground' | 'durable' | null = null
  let pendingForegroundRequest: {
    readonly direction: 'earlier' | 'later' | 'latest'
    readonly cursor: string | null
  } | null = null
  let durableRefreshDirty = false
  let durableRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let lastQueryStartedAtMs = Number.NEGATIVE_INFINITY
  let settledRequest: {
    readonly direction: 'earlier' | 'later' | 'latest'
    readonly cursor: string | null
  } = { direction: 'latest', cursor: null }

  const publish = (next: ExactBreadcrumbDotState): void => {
    state = next
    input.publish(next)
  }

  const requestPage = (
    direction: 'earlier' | 'later' | 'latest',
    cursor: string | null,
    requestKind: 'foreground' | 'durable' = 'foreground',
  ): void => {
    if (stopped || context.trailMode !== 'dots' || context.missionId === null) {
      return
    }
    if (activeRequest !== null) {
      if (requestKind === 'foreground') {
        pendingForegroundRequest = { direction, cursor }
      } else {
        durableRefreshDirty = true
      }
      return
    }

    const requestGeneration = generation
    const requestContext = {
      ...context,
      missionId: context.missionId,
    } as const
    const controller = new AbortController()
    activeRequest = controller
    activeRequestKind = requestKind
    lastQueryStartedAtMs = refreshScheduler.now()
    if (requestKind === 'durable' && state.status === 'ready') {
      publish({ ...state, refreshing: true })
    } else {
      publish({ status: 'loading', missionId: requestContext.missionId })
    }

    void input.queryPage({
      missionId: requestContext.missionId,
      activeDeviceIds: requestContext.activeDeviceIds,
      limit: input.limit,
      cursor,
      direction,
      signal: controller.signal,
    }).then((page) => {
      if (
        stopped ||
        controller.signal.aborted ||
        requestGeneration !== generation
      ) {
        return
      }
      publish({
        status: 'ready',
        missionId: requestContext.missionId,
        ...page,
        refreshing: false,
      })
      if (
        stopped ||
        controller.signal.aborted ||
        requestGeneration !== generation
      ) {
        return
      }
      settledRequest = { direction, cursor }
    }).catch((error: unknown) => {
      if (
        stopped ||
        controller.signal.aborted ||
        requestGeneration !== generation ||
        isAbortError(error)
      ) {
        return
      }
      publish({
        status: 'unavailable',
        missionId: requestContext.missionId,
        message: 'Exact breadcrumb dots are unavailable. No representative dots are shown.',
      })
    }).finally(() => {
      if (activeRequest !== controller) {
        return
      }
      activeRequest = null
      activeRequestKind = null
      if (
        pendingForegroundRequest !== null &&
        !stopped &&
        requestGeneration === generation &&
        context.trailMode === 'dots'
      ) {
        const pendingRequest = pendingForegroundRequest
        pendingForegroundRequest = null
        requestPage(pendingRequest.direction, pendingRequest.cursor)
        return
      }
      scheduleDurableRefresh()
    })
  }

  const scheduleDurableRefresh = (): void => {
    if (
      stopped ||
      !durableRefreshDirty ||
      durableRefreshTimer !== null ||
      context.trailMode !== 'dots' ||
      context.missionId === null
    ) {
      return
    }
    if (activeRequest !== null) {
      return
    }
    const delayMs = Math.max(
      0,
      lastQueryStartedAtMs + EXACT_BREADCRUMB_DOT_DURABLE_REFRESH_INTERVAL_MS -
        refreshScheduler.now(),
    )
    durableRefreshTimer = refreshScheduler.schedule(() => {
      durableRefreshTimer = null
      if (
        stopped ||
        !durableRefreshDirty ||
        context.trailMode !== 'dots' ||
        context.missionId === null
      ) {
        return
      }
      if (activeRequest !== null) {
        scheduleDurableRefresh()
        return
      }
      durableRefreshDirty = false
      requestPage(settledRequest.direction, settledRequest.cursor, 'durable')
    }, delayMs)
  }

  const cancelDurableRefresh = (): void => {
    if (durableRefreshTimer !== null) {
      refreshScheduler.cancel(durableRefreshTimer)
      durableRefreshTimer = null
    }
    durableRefreshDirty = false
  }

  return {
    updateContext: (nextContext) => {
      if (stopped) {
        return
      }
      const normalizedContext = {
        ...nextContext,
        activeDeviceIds: [...new Set(nextContext.activeDeviceIds)].sort(),
      }
      const nextKey = createContextKey(normalizedContext)
      if (nextKey === contextKey) {
        return
      }
      context = normalizedContext
      contextKey = nextKey
      generation += 1
      pendingForegroundRequest = null
      cancelDurableRefresh()
      settledRequest = { direction: 'latest', cursor: null }
      activeRequest?.abort()
      activeRequest = null
      activeRequestKind = null
      if (context.trailMode !== 'dots' || context.missionId === null) {
        publish({ status: 'inactive' })
        return
      }
      requestPage(settledRequest.direction, settledRequest.cursor)
    },
    showEarlier: () => {
      if (state.status === 'ready' && state.hasEarlier && state.earlierCursor !== null) {
        if (activeRequest !== null && activeRequestKind === 'durable') {
          activeRequest.abort()
          activeRequest = null
          activeRequestKind = null
          durableRefreshDirty = false
        }
        requestPage('earlier', state.earlierCursor)
      }
    },
    showLater: () => {
      if (state.status === 'ready' && state.hasLater && state.laterCursor !== null) {
        if (activeRequest !== null && activeRequestKind === 'durable') {
          activeRequest.abort()
          activeRequest = null
          activeRequestKind = null
          durableRefreshDirty = false
        }
        requestPage('later', state.laterCursor)
      }
    },
    notifyDurableChange: (changedPositionCount) => {
      if (!Number.isSafeInteger(changedPositionCount) || changedPositionCount <= 0) {
        return
      }
      if (context.trailMode !== 'dots' || context.missionId === null || stopped) {
        return
      }
      if (activeRequest !== null) {
        durableRefreshDirty = true
        return
      }
      durableRefreshDirty = true
      scheduleDurableRefresh()
    },
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      generation += 1
      pendingForegroundRequest = null
      cancelDurableRefresh()
      activeRequest?.abort()
      activeRequest = null
      activeRequestKind = null
      publish({ status: 'inactive' })
    },
    getState: () => state,
  }
}

/**
 * Replaces line representatives only for consumers that explicitly request
 * the exact dot overlay. Loading and failure resolve to zero dots.
 */
export function resolveBreadcrumbDotOverlaySnapshot(
  snapshot: TrackingSnapshot,
  trailMode: BreadcrumbTrailMode,
  state: ExactBreadcrumbDotState,
): TrackingSnapshot {
  if (trailMode !== 'dots') {
    return snapshot
  }
  return {
    ...snapshot,
    breadcrumbs: state.status === 'ready' ? state.positions : [],
  }
}

function createContextKey(context: ExactBreadcrumbDotContext): string {
  return [
    context.missionId ?? '',
    context.trailMode,
    [...new Set(context.activeDeviceIds)].sort().join('\u0000'),
  ].join('\u0001')
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
