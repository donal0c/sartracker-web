/**
 * Shared interface implemented by both the real Tauri attachment store and the
 * harness/noop adapter. Defining it here keeps the marker runtime free of any
 * direct dependency on Tauri infrastructure.
 */

export type IngestedMarkerAttachment = {
  readonly storedPath: string
  readonly fileName: string
}

export type MarkerAttachmentBoundary = {
  readonly ingest: (missionId: string, file: File) => Promise<IngestedMarkerAttachment>
}
