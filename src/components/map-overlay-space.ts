import { useLayoutEffect, type RefObject } from 'react'

/** Height of the map warning stack at the bottom right, read by Map Tools (DON-369). */
export const MAP_ALERTS_HEIGHT_VAR = '--sar-map-alerts-height'
/** Room the GPX coverage notice takes above the map scale, read by Map Tools (DON-369). */
export const GPX_NOTICE_RESERVE_VAR = '--sar-gpx-notice-reserve'

/**
 * Publishes an overlay's live height as a CSS variable on its map container, so
 * Map Tools can stop above it instead of being drawn over it, or over it.
 * `format` turns the measured pixels into the variable's value.
 */
export function usePublishMapOverlayHeight(
  ref: RefObject<HTMLElement | null>,
  variable: string,
  format: (heightPx: number) => string = (heightPx) => `${heightPx}px`,
): void {
  useLayoutEffect(() => {
    const element = ref.current
    const scope = element?.parentElement ?? null
    if (element === null || scope === null) return undefined
    const publish = () => scope.style.setProperty(variable, format(element.getBoundingClientRect().height))
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      scope.style.removeProperty(variable)
    }
  })
}
