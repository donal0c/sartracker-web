import type { CoverageTileCatalog } from '../../infrastructure/mission-store/tauri-mission-store'

/**
 * How long the map may take to start accepting a staged catalog. Source
 * loading has its own 15 s limit, so a minute without the map even starting
 * means the update is stuck and must fail visibly [DON-338 REN-3].
 */
export const COVERAGE_CATALOG_ACTIVATION_TIMEOUT_MS = 60_000

export type CoverageCatalogActivation = {
  readonly wait: (catalog: CoverageTileCatalog, signal: AbortSignal) => Promise<void>
  /** Stops the acceptance timeout once the map has started applying this catalog. */
  readonly holdTimeout: (catalog: CoverageTileCatalog) => void
  readonly isPending: (catalog: CoverageTileCatalog) => boolean
  readonly notifyApplied: (catalog: CoverageTileCatalog) => boolean
  readonly reject: (catalog: CoverageTileCatalog, error: Error) => boolean
  readonly rejectPending: (error: Error) => boolean
  readonly containsRevision: (
    catalog: CoverageTileCatalog | null,
    periodKey: string,
    revisionDigest: string,
  ) => boolean
}

/**
 * Owns the single in-flight renderer catalog-activation acknowledgement. A
 * wait that the map never starts to apply rejects after `timeoutMs` with a
 * timeout error instead of leaving the line stale with no signal.
 */
export function createCoverageCatalogActivation(options: {
  readonly timeoutMs?: number
} = {}): CoverageCatalogActivation {
  const timeoutMs = options.timeoutMs ?? COVERAGE_CATALOG_ACTIVATION_TIMEOUT_MS
  let pending: {
    readonly signature: string
    readonly resolve: () => void
    readonly reject: (error: Error) => void
    readonly holdTimeout: () => void
  } | null = null

  return {
    wait: (catalog, signal) => new Promise((resolve, reject) => {
      const signature = catalogSignature(catalog)
      let timer: ReturnType<typeof globalThis.setTimeout> | null = null
      const clearTimer = (): void => {
        if (timer !== null) globalThis.clearTimeout(timer)
        timer = null
      }
      const abort = () => {
        clearTimer()
        if (pending?.signature === signature) pending = null
        reject(createAbortError())
      }
      pending?.reject(new Error('Coverage catalog activation was superseded.'))
      const entry = {
        signature,
        resolve: () => {
          clearTimer()
          signal.removeEventListener('abort', abort)
          if (pending === entry) pending = null
          resolve()
        },
        reject: (error: Error) => {
          clearTimer()
          signal.removeEventListener('abort', abort)
          if (pending === entry) pending = null
          reject(error)
        },
        holdTimeout: clearTimer,
      }
      pending = entry
      timer = globalThis.setTimeout(() => {
        timer = null
        entry.reject(new Error('Coverage map did not accept the history update in time (timed out).'))
      }, timeoutMs)
      signal.addEventListener('abort', abort, { once: true })
    }),
    holdTimeout: (catalog) => {
      if (pending?.signature === catalogSignature(catalog)) pending.holdTimeout()
    },
    isPending: (catalog) => pending?.signature === catalogSignature(catalog),
    notifyApplied: (catalog) => {
      if (pending?.signature !== catalogSignature(catalog)) return false
      pending.resolve()
      return true
    },
    reject: (catalog, error) => {
      if (pending?.signature !== catalogSignature(catalog)) return false
      pending.reject(error)
      return true
    },
    rejectPending: (error) => {
      if (pending === null) return false
      pending.reject(error)
      return true
    },
    containsRevision: (catalog, periodKey, revisionDigest) =>
      catalog?.periods.some((period) =>
        period.periodKey === periodKey && period.revisionDigest === revisionDigest) ?? false,
  }
}

function catalogSignature(catalog: CoverageTileCatalog): string {
  const periods = catalog.periods
    .map((period) => `${period.periodKey}\u0000${period.revisionDigest}`)
    .sort()
    .join('\n')
  return `${catalog.missionId}\n${catalog.activationId ?? 'renderer-only'}\n${periods}`
}

function createAbortError(): Error {
  const error = new Error('Coverage catalog activation was cancelled.')
  error.name = 'AbortError'
  return error
}
