#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { verifyAppImageLauncher } from '../build/appimage-launcher-safety.js'
import { appImageSquashfsOffset } from '../build/appimage-offset.js'
import { inspectLinuxPackage, inspectPhysicalPackage, assertPayloadMatches, sha256 } from '../build/linux-package-inventory.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { getAppImageTools } = require('app-builder-lib/out/toolsets/linux.js')
const { Arch } = require('builder-util')

/** Require one exact installer, rejecting absent and ambiguous stale output. */
function installer(directory, extension) {
  const names = readdirSync(directory).filter((name) => name.endsWith(extension))
  if (names.length !== 1) throw new Error(`Expected exactly one ${extension} installer, found ${names.length}.`)
  return path.join(directory, names[0])
}

/** Run extraction/native probes with bounded output and a visible failure. */
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, ...options })
}

/** Inspect both finished Linux formats, binding their payloads to the smoke target. */
async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Linux installer verification requires a Linux x64 runtime; cross-host inspection is not native proof.')
  }
  const output = path.join(projectRoot, 'tmp/electron-dist')
  const receiptPath = path.join(projectRoot, 'tmp/electron-validation-evidence/package-safety.json')
  rmSync(receiptPath, { force: true })
  const appImage = installer(output, '.AppImage')
  const deb = installer(output, '.deb')
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'sartracker-package-inspection-'))
  try {
    const appDir = path.join(temporary, 'squashfs-root')
    const squashfsOffset = appImageSquashfsOffset(readFileSync(appImage))
    run('unsquashfs', ['-no-progress', '-d', appDir, '-o', String(squashfsOffset), appImage])
    const launcher = verifyAppImageLauncher(readFileSync(path.join(appDir, 'AppRun'), 'utf8'))
    const debRoot = path.join(temporary, 'deb')
    run('dpkg-deb', ['--extract', deb, debRoot])
    const debFiles = inspectPhysicalPackage(debRoot, { installationLinks: true })
    const controlRoot = path.join(temporary, 'control')
    run('dpkg-deb', ['--control', deb, controlRoot])
    const debControl = inspectPhysicalPackage(controlRoot)
    const opt = path.join(debRoot, 'opt')
    const applications = readdirSync(opt)
    if (applications.length !== 1) throw new Error('Deb must contain exactly one application under opt.')
    const lock = JSON.parse(readFileSync(path.join(projectRoot, 'package-lock.json')))
    const boundaries = [
      ['appimage', appDir],
      ['deb', path.join(opt, applications[0])],
      ['linux-unpacked', path.join(output, 'linux-unpacked')],
    ]
    const inventories = boundaries.map(([format, root]) => ({ format, ...inspectLinuxPackage(root, lock) }))
    const nativePath = 'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    // FUSE2 adds upstream toolset libraries absent from linux-unpacked. Bind
    // every such byte to the checksum-verified toolset used by this builder.
    const appImageTools = await getAppImageTools('0.0.0', Arch.x64)
    const launcherLibraries = inspectPhysicalPackage(appImageTools.runtimeLibraries)
      .map((entry) => ({ ...entry, path: `usr/lib/${entry.path}` }))
    assertPayloadMatches([...inventories[2].files, ...launcherLibraries], inventories[0].files, { appImage: true })
    assertPayloadMatches(inventories[2].files, inventories[1].files)
    const nativeFile = path.join(appDir, nativePath)
    const architecture = run('file', [nativeFile]).trim()
    if (!/ELF 64-bit LSB shared object, x86-64/.test(architecture)) throw new Error('Native SQLite is not Linux x86-64 ELF.')
    const probe = `const Database = require(${JSON.stringify(path.join(appDir, 'resources/app.asar/node_modules/better-sqlite3'))});
const db = new Database(':memory:'); db.exec('CREATE TABLE probe(value INTEGER); INSERT INTO probe VALUES (42)');
const result = { electron: process.versions.electron, abi: process.versions.modules, arch: process.arch,
sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
integrity: db.pragma('integrity_check', { simple: true }), value: db.prepare('SELECT value FROM probe').get().value };
db.close(); console.log(JSON.stringify(result));`
    const native = JSON.parse(run(path.join(appDir, 'sartracker-web'), ['-e', probe], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }).trim())
    if (native.electron !== '40.10.0' || native.abi !== '143' || native.arch !== 'x64'
      || native.integrity !== 'ok' || native.value !== 42) throw new Error('Packaged native runtime qualification failed.')
    const receipt = {
      schema: 'sartracker-linux-package-safety-v1',
      sourceHead: run('git', ['rev-parse', 'HEAD'], { cwd: projectRoot }).trim(),
      sourceTree: run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: projectRoot }).trim(),
      sourceDirty: run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: projectRoot }).trim() !== '',
      lockSha256: sha256(readFileSync(path.join(projectRoot, 'package-lock.json'))),
      installers: [appImage, deb].map((file) => ({ name: path.basename(file), sha256: sha256(readFileSync(file)) })),
      launcher, squashfsOffset, native, inventories, debFiles, debControl, launcherLibraries,
      limits: 'Named private categories/signatures only; no arbitrary embedded-secret clearance. Native probe is synthetic; lifecycle and field qualification are separate.',
    }
    mkdirSync(path.dirname(receiptPath), { recursive: true })
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    console.log(`Linux package safety passed: generated launcher, three matching package boundaries, native ABI/load/integrity. Receipt: ${receiptPath}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`Linux package safety FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
