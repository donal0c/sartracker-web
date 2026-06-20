import type maplibregl from 'maplibre-gl'
import type { RefObject } from 'react'
import { useEffect, useState } from 'react'

import {
  buildMapScaleReadout,
  type MapScaleReadout as ScaleReadout,
} from '../features/map/map-scale-readout'

type MapScaleReadoutProps = {
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Renders a compact metric scale bar over the map without relying on MapLibre's
 * default control placement, which would collide with the coordinate strip.
 */
export function MapScaleReadout({ mapRef }: MapScaleReadoutProps) {
  const [readout, setReadout] = useState<ScaleReadout | null>(null)

  useEffect(() => {
    let cancelled = false
    let retryFrame = 0
    let cleanupMapListeners = () => {}

    const bindToMap = () => {
      if (cancelled) {
        return
      }

      const map = mapRef.current
      if (map === null) {
        retryFrame = window.requestAnimationFrame(bindToMap)
        return
      }

      const update = () => {
        const center = map.getCenter()
        setReadout(buildMapScaleReadout({ latitude: center.lat, zoom: map.getZoom() }))
      }

      update()
      map.on('move', update)
      map.on('zoom', update)
      map.on('resize', update)

      cleanupMapListeners = () => {
        map.off('move', update)
        map.off('zoom', update)
        map.off('resize', update)
      }
    }

    retryFrame = window.requestAnimationFrame(bindToMap)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(retryFrame)
      cleanupMapListeners()
    }
  }, [mapRef])

  if (readout === null || readout.distanceM <= 0) {
    return null
  }

  return (
    <div
      className="sar-map-scale pointer-events-none absolute bottom-[5.75rem] left-4 z-10"
      data-testid="map-scale-readout"
      title="Current map scale"
    >
      <div className="flex items-end gap-3">
        <div
          aria-hidden="true"
          className="h-4 border-x-[3px] border-b-[3px] border-stone-50"
          data-testid="map-scale-bar"
          style={{ width: `${readout.widthPx}px` }}
        />
        <span
          className="font-mono text-[15px] font-black leading-none text-stone-50"
          data-testid="map-scale-label"
        >
          {readout.label}
        </span>
      </div>
      <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">
        Map Scale
      </p>
    </div>
  )
}
