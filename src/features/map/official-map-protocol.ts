import type { GetResourceResponse, RequestParameters } from 'maplibre-gl'

import { OFFICIAL_MAP_TILE_PROTOCOL } from './official-map-export'

type ProtocolRegistry = {
  readonly addProtocol: (
    protocol: string,
    loadFn: (request: Pick<RequestParameters, 'url'>) => Promise<GetResourceResponse<ArrayBuffer>>,
  ) => void
  readonly removeProtocol: (protocol: string) => void
}

/**
 * Registers the MapLibre custom protocol used for local official map tiles.
 */
export function registerOfficialMapProtocol(registry: ProtocolRegistry): () => void {
  registry.addProtocol(OFFICIAL_MAP_TILE_PROTOCOL, async (request) => {
    const bridge = window.sartrackerElectron
    if (bridge?.fetchOfficialMapTile === undefined) {
      throw new Error('Electron official map bridge is not available.')
    }

    const response = await bridge.fetchOfficialMapTile(request.url)
    return {
      data: base64ToArrayBuffer(response.bytesBase64),
    }
  })

  return () => registry.removeProtocol(OFFICIAL_MAP_TILE_PROTOCOL)
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}
