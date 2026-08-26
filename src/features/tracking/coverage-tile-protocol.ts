import type { AddProtocolAction } from 'maplibre-gl'

export const COVERAGE_TILE_PROTOCOL = 'sartracker-coverage'

type ProtocolRegistry = {
  readonly addProtocol: (
    protocol: string,
    loadFn: AddProtocolAction,
  ) => void
  readonly removeProtocol: (protocol: string) => void
}

/** Registers the revision-bound Candidate-B local vector-tile protocol. */
export function registerCoverageTileProtocol(
  registry: ProtocolRegistry,
  onFailure: (failure: {
    readonly missionId: string
    readonly periodKey: string
    readonly revisionDigest: string
    readonly activationId?: string
    readonly message: string
  }) => void = () => undefined,
): () => void {
  registry.addProtocol(COVERAGE_TILE_PROTOCOL, async (
    request,
    abortController = new AbortController(),
  ) => {
    const readTile = window.sartrackerElectron?.missionStore.readCoverageTile
    if (readTile === undefined) {
      throw new Error('Electron coverage tile bridge is not available.')
    }
    const parsedQuery = parseCoverageTileUrl(request.url)
    const { activationId, ...query } = parsedQuery
    if (abortController.signal.aborted) throw createAbortError()
    const requestId = `coverage-tile-${crypto.randomUUID()}`
    const abort = (): void => {
      void window.sartrackerElectron?.missionStore.cancelCoverageTileRead?.(requestId)
        .catch(() => undefined)
    }
    abortController.signal.addEventListener('abort', abort, { once: true })
    try {
      const bytes = await raceCoverageTileRead(
        readTile(query, requestId),
        abortController.signal,
      )
      if (bytes === null) {
        throw new Error('Coverage tile revision is no longer current.')
      }
      return { data: copyArrayBuffer(bytes) }
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) throw createAbortError()
      onFailure({
        missionId: query.missionId,
        periodKey: query.periodKey,
        revisionDigest: query.revisionDigest,
        ...(activationId === undefined ? {} : { activationId }),
        message: 'Coverage tile delivery failed.',
      })
      throw error
    } finally {
      abortController.signal.removeEventListener('abort', abort)
    }
  })
  return () => registry.removeProtocol(COVERAGE_TILE_PROTOCOL)
}

/** Rejects obsolete MapLibre work promptly while main/worker cancellation settles. */
function raceCoverageTileRead<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(createAbortError())
    signal.addEventListener('abort', abort, { once: true })
    void read.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function createAbortError(): Error {
  const error = new Error('Coverage tile request was cancelled.')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Creates one MapLibre template without using a mission-global revision. */
export function createCoverageTileUrl(
  missionId: string,
  periodKey: string,
  revisionDigest: string,
  activationId?: string,
): string {
  return `${COVERAGE_TILE_PROTOCOL}://tiles/${encodeURIComponent(periodKey)}` +
    `/{z}/{x}/{y}.pbf?mission=${encodeURIComponent(missionId)}` +
    `&rev=${encodeURIComponent(revisionDigest)}` +
    (activationId === undefined ? '' : `&activation=${encodeURIComponent(activationId)}`)
}

function parseCoverageTileUrl(url: string): {
  readonly missionId: string
  readonly periodKey: string
  readonly revisionDigest: string
  readonly activationId?: string
  readonly z: number
  readonly x: number
  readonly y: number
} {
  const parsed = new URL(url)
  const match = parsed.pathname.match(/^\/(.+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/u)
  const missionId = parsed.searchParams.get('mission')
  const revisionDigest = parsed.searchParams.get('rev')
  const activationId = parsed.searchParams.get('activation')
  if (
    parsed.hostname !== 'tiles' ||
    match === null ||
    missionId === null ||
    revisionDigest === null
  ) {
    throw new Error('Coverage tile URL is invalid.')
  }
  return {
    missionId,
    periodKey: decodeURIComponent(match[1]!),
    revisionDigest,
    ...(activationId === null ? {} : { activationId }),
    z: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
  }
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
