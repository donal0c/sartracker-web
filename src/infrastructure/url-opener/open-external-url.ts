import { invoke } from '@tauri-apps/api/core'

import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'

/**
 * Opens an http/https URL in the system default browser.
 * Works across Tauri, Electron, and hosted browser runtimes.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const normalized = url.trim()
  if (normalized === '') {
    throw new Error('URL is required.')
  }

  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    throw new Error('URL scheme must be http:// or https://')
  }

  if (isTauriRuntimeAvailable()) {
    await invoke('open_external_url', { url: normalized })
    return
  }

  if (isElectronRuntimeAvailable()) {
    const bridge = window.sartrackerElectron
    if (bridge?.openExternalUrl !== undefined) {
      await bridge.openExternalUrl(normalized)
      return
    }
  }

  window.open(normalized, '_blank', 'noopener,noreferrer')
}
