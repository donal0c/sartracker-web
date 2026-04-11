import { invoke } from '@tauri-apps/api/core'

import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'

const BROWSER_DIAGNOSTICS_REPORTS_KEY = 'sartracker:diagnostics-reports'

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
