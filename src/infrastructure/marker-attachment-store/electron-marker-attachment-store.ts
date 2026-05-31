import type {
  IngestedMarkerAttachment,
  MarkerAttachmentBoundary,
} from './marker-attachment-boundary'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Marker attachment adapter backed by Electron main-process filesystem IPC.
 */
export const electronMarkerAttachmentAdapter: MarkerAttachmentBoundary = {
  ingest: ingestElectronMarkerAttachment,
}

async function ingestElectronMarkerAttachment(
  missionId: string,
  file: File,
): Promise<IngestedMarkerAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment must be 25 MB or smaller.')
  }

  const fileName = file.name.trim().replace(/[\\/:*?"<>|]+/g, '-')
  if (fileName === '') {
    throw new Error('Attachment file name is required.')
  }

  const bridge = window.sartrackerElectron
  if (bridge === undefined) {
    throw new Error('Electron attachment bridge is not available.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const storedPath = await bridge.ingestMarkerAttachment({
    missionId,
    fileName,
    bytesBase64: encodeBase64(bytes),
  })
  return { storedPath, fileName }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return btoa(binary)
}
