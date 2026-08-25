import type { CoverageTileCatalog } from '../../infrastructure/mission-store/tauri-mission-store'

export type CoverageCatalogActivation = {
  readonly wait: (catalog: CoverageTileCatalog, signal: AbortSignal) => Promise<void>
  readonly notifyApplied: (catalog: CoverageTileCatalog) => void
  readonly rejectPending: (error: Error) => boolean
  readonly containsRevision: (
    catalog: CoverageTileCatalog | null,
    periodKey: string,
    revisionDigest: string,
  ) => boolean
}

/** Owns the single in-flight renderer catalog-activation acknowledgement. */
export function createCoverageCatalogActivation(): CoverageCatalogActivation {
  let pending: {
    readonly signature: string
    readonly resolve: () => void
    readonly reject: (error: Error) => void
  } | null = null

  return {
    wait: (catalog, signal) => new Promise((resolve, reject) => {
      const signature = catalogSignature(catalog)
      const abort = () => {
        if (pending?.signature === signature) pending = null
        reject(createAbortError())
      }
      pending?.reject(new Error('Coverage catalog activation was superseded.'))
      pending = {
        signature,
        resolve: () => {
          signal.removeEventListener('abort', abort)
          pending = null
          resolve()
        },
        reject: (error) => {
          signal.removeEventListener('abort', abort)
          pending = null
          reject(error)
        },
      }
      signal.addEventListener('abort', abort, { once: true })
    }),
    notifyApplied: (catalog) => {
      if (pending?.signature === catalogSignature(catalog)) pending.resolve()
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
  return catalog.periods
    .map((period) => `${period.periodKey}\u0000${period.revisionDigest}`)
    .sort()
    .join('\n')
}

function createAbortError(): Error {
  const error = new Error('Coverage catalog activation was cancelled.')
  error.name = 'AbortError'
  return error
}
