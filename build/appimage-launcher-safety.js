import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const exportsByName = {
  PATH: 'export PATH="${APPDIR}:${APPDIR}/usr/sbin${PATH:+:${PATH}}"',
  XDG_DATA_DIRS: 'export XDG_DATA_DIRS="${APPDIR}/usr/share/${XDG_DATA_DIRS:+:${XDG_DATA_DIRS}}:/usr/share/gnome:/usr/local/share/:/usr/share/"',
  LD_LIBRARY_PATH: 'export LD_LIBRARY_PATH="${APPDIR}/usr/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"',
  GSETTINGS_SCHEMA_DIR: 'export GSETTINGS_SCHEMA_DIR="${APPDIR}/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:${GSETTINGS_SCHEMA_DIR}}"',
}

// Complete commands from the selected builder template, without EULA support.
// Never exempt a prefix: shell operators or substitutions can reassign a path.
const dialogCommands = new Set([
  'LD_LIBRARY_PATH="" zenity --error --text "${1}" 2>/dev/null',
  'LD_LIBRARY_PATH="" kdialog --msgbox "${1}" 2>/dev/null',
  'LD_LIBRARY_PATH="" Xdialog --msgbox "${1}" 2>/dev/null',
  'LD_LIBRARY_PATH="" zenity --question --title="$TITLE" --text="$TEXT" 2>/dev/null || exit 0',
  'LD_LIBRARY_PATH="" kdialog --title "$TITLE" --yesno "$TEXT" || exit 0',
  'LD_LIBRARY_PATH="" Xdialog --title "$TITLE" --clear --yesno "$TEXT" 10 80 || exit 0',
])

/**
 * Inspect generated AppRun bytes, then evaluate only its allow-listed exports
 * in bash. Never execute the application or arbitrary launcher commands. Fail
 * closed on upstream template drift; a version check cannot replace this gate.
 * Caller-provided malformed paths are outside the empty/unset advisory case.
 */
export function verifyAppImageLauncher(source) {
  if (typeof source !== 'string' || source.length > 128 * 1024 || !/^#!(?:\/bin\/bash|\/usr\/bin\/env bash)\n/.test(source)) {
    throw new Error('AppRun must be a bounded bash launcher.')
  }
  const lines = source.split('\n').map((line) => line.trim())
  for (const [name, expected] of Object.entries(exportsByName)) {
    const assignments = lines.filter((line) => !line.startsWith('#') && new RegExp(`\\b${name}\\b`).test(line))
      // Upstream clears the loader variable only for these optional host dialogs.
      .filter((line) => !(name === 'LD_LIBRARY_PATH' && dialogCommands.has(line)))
    if (assignments.length !== 1 || assignments[0] !== expected) {
      throw new Error(`Unsafe or unrecognized AppRun ${name} assignment.`)
    }
  }
  const names = Object.keys(exportsByName)
  const cases = ['unset', 'empty', 'populated']
  for (const scenario of cases) {
    const env = { APPDIR: '/sartracker-package-probe' }
    if (scenario !== 'unset') {
      for (const name of names) env[name] = scenario === 'empty' ? '' : '/inherited/one:/inherited/two'
    }
    // Bash synthesizes PATH when absent at process start; explicitly unset it
    // inside the probe so the unset test exercises the intended boundary.
    const reset = scenario === 'unset' ? `unset ${names.join(' ')}\n` : ''
    const probe = `${reset}${Object.values(exportsByName).join('\n')}\nprintf '%s\\n' ${names.map((name) => `"$${name}"`).join(' ')}`
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', probe], {
      env, encoding: 'utf8', timeout: 5000, maxBuffer: 8192,
    })
    if (result.status !== 0 || result.error) throw new Error(`AppRun search-path probe failed (${scenario}).`)
    const values = result.stdout.replace(/\n$/, '').split('\n')
    if (values.length !== names.length) throw new Error('AppRun probe returned incomplete paths.')
    for (const [index, value] of values.entries()) {
      if (value.split(':').some((part) => !part.startsWith('/'))) {
        throw new Error(`AppRun ${names[index]} admits an empty or relative search path (${scenario}).`)
      }
      if (scenario === 'populated' && !value.includes('/inherited/one:/inherited/two')) {
        throw new Error(`AppRun ${names[index]} discarded inherited search paths.`)
      }
    }
  }
  return { sha256: createHash('sha256').update(source).digest('hex'), cases }
}
