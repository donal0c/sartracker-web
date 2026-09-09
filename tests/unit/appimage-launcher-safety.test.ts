import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { verifyAppImageLauncher } from '../../build/appimage-launcher-safety.js'

const fixed = `#!/bin/bash
export PATH="\${APPDIR}:\${APPDIR}/usr/sbin\${PATH:+:\${PATH}}"
export XDG_DATA_DIRS="\${APPDIR}/usr/share/\${XDG_DATA_DIRS:+:\${XDG_DATA_DIRS}}:/usr/share/gnome:/usr/local/share/:/usr/share/"
export LD_LIBRARY_PATH="\${APPDIR}/usr/lib\${LD_LIBRARY_PATH:+:\${LD_LIBRARY_PATH}}"
export GSETTINGS_SCHEMA_DIR="\${APPDIR}/usr/share/glib-2.0/schemas\${GSETTINGS_SCHEMA_DIR:+:\${GSETTINGS_SCHEMA_DIR}}"
`

describe('generated AppImage search paths [DON-146]', () => {
  it('accepts the selected builder actual generated launcher, not just a fixture', () => {
    const require = createRequire(import.meta.url)
    const { generateAppRunScript } = require('app-builder-lib/out/targets/appimage/appImageUtil.js')
    const launcher = generateAppRunScript({ ExecutableName: 'sartracker-web', ProductName: 'SAR Tracker Electron Validation', ProductFilename: 'SAR Tracker Electron Validation', DesktopFileName: 'sartracker-web.desktop', ResourceName: 'appimagekit-sartracker-web' })
    expect(verifyAppImageLauncher(launcher).cases).toHaveLength(3)
  })
  it('rejects the affected launcher without loading any library or application', () => {
    const affected = fixed.replace(
      '${APPDIR}/usr/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}',
      '${APPDIR}/usr/lib:${LD_LIBRARY_PATH}',
    )
    expect(() => verifyAppImageLauncher(affected)).toThrow(/LD_LIBRARY_PATH/)
  })

  it('checks unset, empty and populated inherited search paths', () => {
    expect(verifyAppImageLauncher(fixed).cases).toEqual(['unset', 'empty', 'populated'])
  })

  it.each(['PATH', 'XDG_DATA_DIRS', 'LD_LIBRARY_PATH', 'GSETTINGS_SCHEMA_DIR'])(
    'fails closed on missing, duplicate or altered %s exports', (name) => {
      const line = fixed.split('\n').find((item) => item.startsWith(`export ${name}=`))!
      expect(() => verifyAppImageLauncher(fixed.replace(line, ''))).toThrow(name)
      expect(() => verifyAppImageLauncher(`${fixed}\n${line}`)).toThrow(name)
      expect(() => verifyAppImageLauncher(fixed.replace(line, `${line}:`))).toThrow(name)
    },
  )

  it('does not accept an additional loader reassignment after the checked export', () => {
    expect(() => verifyAppImageLauncher(`${fixed}\nLD_LIBRARY_PATH=.:/tmp`)).toThrow(/LD_LIBRARY_PATH/)
  })

  it.each(['export OTHER=value LD_LIBRARY_PATH="$LD_LIBRARY_PATH:"', 'declare -x LD_LIBRARY_PATH="$LD_LIBRARY_PATH:"'])(
    'rejects an unrecognized loader reference: %s', (assignment) => {
      expect(() => verifyAppImageLauncher(`${fixed}\n${assignment}`)).toThrow(/LD_LIBRARY_PATH/)
    },
  )

  it('requires the package command to inspect generated installer bytes', () => {
    const script = readFileSync('scripts/electron-package.mjs', 'utf8')
    expect(script).toContain('scripts/verify-linux-package.mjs')
    expect(script.indexOf('scripts/verify-linux-package.mjs')).toBeGreaterThan(script.indexOf("'electron-builder'"))
  })
})
