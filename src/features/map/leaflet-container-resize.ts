import type L from 'leaflet'

/**
 * Keeps the Leaflet fallback sized to its container. Leaflet only listens for
 * window resizes, but a docked workspace panel narrows the map without one, so
 * the viewport would otherwise keep its old width (DON-368).
 *
 * @returns a function that stops watching the container.
 */
export function keepLeafletSizedToContainer(
  map: Pick<L.Map, 'invalidateSize'>,
  container: HTMLElement,
): () => void {
  if (typeof ResizeObserver === 'undefined') {
    // Only test environments lack it; Electron's renderer always has it.
    return () => {}
  }
  const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
  observer.observe(container)
  return () => observer.disconnect()
}
