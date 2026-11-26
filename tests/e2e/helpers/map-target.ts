import { expect, type Page } from '@playwright/test'

/**
 * Reads the go-to target marker the map is drawing, as [longitude, latitude], or null when none
 * is drawn: no map, no style, no or hidden marker layer, or an empty marker source. The coordinate bar no
 * longer names the target (DON-372), so the drawn marker itself is the evidence.
 */
export async function mapTargetMarker(page: Page): Promise<[number, number] | null> {
  return page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__
    // No style (for example during a basemap change) means no marker is drawn.
    if (map === undefined || map.getStyle() === undefined) return null
    if (map.getLayer('coordinate-target-dot') === undefined) return null
    if (map.getLayoutProperty('coordinate-target-dot', 'visibility') === 'none') return null
    const source = map.getSource('coordinate-target') as { serialize: () => { data?: unknown } } | undefined
    if (source === undefined) return null
    const data = source.serialize().data as GeoJSON.FeatureCollection
    const point = data.features[0]?.geometry
    if (point === undefined || point.type !== 'Point') return null
    return [point.coordinates[0]!, point.coordinates[1]!]
  })
}

/** Waits until the map draws the go-to target marker at the given [longitude, latitude]. */
export async function expectMapTargetAt(page: Page, coordinate: [number, number]): Promise<void> {
  await expect.poll(async () => {
    const marker = await mapTargetMarker(page)
    return marker !== null &&
      Math.abs(marker[0] - coordinate[0]) < 0.00001 &&
      Math.abs(marker[1] - coordinate[1]) < 0.00001
  }, { timeout: 10_000 }).toBe(true)
}

/**
 * The bar's readouts belong to the cursor (or the map centre before any pointer): no person or
 * target name may sit beside them, and the bar says whose position it shows (DON-372).
 */
export async function expectCoordinateBarNamesNobody(page: Page, name: string): Promise<void> {
  await expect(page.getByTestId('coordinate-display')).not.toContainText(name, { ignoreCase: true })
  await expect(page.getByTestId('coordinate-readout-owner')).toHaveText(/^(Cursor position|Map centre)$/u)
}
