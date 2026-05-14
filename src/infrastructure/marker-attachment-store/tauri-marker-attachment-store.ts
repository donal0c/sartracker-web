import { invoke } from '@tauri-apps/api/core'

import { getBrowserHarnessStore } from '../../features/browser-validation/browser-harness-store'
import { shouldEnableMissionBrowserHarness } from '../../features/mission/mission-browser-harness'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import type {
  IngestedMarkerAttachment,
  MarkerAttachmentBoundary,
} from './marker-attachment-boundary'

export type { IngestedMarkerAttachment, MarkerAttachmentBoundary }

type IngestMarkerAttachmentInput = {
  readonly missionId: string
  readonly fileName: string
  readonly bytesBase64: string
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export const tauriMarkerAttachmentAdapter: MarkerAttachmentBoundary = {
  ingest: ingestMarkerAttachment,
}

export async function ingestMarkerAttachment(
  missionId: string,
  file: File,
): Promise<IngestedMarkerAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment must be 25 MB or smaller.')
  }

  const normalizedFileName = normalizeFileName(file.name)
  if (normalizedFileName === '') {
    throw new Error('Attachment file name is required.')
  }

  if (isTauriRuntimeAvailable()) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const input: IngestMarkerAttachmentInput = {
      missionId,
      fileName: normalizedFileName,
      bytesBase64: encodeBase64(bytes),
    }

    const storedPath = await invoke<string>('ingest_marker_attachment', { input })
    return {
      storedPath,
      fileName: normalizedFileName,
    }
  }

  if (shouldEnableMissionBrowserHarness()) {
    const storedPath = `${await getBrowserHarnessAttachmentRoot(missionId)}/${normalizedFileName}`
    return {
      storedPath,
      fileName: normalizedFileName,
    }
  }

  return {
    storedPath: normalizedFileName,
    fileName: normalizedFileName,
  }
}

function normalizeFileName(fileName: string): string {
  return fileName
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return btoa(binary)
}

async function getBrowserHarnessAttachmentRoot(missionId: string): Promise<string> {
  const info = await getBrowserHarnessStore().info()
  const normalizedDatabasePath = info.database_path.replace(/\\/g, '/')
  const baseDirectory = normalizedDatabasePath.replace(/\/mission-store\.sqlite$/, '')
  return `${baseDirectory}/missions/${missionId}/attachments`
}
