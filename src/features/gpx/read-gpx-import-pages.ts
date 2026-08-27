import type { GpxTrackImport } from '../../infrastructure/mission-store/tauri-mission-store'

const GPX_RENDERER_PAGE_LIMIT = 25
const MAX_GPX_RENDERER_PAGES = 10_000

type GpxImportReadBoundary = {
  readonly listGpxImports: (missionId: string) => Promise<readonly GpxTrackImport[]>
  readonly listGpxImportPage?: (input: {
    readonly missionId: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<{
    readonly entries: readonly GpxTrackImport[]
    readonly nextCursor: string | null
  }>
}

/**
 * Reads GPX display projections through bounded Electron pages. The legacy
 * whole-list method remains a non-Electron compatibility fallback only.
 */
export async function readAllGpxImportProjections(
  store: GpxImportReadBoundary,
  missionId: string,
  isCurrent: () => boolean = () => true,
): Promise<readonly GpxTrackImport[]> {
  if (store.listGpxImportPage === undefined) {
    return await store.listGpxImports(missionId)
  }

  const imports: GpxTrackImport[] = []
  let cursor: string | undefined
  for (let pageIndex = 0; pageIndex < MAX_GPX_RENDERER_PAGES; pageIndex += 1) {
    if (!isCurrent()) return []
    const page = await store.listGpxImportPage({
      missionId,
      limit: GPX_RENDERER_PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    })
    if (!isCurrent()) return []
    for (const entry of page.entries) {
      if (entry.source_bytes_base64 !== undefined && entry.source_bytes_base64 !== null) {
        throw new Error('GPX renderer projection unexpectedly contained retained source bytes.')
      }
      imports.push(entry)
    }
    if (page.nextCursor === null) return imports
    if (page.nextCursor === cursor) {
      throw new Error('GPX renderer page cursor did not advance.')
    }
    cursor = page.nextCursor
  }
  throw new Error('GPX renderer projection exceeded the supported page count.')
}
