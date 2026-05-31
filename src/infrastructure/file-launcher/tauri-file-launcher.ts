import { invoke } from '@tauri-apps/api/core'

import { getBrowserHarnessStore } from '../../features/browser-validation/browser-harness-store'
import { shouldEnableMissionBrowserHarness } from '../../features/mission/mission-browser-harness'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'

export async function openExternalPath(path: string): Promise<void> {
  const normalizedPath = path.trim()
  if (normalizedPath === '') {
    throw new Error('Path is required.')
  }

  if (isTauriRuntimeAvailable()) {
    await invoke('open_external_path', { path: normalizedPath })
    return
  }

  if (isElectronRuntimeAvailable()) {
    const bridge = window.sartrackerElectron
    if (bridge === undefined) {
      throw new Error('Electron file launcher bridge is not available.')
    }
    await bridge.openExternalPath(normalizedPath)
    return
  }

  if (shouldEnableMissionBrowserHarness()) {
    await getBrowserHarnessStore().openExternalPath(normalizedPath)
    return
  }

  window.open(normalizedPath, '_blank', 'noopener,noreferrer')
}
