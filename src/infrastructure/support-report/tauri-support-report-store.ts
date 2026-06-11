import { invoke } from '@tauri-apps/api/core'

import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import type { CrashRecoveryState } from '../../types/electron-bridge'

const BROWSER_DIAGNOSTICS_REPORTS_KEY = 'sartracker:diagnostics-reports'

const EMPTY_CRASH_RECOVERY_STATE: CrashRecoveryState = {
  uncleanShutdown: false,
  lastCrash: null,
}

/**
 * Exports an operator support report through the desktop boundary, with a browser fallback.
 */
export async function exportDiagnosticsReport(
  fileName: string,
  contents: string,
): Promise<string> {
  if (isTauriRuntimeAvailable()) {
    return invoke<string>('export_diagnostics_report', {
      input: {
        file_name: fileName,
        contents,
      },
    })
  }

  if (isElectronRuntimeAvailable()) {
    const bridge = window.sartrackerElectron
    if (bridge === undefined) {
      throw new Error('Electron diagnostics bridge is not available.')
    }
    return bridge.exportDiagnosticsReport({ fileName, contents })
  }

  const normalizedFileName = fileName.trim()
  if (normalizedFileName === '') {
    throw new Error('Diagnostics report file name is required.')
  }

  const records = readBrowserDiagnosticsReports()
  const exportedPath = `/tmp/browser-harness/diagnostics/${normalizedFileName}`
  window.sessionStorage.setItem(
    BROWSER_DIAGNOSTICS_REPORTS_KEY,
    JSON.stringify([
      ...records,
      {
        fileName: normalizedFileName,
        path: exportedPath,
        contents,
      },
    ]),
  )
  return exportedPath
}

/**
 * Exports a support bundle (environment snapshot + crash history + recent runtime log)
 * through the desktop boundary. Only the Electron operational lane records crash and
 * runtime history; Tauri and browser modes fall back to the plain diagnostics report.
 */
export async function exportSupportBundle(
  fileName: string,
  contents: string,
): Promise<string> {
  if (isElectronRuntimeAvailable()) {
    const bridge = window.sartrackerElectron
    if (bridge?.exportSupportBundle !== undefined) {
      return bridge.exportSupportBundle({ fileName, contents })
    }
  }

  // No crash/runtime history available in this runtime; the environment snapshot is
  // still the useful artifact, so export it under the requested name.
  return exportDiagnosticsReport(fileName, contents)
}

/**
 * Reads the crash-recovery state so the UI can show a calm post-crash notice. Returns
 * an all-clear result in any runtime that does not track crashes (Tauri, browser).
 */
export async function readCrashRecoveryState(): Promise<CrashRecoveryState> {
  if (isElectronRuntimeAvailable()) {
    const bridge = window.sartrackerElectron
    if (bridge?.readCrashRecoveryState !== undefined) {
      try {
        return await bridge.readCrashRecoveryState()
      } catch {
        return EMPTY_CRASH_RECOVERY_STATE
      }
    }
  }
  return EMPTY_CRASH_RECOVERY_STATE
}

function readBrowserDiagnosticsReports(): readonly {
  readonly fileName: string
  readonly path: string
  readonly contents: string
}[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.sessionStorage.getItem(BROWSER_DIAGNOSTICS_REPORTS_KEY)
    if (raw === null) {
      return []
    }

    return JSON.parse(raw) as readonly {
      readonly fileName: string
      readonly path: string
      readonly contents: string
    }[]
  } catch {
    return []
  }
}
