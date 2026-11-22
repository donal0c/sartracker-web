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
  let storedPath: string
  try {
    storedPath = await bridge.ingestMarkerAttachment({
      missionId,
      fileName,
      bytesBase64: encodeBase64(bytes),
    })
  } catch (error) {
    throw unwrapIpcError(error)
  }
  return { storedPath, fileName }
}

const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/u

/**
 * Removes Electron's "Error invoking remote method" wrapper so the operator
 * sees the main process's own plain-language refusal [M-41].
 */
function unwrapIpcError(error: unknown): unknown {
  if (!(error instanceof Error) || !IPC_ERROR_PREFIX.test(error.message)) return error
  return new Error(error.message.replace(IPC_ERROR_PREFIX, ''))
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return btoa(binary)
}
