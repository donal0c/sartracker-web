import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useHelicopterStore } from '../helicopters/helicopter-store'
import { syncHelicopterOverlay } from '../helicopters/sync-helicopter-overlay'
import { getEffectiveHelicopterSlotVisibility } from '../layers/effective-overlay-visibility'
import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import type { BasemapId } from '../../lib/map-config'
import { registerMapStyleSync } from './map-style-sync'

type UseMapHelicopterOverlaysOptions = {
  readonly activeBasemapId: BasemapId
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion: number
}

export function useMapHelicopterOverlays(options: UseMapHelicopterOverlaysOptions): void {
  const helicopters = useHelicopterStore((state) => state.helicopters)
  const groupVisibility = useLayerVisibilityStore((state) => state.groupVisibility)
  const hiddenHelicopterIds = useLayerVisibilityStore((state) => state.hiddenHelicopterIds)
  const helicopterSlotVisibility = useLayerVisibilityStore(
    (state) => state.helicopterSlotVisibility,
  )

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      void syncHelicopterOverlay(
        map,
        helicopters,
        getEffectiveHelicopterSlotVisibility(groupVisibility, helicopterSlotVisibility),
        hiddenHelicopterIds,
      )
    }

    return registerMapStyleSync(map, synchronizeOverlay)
  }, [
    helicopters,
    groupVisibility,
    helicopterSlotVisibility,
    hiddenHelicopterIds,
    options.activeBasemapId,
    options.mapReadyVersion,
    options.mapRef,
  ])
}
