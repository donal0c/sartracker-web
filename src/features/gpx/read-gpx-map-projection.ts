import type {
  GpxMapProjectionPage,
  GpxTrackImport,
} from '../../infrastructure/mission-store/tauri-mission-store'

/** The store's map projection caps tracks at 512 and pages at 25, so 64 pages is a hard ceiling. */
const MAX_MAP_PROJECTION_PAGES = 64

type GpxMapReadBoundary = {
  readonly listGpxMapProjectionPage: (input: {
    readonly missionId: string
    readonly cursor?: string
  }) => Promise<GpxMapProjectionPage>
}

export type GpxUndrawnTrack = { readonly id: string; readonly display_name: string; readonly reason: string }

/** Every active import the map can draw, with the ones it cannot named [DON-350] [M-87]. */
export type GpxMapProjection = {
  readonly entries: readonly GpxTrackImport[]
  readonly undrawn: readonly GpxUndrawnTrack[]
  readonly totalActive: number
  readonly truncated: boolean
}

/**
 * Drains the mission-wide map projection. Each page is already thinned by the store to a share of one
 * map budget, so the whole set stays bounded.
 */
export async function readGpxMapProjection(
  store: GpxMapReadBoundary,
  missionId: string,
  isCurrent: () => boolean = () => true,
): Promise<GpxMapProjection | null> {
  if (!isCurrent()) return null
  const entries: GpxTrackImport[] = []
  const undrawn: GpxUndrawnTrack[] = []
  let cursor: string | undefined
  let totalActive = 0
  let truncated = false
  for (let page = 0; page < MAX_MAP_PROJECTION_PAGES; page += 1) {
    const result = await store.listGpxMapProjectionPage({
      missionId,
      ...(cursor === undefined ? {} : { cursor }),
    })
    if (!isCurrent()) return null
    entries.push(...result.entries)
    undrawn.push(...(result.undrawn ?? []))
    totalActive = result.totalActive
    truncated ||= result.truncated
    if (result.nextCursor === null) return { entries, undrawn, totalActive, truncated }
    if (result.nextCursor === cursor) throw new Error('GPX map page cursor did not advance.')
    cursor = result.nextCursor
  }
  throw new Error('GPX map projection did not finish within its page limit.')
}

/** Notice for runtimes without a map projection, whose map can show only the visible list page. */
export function describeListPageMapCoverage(shown: number, hasOtherPages: boolean): string | null {
  if (!hasOtherPages) return null
  return `Map shows only the ${shown} GPX track${shown === 1 ? '' : 's'} on the current list page; `
    + 'other pages are not drawn in this runtime. Every track is still listed in the GPX panel.'
}

/**
 * Notice for a failed map refresh [M-87]. The operational warning comes first, because the map notice shows only
 * two lines (DON-369); the technical reason follows and is read in full from the notice's title.
 */
export function describeGpxMapRefreshFailure(shown: number, reason: string): string {
  return `GPX map not refreshed: it still shows the ${shown} track${shown === 1 ? '' : 's'} from the last successful read; `
    + 'newer imports may be missing. Every track is still listed in the GPX panel. '
    + `Reason: ${reason.replace(/\.+$/u, '')}.`
}

/**
 * Words the operator reads when the map does not show every imported track. Null when it does.
 */
export function describeGpxMapCoverage(projection: GpxMapProjection): string | null {
  const drawn = projection.entries.length
  if (drawn >= projection.totalActive && projection.undrawn.length === 0 && !projection.truncated) return null
  const parts = [`Map shows ${drawn} of ${projection.totalActive} imported GPX tracks.`]
  if (projection.undrawn.length > 0) {
    const names = projection.undrawn.slice(0, 3).map((track) => track.display_name).join(', ')
    const more = projection.undrawn.length > 3 ? ` and ${projection.undrawn.length - 3} more` : ''
    parts.push(`Not drawn: ${names}${more} (${projection.undrawn[0]?.reason.replace(/\.+$/u, '')}).`)
  }
  if (projection.truncated) {
    parts.push('The map draws at most 512 tracks; retire tracks you no longer need to draw the rest.')
  }
  parts.push('Every track is still listed in the GPX panel.')
  return parts.join(' ')
}
