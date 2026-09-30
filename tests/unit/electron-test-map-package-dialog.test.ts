import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

type OpenDialogResult = { readonly canceled: boolean; readonly filePaths: readonly string[] }
type OpenDialog = { readonly showOpenDialog: (...args: readonly unknown[]) => Promise<OpenDialogResult> }

const { TEST_MAP_PACKAGE_PATH_ENV, withTestMapPackageDialog } = (await import(
  '../../electron/test-map-package-dialog.cjs'
)) as {
  readonly TEST_MAP_PACKAGE_PATH_ENV: string
  readonly withTestMapPackageDialog: (
    dialog: OpenDialog,
    env: Record<string, string | undefined>,
    log: (message: string) => void,
  ) => OpenDialog
}

const mapPackagePicker = { properties: ['openFile'], filters: [{ name: 'Official map packages', extensions: ['mbtiles'] }] }
const gpxPicker = { properties: ['openFile'], filters: [{ name: 'GPX tracks', extensions: ['gpx'] }] }

function realDialog(): OpenDialog {
  return { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) }
}

describe('test-only official map package picker answer', () => {
  it('returns the real dialog unchanged when the variable is absent or blank', () => {
    const dialog = realDialog()
    const log = vi.fn()
    expect(withTestMapPackageDialog(dialog, {}, log)).toBe(dialog)
    expect(withTestMapPackageDialog(dialog, { [TEST_MAP_PACKAGE_PATH_ENV]: '  ' }, log)).toBe(dialog)
    expect(log).not.toHaveBeenCalled()
  })

  it('answers only the map package picker, with or without a parent window, and says so', async () => {
    const dialog = realDialog()
    const log = vi.fn()
    const wrapped = withTestMapPackageDialog(dialog, { [TEST_MAP_PACKAGE_PATH_ENV]: 'fixtures/team.mbtiles' }, log)
    const expected = { canceled: false, filePaths: [path.resolve('fixtures/team.mbtiles')] }

    await expect(wrapped.showOpenDialog(mapPackagePicker)).resolves.toEqual(expected)
    await expect(wrapped.showOpenDialog({ id: 'window' }, mapPackagePicker)).resolves.toEqual(expected)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Test hook active'))

    await expect(wrapped.showOpenDialog({ id: 'window' }, gpxPicker)).resolves.toEqual({ canceled: true, filePaths: [] })
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({ id: 'window' }, gpxPicker)
  })
})
