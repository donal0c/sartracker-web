'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

/**
 * Checks that the profile folder can be created and written before Chromium
 * takes its single-instance lock. An unwritable profile makes that lock fail,
 * and the app used to exit silently as if another copy were open [DON-285].
 */
function checkProfileWritable(userDataPath, fsImpl = fs) {
  // A unique name, so a probe left by a killed launch can never collide.
  const probePath = path.join(userDataPath, `.sartracker-write-probe-${process.pid}-${randomUUID()}`)
  let created = false
  try {
    fsImpl.mkdirSync(userDataPath, { recursive: true })
    const descriptor = fsImpl.openSync(probePath, 'wx')
    created = true
    fsImpl.closeSync(descriptor)
    fsImpl.unlinkSync(probePath)
    created = false
    return { writable: true }
  } catch (error) {
    return { writable: false, code: typeof error?.code === 'string' ? error.code : 'UNKNOWN' }
  } finally {
    // Remove only the probe this attempt created; never anything else.
    if (created) {
      try { fsImpl.unlinkSync(probePath) } catch { /* reported as unwritable already */ }
    }
  }
}

/** Builds the operator-facing explanation for an unwritable profile. */
function describeUnwritableProfile(userDataPath, code) {
  const action = code === 'ENOSPC' || code === 'EDQUOT'
    ? 'The disk is full. Free some space, then start SAR Tracker again.'
    : code === 'EROFS'
      ? 'The disk holding it is read-only. Start SAR Tracker from a normal, writable home folder.'
      : 'Check that your user account has permission to write to this folder (it may belong to another user or have been copied with the wrong owner), then start SAR Tracker again.'
  return {
    title: 'SAR Tracker cannot start',
    message: `SAR Tracker cannot write to its data folder:\n${userDataPath}\n\n${action}\n\nNo mission data was changed. (Error: ${code})`,
  }
}

module.exports = { checkProfileWritable, describeUnwritableProfile }
