import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  GPU_RENDERING_PREFERENCE_FILE_NAME,
  applyGpuRenderingPreference,
  readGpuRenderingPreference,
  relaunchWithSoftwareRendering,
  writeSoftwareRenderingPreference,
} = require('../../electron/gpu-rendering-preference.cjs')

let userDataPath: string

beforeEach(() => {
  userDataPath = mkdtempSync(path.join(os.tmpdir(), 'sartracker-gpu-preference-'))
})
afterEach(() => {
  rmSync(userDataPath, { recursive: true, force: true })
  delete process.env.APPIMAGE
})

describe('software rendering preference [DON-288]', () => {
  it('is off for a profile that never chose it', () => {
    expect(readGpuRenderingPreference(userDataPath)).toEqual({ softwareRendering: false, problem: null })
  })

  it('is remembered after the operator chooses it', () => {
    writeSoftwareRenderingPreference(userDataPath, '2026-10-01T12:00:00.000Z')

    expect(readGpuRenderingPreference(userDataPath)).toEqual({ softwareRendering: true, problem: null })
    const stored = JSON.parse(readFileSync(path.join(userDataPath, GPU_RENDERING_PREFERENCE_FILE_NAME), 'utf8'))
    expect(stored).toEqual({ version: 1, softwareRendering: true, chosenAt: '2026-10-01T12:00:00.000Z' })
  })

  it('reports an unreadable preference instead of silently ignoring it', () => {
    writeFileSync(path.join(userDataPath, GPU_RENDERING_PREFERENCE_FILE_NAME), '{not json')

    const preference = readGpuRenderingPreference(userDataPath)

    expect(preference.softwareRendering).toBe(false)
    expect(preference.problem).toMatch(/could not be read/u)
  })

  it('ignores the GPU blocklist before the app is ready only when chosen', () => {
    const appendSwitch = vi.fn()
    expect(applyGpuRenderingPreference({ commandLine: { appendSwitch } }, userDataPath).softwareRendering).toBe(false)
    expect(appendSwitch).not.toHaveBeenCalled()

    writeSoftwareRenderingPreference(userDataPath, '2026-10-01T12:00:00.000Z')
    expect(applyGpuRenderingPreference({ commandLine: { appendSwitch } }, userDataPath).softwareRendering).toBe(true)
    expect(appendSwitch).toHaveBeenCalledWith('ignore-gpu-blocklist')
  })

  it('relaunches through the normal quit path so mission data closes cleanly', () => {
    const app = { relaunch: vi.fn(), quit: vi.fn(), exit: vi.fn() }

    relaunchWithSoftwareRendering(app, userDataPath, '2026-10-01T12:00:00.000Z')

    expect(readGpuRenderingPreference(userDataPath).softwareRendering).toBe(true)
    expect(app.relaunch).toHaveBeenCalledWith()
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('relaunches the AppImage file itself, not its temporary mount', () => {
    process.env.APPIMAGE = '/home/team/SAR-Tracker.AppImage'
    const app = { relaunch: vi.fn(), quit: vi.fn(), exit: vi.fn() }

    relaunchWithSoftwareRendering(app, userDataPath, '2026-10-01T12:00:00.000Z')

    expect(app.relaunch).toHaveBeenCalledWith({
      execPath: '/home/team/SAR-Tracker.AppImage',
      args: process.argv.slice(1),
    })
  })
})
