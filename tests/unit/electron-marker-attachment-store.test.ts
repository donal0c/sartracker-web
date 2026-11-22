import { afterEach, describe, expect, it, vi } from 'vitest'

import { electronMarkerAttachmentAdapter } from '../../src/infrastructure/marker-attachment-store/electron-marker-attachment-store'

describe('Electron marker attachment adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends sanitized file names and base64 bytes through the preload bridge', async () => {
    const bridge = {
      ingestMarkerAttachment: vi.fn().mockResolvedValue('/userData/missions/mission-1/photo-.jpg'),
    }
    vi.stubGlobal('window', {
      sartrackerElectron: bridge,
    })

    const result = await electronMarkerAttachmentAdapter.ingest(
      'mission-1',
      new File(['image bytes'], 'photo?.jpg'),
    )

    expect(result).toEqual({
      storedPath: '/userData/missions/mission-1/photo-.jpg',
      fileName: 'photo-.jpg',
    })
    expect(bridge.ingestMarkerAttachment).toHaveBeenCalledWith({
      missionId: 'mission-1',
      fileName: 'photo-.jpg',
      bytesBase64: 'aW1hZ2UgYnl0ZXM=',
    })
  })

  it('shows the main-process refusal without the Electron IPC wrapper [M-41]', async () => {
    const plain = 'Attachment could not be saved safely to this laptop, so it was not added to the mission.'
    vi.stubGlobal('window', {
      sartrackerElectron: {
        ingestMarkerAttachment: vi.fn().mockRejectedValue(new Error(
          `Error invoking remote method 'sartracker:file-system:ingest-marker-attachment': Error: ${plain}`,
        )),
      },
    })

    await expect(electronMarkerAttachmentAdapter.ingest(
      'mission-1',
      new File(['image bytes'], 'photo.jpg'),
    )).rejects.toThrow(new Error(plain))
  })
})
