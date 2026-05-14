import type { MarkerAttachmentBoundary } from './marker-attachment-boundary'

// Used in browser-harness mode where no Tauri filesystem is available.
export const noopMarkerAttachmentAdapter: MarkerAttachmentBoundary = {
  ingest: async (_missionId: string, file: File) => {
    const fileName = file.name.trim().replace(/[\\/:*?"<>|]+/g, '-')
    return {
      storedPath: fileName,
      fileName,
    }
  },
}
