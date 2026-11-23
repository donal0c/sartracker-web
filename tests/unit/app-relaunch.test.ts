import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { requestRelaunch } = require('../../electron/app-relaunch.cjs') as {
  requestRelaunch: (
    app: { relaunch: (...args: unknown[]) => void },
    env?: Record<string, string | undefined>,
    argv?: string[],
  ) => { execPath: string }
}

describe('requestRelaunch [M-46]', () => {
  it('relaunches the AppImage file, not its temporary mount', () => {
    const app = { relaunch: vi.fn() }

    const result = requestRelaunch(
      app,
      { APPIMAGE: '/home/team/SAR-Tracker.AppImage' },
      ['/tmp/.mount_SAR/sartracker', '--no-sandbox'],
    )

    expect(app.relaunch).toHaveBeenCalledWith({
      execPath: '/home/team/SAR-Tracker.AppImage',
      args: ['--no-sandbox'],
    })
    expect(result).toEqual({ execPath: 'appimage' })
  })

  it.each([undefined, '', '   '])('relaunches the current executable when APPIMAGE is %j', (value) => {
    const app = { relaunch: vi.fn() }

    const result = requestRelaunch(app, { APPIMAGE: value }, ['/usr/bin/sartracker'])

    expect(app.relaunch).toHaveBeenCalledWith()
    expect(result).toEqual({ execPath: 'current' })
  })
})
