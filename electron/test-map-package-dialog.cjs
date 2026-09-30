'use strict'

const path = require('node:path')

/**
 * Environment variable the packaged release smoke sets to load a real map
 * package without a person operating the native file picker.
 */
const TEST_MAP_PACKAGE_PATH_ENV = 'SARTRACKER_ELECTRON_TEST_OFFICIAL_MAP_PACKAGE_PATH'

/**
 * Returns a dialog whose official map package picker answers with the path in
 * the test environment variable. Every other picker still opens the real
 * dialog. Without the variable the real dialog is returned unchanged.
 *
 * The answered path still goes through the normal import and verification;
 * this only replaces the operator's click in the native picker.
 */
function withTestMapPackageDialog(dialog, env = process.env, log = console.warn) {
  const configured = env[TEST_MAP_PACKAGE_PATH_ENV]
  if (typeof configured !== 'string' || configured.trim() === '') return dialog
  const answer = path.resolve(configured)
  log(`[sartracker] Test hook active: the map package picker will answer ${answer}.`)
  return {
    showOpenDialog(...args) {
      const dialogOptions = args[args.length - 1]
      if (isMapPackagePicker(dialogOptions)) {
        return Promise.resolve({ canceled: false, filePaths: [answer] })
      }
      return dialog.showOpenDialog(...args)
    },
  }
}

/** True only for the picker filtered to `.mbtiles` official map packages. */
function isMapPackagePicker(dialogOptions) {
  const filters = dialogOptions?.filters
  return Array.isArray(filters)
    && filters.some((filter) => Array.isArray(filter?.extensions) && filter.extensions.includes('mbtiles'))
}

module.exports = {
  TEST_MAP_PACKAGE_PATH_ENV,
  withTestMapPackageDialog,
}
