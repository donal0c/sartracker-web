'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')

/**
 * Creates the desktop handoff used for one private archive-review stage.
 *
 * Linux Electron shells can leave shell.openPath pending after the desktop
 * viewer has opened the file. shell.openExternal resolves when the external
 * URL handoff is accepted, so use it for the Linux file URI and leave the
 * operator-facing UI to describe a handoff rather than a confirmed open.
 */
function createArchiveReviewDesktopOpener(input) {
  if (input === null || typeof input !== 'object'
    || input.shell === null || typeof input.shell !== 'object'
    || typeof input.shell.openExternal !== 'function'
    || typeof input.shell.openPath !== 'function') {
    throw new TypeError('Archive review desktop opener requires an Electron shell.')
  }

  const platform = input.platform ?? process.platform
  return async function openArchiveReviewStage(stagePath) {
    if (typeof stagePath !== 'string' || stagePath.length === 0
      || !path.isAbsolute(stagePath) || stagePath.includes('\0')) {
      throw new TypeError('Archive review desktop opener requires an absolute stage path.')
    }
    if (platform === 'linux') {
      await input.shell.openExternal(pathToFileURL(stagePath).href)
      return undefined
    }
    return input.shell.openPath(stagePath)
  }
}

module.exports = {
  createArchiveReviewDesktopOpener,
}
