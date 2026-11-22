import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  RENDERER_MOUNTED_CHANNEL,
  createRendererMountGate,
} = require('../../electron/renderer-mount-gate.cjs') as {
  RENDERER_MOUNTED_CHANNEL: string
  createRendererMountGate: (dependencies: {
    ipcMain: { on: (channel: string, handler: (event: unknown) => void) => void, removeListener: (channel: string, handler: unknown) => void }
    webContents: { id: number }
  }) => { mounted: Promise<void>, dispose: () => void }
}

/** Builds an IPC double that delivers renderer signals to registered handlers. */
function createIpcMain() {
  const handlers = new Map<string, (event: unknown) => void>()
  return {
    on: vi.fn((channel: string, handler: (event: unknown) => void) => { handlers.set(channel, handler) }),
    removeListener: vi.fn((channel: string) => { handlers.delete(channel) }),
    emit(channel: string, event: unknown) { handlers.get(channel)?.(event) },
    has(channel: string) { return handlers.has(channel) },
  }
}

describe('renderer mount gate [DON-354]', () => {
  it('opens when the operational window reports its first screen mounted', async () => {
    const ipcMain = createIpcMain()
    const gate = createRendererMountGate({ ipcMain, webContents: { id: 7 } })

    ipcMain.emit(RENDERER_MOUNTED_CHANNEL, { sender: { id: 7 } })

    await expect(gate.mounted).resolves.toBeUndefined()
    expect(ipcMain.has(RENDERER_MOUNTED_CHANNEL)).toBe(false)
  })

  it('ignores a mount signal from any other window', async () => {
    const ipcMain = createIpcMain()
    const gate = createRendererMountGate({ ipcMain, webContents: { id: 7 } })
    let opened = false
    void gate.mounted.then(() => { opened = true })

    ipcMain.emit(RENDERER_MOUNTED_CHANNEL, { sender: { id: 8 } })
    ipcMain.emit(RENDERER_MOUNTED_CHANNEL, {})
    await Promise.resolve()

    expect(opened).toBe(false)
    expect(ipcMain.has(RENDERER_MOUNTED_CHANNEL)).toBe(true)
  })

  it('stops listening when disposed', () => {
    const ipcMain = createIpcMain()
    const gate = createRendererMountGate({ ipcMain, webContents: { id: 7 } })

    gate.dispose()
    gate.dispose()

    expect(ipcMain.removeListener).toHaveBeenCalledOnce()
    expect(ipcMain.has(RENDERER_MOUNTED_CHANNEL)).toBe(false)
  })
})
