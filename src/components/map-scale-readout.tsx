import type maplibregl from 'maplibre-gl'
import type { RefObject } from 'react'
import { useEffect, useState } from 'react'

import { describeMapScale, type MapScaleState } from '../features/map/map-scale-bar'

type MapScaleReadoutProps = {
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Renders the segmented metric scale bar (DON-369) over the map without relying
 * on MapLibre's default control placement, which would collide with the
 * coordinate strip. Distances and widths come from `describeMapScale`; when the
 * map cannot be measured it says "Map scale unavailable" instead of hiding.
 */
export function MapScaleReadout({ mapRef }: MapScaleReadoutProps) {
  const [scale, setScale] = useState<MapScaleState | null>(null)

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

      let lastUnavailableReason: string | null = null
      const update = () => {
        const center = map.getCenter()
        const next = describeMapScale({
          latitude: center.lat,
          zoom: map.getZoom(),
          mapWidthPx: map.getContainer().clientWidth,
          minZoom: map.getMinZoom(),
          maxZoom: map.getMaxZoom(),
        })
        // Log once per new failure, not on every frame of a move.
        if (next.status === 'unavailable' && next.reason !== lastUnavailableReason) {
          console.warn(`[map-scale] ${next.message}: ${next.reason}`)
        }
        lastUnavailableReason = next.status === 'unavailable' ? next.reason : null
        setScale(next)
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

  // Before the map exists there is nothing to measure yet.
  if (scale === null) {
    return null
  }

  if (scale.status === 'unavailable') {
    return (
      <div
        className="sar-map-scale pointer-events-none absolute left-4 z-10"
        data-state="unavailable"
        data-testid="map-scale-readout"
        role="status"
        title="Current map scale"
      >
        <p className="sar-map-scale-heading text-[12px] font-black uppercase leading-none tracking-[0.14em]">
          Map Scale
        </p>
        <p className="sar-map-scale-unavailable" data-testid="map-scale-unavailable">
          {scale.message}
        </p>
      </div>
    )
  }

  const { bar } = scale
  const lastTick = bar.ticks.length - 1

  return (
    <div
      aria-label={`Map scale: the bar is ${bar.totalLabel}`}
      className="sar-map-scale pointer-events-none absolute left-4 z-10"
      data-state="ready"
      data-testid="map-scale-readout"
      role="img"
      title="Current map scale"
    >
      <p className="sar-map-scale-heading text-[12px] font-black uppercase leading-none tracking-[0.14em]">
        Map Scale
      </p>
      <div className="sar-map-scale-body">
        <div
          aria-hidden="true"
          className="sar-map-scale-bar relative h-2.5"
          data-testid="map-scale-bar"
          style={{ width: `${bar.widthPx}px` }}
        >
          {bar.segments.map((segment) => (
            <span
              className={`absolute inset-y-0 ${segment.filled ? 'sar-map-scale-block-dark' : 'sar-map-scale-block-light'}`}
              data-testid="map-scale-segment"
              key={segment.offsetPx}
              style={{ left: `${segment.offsetPx}px`, width: `${segment.widthPx}px` }}
            />
          ))}
        </div>
        <div aria-hidden="true" className="relative mt-1 h-[15px]" style={{ width: `${bar.widthPx}px` }}>
          {bar.ticks.map((tick, index) =>
            tick.labelVisible ? (
              <span
                className="sar-map-scale-tick absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[13px] font-black leading-none"
                data-testid={index === lastTick ? 'map-scale-label' : 'map-scale-tick'}
                key={tick.distanceM}
                style={{ left: `${tick.offsetPx}px` }}
              >
                {tick.label}
                {index === lastTick ? (
                  <span className="absolute left-full top-0 pl-[3px]" data-testid="map-scale-unit">
                    {' '}
                    {bar.unit}
                  </span>
                ) : null}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  )
}
