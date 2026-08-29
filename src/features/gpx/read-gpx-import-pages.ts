import type { GpxTrackImport } from '../../infrastructure/mission-store/tauri-mission-store'

export const GPX_RENDERER_PAGE_LIMIT = 25
const LEGACY_CURSOR_PREFIX = 'legacy-offset:'

type GpxImportReadBoundary = {
  readonly listGpxImports: (missionId: string) => Promise<readonly GpxTrackImport[]>
  readonly listGpxImportPage?: (input: {
    readonly missionId: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<GpxImportProjectionPage>
}

export type GpxImportProjectionPage = {
  readonly entries: readonly GpxTrackImport[]
  readonly nextCursor: string | null
}

/**
 * Reads exactly one bounded GPX display page. Callers retain only this page and
 * must expose the continuation cursor rather than draining it into one array.
 */
export async function readGpxImportProjectionPage(
  store: GpxImportReadBoundary,
  missionId: string,
  cursor?: string,
  isCurrent: () => boolean = () => true,
): Promise<GpxImportProjectionPage> {
  if (!isCurrent()) return { entries: [], nextCursor: null }

  const page = store.listGpxImportPage === undefined
    ? await readLegacyProjectionPage(store, missionId, cursor)
    : await store.listGpxImportPage({
        missionId,
        limit: GPX_RENDERER_PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      })

  if (!isCurrent()) return { entries: [], nextCursor: null }
  if (page.entries.length > GPX_RENDERER_PAGE_LIMIT) {
    throw new Error('GPX renderer projection page exceeded its entry limit.')
  }
  for (const entry of page.entries) {
    if (entry.source_bytes_base64 !== undefined && entry.source_bytes_base64 !== null) {
      throw new Error('GPX renderer projection unexpectedly contained retained source bytes.')
    }
  }
  if (page.nextCursor !== null && page.nextCursor === cursor) {
    throw new Error('GPX renderer page cursor did not advance.')
  }
  return page
}

/** Keeps non-Electron compatibility stores bounded while they migrate to paging. */
async function readLegacyProjectionPage(
  store: GpxImportReadBoundary,
  missionId: string,
  cursor?: string,
): Promise<GpxImportProjectionPage> {
  const offset = decodeLegacyOffset(cursor)
  const imports = await store.listGpxImports(missionId)
  const entries = imports.slice(offset, offset + GPX_RENDERER_PAGE_LIMIT)
  const nextOffset = offset + entries.length
  return {
    entries,
    nextCursor: nextOffset < imports.length ? `${LEGACY_CURSOR_PREFIX}${nextOffset}` : null,
  }
}

function decodeLegacyOffset(cursor?: string): number {
  if (cursor === undefined) return 0
  if (!cursor.startsWith(LEGACY_CURSOR_PREFIX)) {
    throw new Error('GPX renderer compatibility cursor is invalid.')
  }
  const offset = Number(cursor.slice(LEGACY_CURSOR_PREFIX.length))
  if (!Number.isSafeInteger(offset) || offset < 1) {
    throw new Error('GPX renderer compatibility cursor is invalid.')
  }
  return offset
}
