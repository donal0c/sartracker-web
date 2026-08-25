import type { GetResourceResponse, RequestParameters } from 'maplibre-gl'

export const COVERAGE_TILE_PROTOCOL = 'sartracker-coverage'

type ProtocolRegistry = {
  readonly addProtocol: (
    protocol: string,
    loadFn: (request: Pick<RequestParameters, 'url'>) => Promise<GetResourceResponse<ArrayBuffer>>,
  ) => void
  readonly removeProtocol: (protocol: string) => void
}

/** Registers the revision-bound Candidate-B local vector-tile protocol. */
export function registerCoverageTileProtocol(
  registry: ProtocolRegistry,
  onFailure: (failure: {
    readonly periodKey: string
    readonly revisionDigest: string
    readonly message: string
  }) => void = () => undefined,
): () => void {
  registry.addProtocol(COVERAGE_TILE_PROTOCOL, async (request) => {
    const readTile = window.sartrackerElectron?.missionStore.readCoverageTile
    if (readTile === undefined) {
      throw new Error('Electron coverage tile bridge is not available.')
    }
    const query = parseCoverageTileUrl(request.url)
    try {
      const bytes = await readTile(query)
      if (bytes === null) {
        throw new Error('Coverage tile revision is no longer current.')
      }
      return { data: copyArrayBuffer(bytes) }
    } catch (error) {
      onFailure({
        periodKey: query.periodKey,
        revisionDigest: query.revisionDigest,
        message: 'Coverage tile delivery failed.',
      })
      throw error
    }
  })
  return () => registry.removeProtocol(COVERAGE_TILE_PROTOCOL)
}

/** Creates one MapLibre template without using a mission-global revision. */
export function createCoverageTileUrl(periodKey: string, revisionDigest: string): string {
  return `${COVERAGE_TILE_PROTOCOL}://tiles/${encodeURIComponent(periodKey)}` +
    `/{z}/{x}/{y}.pbf?rev=${encodeURIComponent(revisionDigest)}`
}

function parseCoverageTileUrl(url: string): {
  readonly periodKey: string
  readonly revisionDigest: string
  readonly z: number
  readonly x: number
  readonly y: number
} {
  const parsed = new URL(url)
  const match = parsed.pathname.match(/^\/(.+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/u)
  const revisionDigest = parsed.searchParams.get('rev')
  if (parsed.hostname !== 'tiles' || match === null || revisionDigest === null) {
    throw new Error('Coverage tile URL is invalid.')
  }
  return {
    periodKey: decodeURIComponent(match[1]!),
    revisionDigest,
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
