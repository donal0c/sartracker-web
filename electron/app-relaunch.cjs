'use strict'

/**
 * Asks Electron to start a replacement process once this one exits.
 *
 * An AppImage runs from a temporary squashfs mount that disappears when the
 * process exits, so relaunching `process.execPath` would start nothing. When
 * `APPIMAGE` names the .AppImage file, relaunch that file instead [M-46].
 *
 * @param {{ relaunch: (options?: { execPath: string, args: string[] }) => void }} app
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string[]} [argv]
 * @returns {{ execPath: 'appimage' | 'current' }} which executable was requested, for diagnostics
 */
function requestRelaunch(app, env = process.env, argv = process.argv) {
  const appImagePath = env.APPIMAGE
  if (typeof appImagePath === 'string' && appImagePath.trim() !== '') {
    app.relaunch({ execPath: appImagePath, args: argv.slice(1) })
    return { execPath: 'appimage' }
  }
  app.relaunch()
  return { execPath: 'current' }
}

module.exports = { requestRelaunch }
