import { describe, expect, it } from 'vitest'
import { assertPublicPackageEntry, assertPayloadMatches, inspectPhysicalPackage, inspectLinuxPackage } from '../../build/linux-package-inventory.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

describe('packaged private-data exclusion [DON-146]', () => {
  it('opens logical ASAR entries and rejects private data hidden behind an innocent name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sartracker-asar-inventory-'))
    const require = createRequire(import.meta.url)
    const asar = require('@electron/asar')
    try {
      const source = join(root, 'source')
      const bundle = join(root, 'bundle')
      mkdirSync(source)
      mkdirSync(join(bundle, 'resources'), { recursive: true })
      writeFileSync(join(source, 'innocent.bin'), 'SQLite format 3\0synthetic fixture')
      await asar.createPackage(source, join(bundle, 'resources/app.asar'))
      expect(() => inspectLinuxPackage(bundle, { packages: {} })).toThrow(/private/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it.each(['maps/private.mbtiles', 'data/mission.sqlite', 'x/archive.sararchive',
    'profile/Cookies', 'scratch/output.json', '.env', 'credentials.json',
    'tmp/receipt.json', 'test-results/screenshot.png', 'evidence/raw.json',
    'maps/source.tif', 'maps/source.gpkg', 'mission-track.gpx', 'diagnostics/raw.json'])('rejects %s', (name) => {
    expect(() => assertPublicPackageEntry(name, Buffer.from('synthetic'))).toThrow(/private/)
  })
  it.each(['SQLite format 3\0', 'SARARCH2', 'PK\x03\x04'])('rejects renamed private payload signature', (signature) => {
    expect(() => assertPublicPackageEntry('dist/renamed.bin', Buffer.from(signature))).toThrow(/private/)
  })
  it('retains application modules and curated manual screenshots', () => {
    expect(() => assertPublicPackageEntry('electron/credentials-store.cjs', Buffer.from('module.exports = {}'))).not.toThrow()
    expect(() => assertPublicPackageEntry('dist/manual/assets/example.png', Buffer.from('PNG'))).not.toThrow()
  })

  it('inspects Debian payload outside the application directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'sartracker-deb-inventory-'))
    try {
      mkdirSync(join(root, 'usr/share'), { recursive: true })
      writeFileSync(join(root, 'usr/share/credentials.json'), '{}')
      expect(() => inspectPhysicalPackage(root)).toThrow(/private/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('binds extra resources and runtime libraries to the smoke target', () => {
    const file = { boundary: 'physical', path: 'resources/field-tools/collector.sh', sha256: 'a', size: 1 }
    expect(() => assertPayloadMatches([file], [{ ...file, sha256: 'b' }])).toThrow(/differ/)
    expect(() => assertPayloadMatches([file], [])).toThrow(/missing/)
    expect(() => assertPayloadMatches([file], [file, { ...file, path: 'libExtra.so' }])).toThrow(/unexpected/)
    expect(() => assertPayloadMatches([file], [file])).not.toThrow()
    expect(() => assertPayloadMatches([{ ...file, executableBits: 0o111 }], [{ ...file, executableBits: 0 }])).toThrow(/differ/)
  })

  it('separates Debian-only installation metadata without excluding it from Debian checks', () => {
    const metadata = { boundary: 'physical', path: 'resources/apparmor-profile', sha256: 'a', size: 1 }
    expect(() => assertPayloadMatches([metadata], [], { appImage: true })).not.toThrow()
    expect(() => assertPayloadMatches([metadata], [])).toThrow(/missing/)
    expect(() => assertPayloadMatches([metadata], [{ ...metadata, sha256: 'b' }])).toThrow(/differ/)
  })

  it('rejects application symlinks escaping the inspected runtime root', () => {
    const root = mkdtempSync(join(tmpdir(), 'sartracker-link-inventory-'))
    try {
      mkdirSync(join(root, 'resources'))
      symlinkSync('/etc/hosts', join(root, 'resources/app.asar'))
      expect(() => inspectPhysicalPackage(root)).toThrow(/escape/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
