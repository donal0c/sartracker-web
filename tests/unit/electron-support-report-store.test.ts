import { beforeEach, describe, expect, it, vi } from 'vitest'

import { exportDiagnosticsReport } from '../../src/infrastructure/support-report/tauri-support-report-store'

describe('support report store in Electron', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
    window.sessionStorage.clear()
  })

  it('exports diagnostics through the Electron preload bridge instead of browser session storage', async () => {
    const exportDiagnosticsReportBridge = vi
      .fn()
      .mockResolvedValue('/home/user/.config/sartracker/diagnostics-reports/report.txt')
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        exportDiagnosticsReport: exportDiagnosticsReportBridge,
      },
    })

    await expect(
      exportDiagnosticsReport('diagnostics-report.txt', 'Diagnostics Report\nsecret present: yes'),
    ).resolves.toBe('/home/user/.config/sartracker/diagnostics-reports/report.txt')

    expect(exportDiagnosticsReportBridge).toHaveBeenCalledWith({
      fileName: 'diagnostics-report.txt',
      contents: 'Diagnostics Report\nsecret present: yes',
    })
    expect(window.sessionStorage.getItem('sartracker:diagnostics-reports')).toBeNull()
  })
})
