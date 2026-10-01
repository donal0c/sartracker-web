'use strict'

const fs = require('node:fs')
const path = require('node:path')

const GPU_RENDERING_PREFERENCE_FILE_NAME = 'gpu-rendering-preference.json'
const PREFERENCE_VERSION = 1

/**
 * Reads the operator's remembered software-rendering choice [DON-288].
 * A missing file means "not chosen". An unreadable file is reported as a
 * problem for the runtime log rather than being silently treated as valid.
 */
function readGpuRenderingPreference(userDataPath) {
  const preferencePath = path.join(userDataPath, GPU_RENDERING_PREFERENCE_FILE_NAME)
  let contents
  try {
    contents = fs.readFileSync(preferencePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { softwareRendering: false, problem: null }
    return { softwareRendering: false, problem: `Software rendering preference could not be read (${error?.code ?? 'unknown error'}).` }
  }
  try {
    const parsed = JSON.parse(contents)
    if (parsed?.version !== PREFERENCE_VERSION || typeof parsed.softwareRendering !== 'boolean') {
      return { softwareRendering: false, problem: 'Software rendering preference could not be read (unexpected contents).' }
    }
    return { softwareRendering: parsed.softwareRendering, problem: null }
  } catch {
    return { softwareRendering: false, problem: 'Software rendering preference could not be read (invalid JSON).' }
  }
}

/** Atomically records that the operator chose software rendering. */
function writeSoftwareRenderingPreference(userDataPath, chosenAt) {
  const preferencePath = path.join(userDataPath, GPU_RENDERING_PREFERENCE_FILE_NAME)
  const temporaryPath = `${preferencePath}.${process.pid}.tmp`
  const contents = `${JSON.stringify({ version: PREFERENCE_VERSION, softwareRendering: true, chosenAt })}\n`
  const descriptor = fs.openSync(temporaryPath, 'w')
  try {
    fs.writeFileSync(descriptor, contents)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  fs.renameSync(temporaryPath, preferencePath)
}

/**
 * Applies the remembered choice before Electron is ready: Chromium reads GPU
 * switches only at startup. The switch lets a blocklisted GPU use WebGL,
 * which on the test box renders in software (llvmpipe).
 */
function applyGpuRenderingPreference(app, userDataPath) {
  const preference = readGpuRenderingPreference(userDataPath)
  if (preference.softwareRendering) app.commandLine.appendSwitch('ignore-gpu-blocklist')
  return preference
}

/**
 * Remembers the operator's choice, then restarts through the normal quit path
 * so the mission store and logs close cleanly. An AppImage must relaunch the
 * .AppImage file, because its mounted executable disappears when it quits.
 */
function relaunchWithSoftwareRendering(app, userDataPath, chosenAt) {
  writeSoftwareRenderingPreference(userDataPath, chosenAt)
  const appImagePath = process.env.APPIMAGE
  if (typeof appImagePath === 'string' && appImagePath.trim() !== '') {
    app.relaunch({ execPath: appImagePath, args: process.argv.slice(1) })
  } else {
    app.relaunch()
  }
  app.quit()
}

module.exports = {
  GPU_RENDERING_PREFERENCE_FILE_NAME,
  applyGpuRenderingPreference,
  readGpuRenderingPreference,
  relaunchWithSoftwareRendering,
  writeSoftwareRenderingPreference,
}
