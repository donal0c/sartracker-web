import { describe, expect, it } from 'vitest'

import {
  getDesktopRuntimeKind,
  isElectronRuntimeAvailable,
  isTauriRuntimeAvailable,
} from '../../src/lib/desktop-runtime'

describe('desktop runtime detection', () => {
  it('detects Electron independently from Tauri', () => {
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        traccarHttpRequest: async () => ({
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '[]',
        }),
      },
    })

    expect(isElectronRuntimeAvailable()).toBe(true)
    expect(isTauriRuntimeAvailable()).toBe(false)
    expect(getDesktopRuntimeKind()).toBe('electron')

    Reflect.deleteProperty(window, 'sartrackerElectron')
  })
})
