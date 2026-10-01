import type { GetResourceResponse, RequestParameters } from 'maplibre-gl'

import { OFFICIAL_MAP_TILE_PROTOCOL } from './official-map-export'

type ProtocolRegistry = {
  readonly addProtocol: (
    protocol: string,
    loadFn: (request: Pick<RequestParameters, 'url'>) => Promise<GetResourceResponse<ArrayBuffer>>,
  ) => void
  readonly removeProtocol: (protocol: string) => void
}

const registrationCounts = new WeakMap<ProtocolRegistry, number>()

/**
 * Registers the MapLibre custom protocol used for local official map tiles.
 * The live map and Replay share one global registry, so the protocol stays
 * registered until the last map using it releases it [DON-314].
 */
export function registerOfficialMapProtocol(registry: ProtocolRegistry): () => void {
  const count = registrationCounts.get(registry) ?? 0
  registrationCounts.set(registry, count + 1)
  let released = false
  const release = () => {
    if (released) return
    released = true
    const remaining = (registrationCounts.get(registry) ?? 1) - 1
    registrationCounts.set(registry, remaining)
    if (remaining === 0) registry.removeProtocol(OFFICIAL_MAP_TILE_PROTOCOL)
  }
  if (count > 0) return release
  registry.addProtocol(OFFICIAL_MAP_TILE_PROTOCOL, async (request) => {
    const bridge = window.sartrackerElectron
    if (bridge?.fetchOfficialMapTile === undefined) {
      throw new Error('Electron official map bridge is not available.')
    }

    let response
    try { response = await bridge.fetchOfficialMapTile(request.url) }
    catch (error) {
      window.dispatchEvent(new Event('sartracker:official-map-tile-failed'))
      throw error
    }
    return {
      data: base64ToArrayBuffer(response.bytesBase64),
    }
  })

  return release
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}
