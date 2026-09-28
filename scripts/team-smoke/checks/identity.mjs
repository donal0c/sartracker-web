/**
 * Artifact identity: the draft installers match `SHA256SUMS`, and the
 * installed .deb payload is byte-identical to the package.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { NotTested, expectProduct } from '../lib/results.mjs'

/** SHA-256 of a file. */
async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

/** Checks one installer against the SHA256SUMS manifest. */
function artifactCheck(check, id, option) {
  return {
    check,
    id,
    async run(ctx) {
      const file = ctx.options[option]
      if (file === undefined) throw new NotTested(`Pass --${option === 'appImage' ? 'appimage' : 'deb'} and --sha256sums.`)
      if (ctx.options.sha256sums === undefined) throw new NotTested('Pass --sha256sums from the draft release.')
      const manifest = new Map((await readFile(ctx.options.sha256sums, 'utf8')).trim().split('\n')
        .map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/u.exec(line.trim()))
        .filter(Boolean)
        .map((match) => [path.basename(match[2]), match[1]]))
      const digest = await sha256(file)
      const expected = manifest.get(path.basename(file))
      expectProduct(expected !== undefined, `${path.basename(file)} is not listed in SHA256SUMS.`)
      expectProduct(expected === digest, `${path.basename(file)} is ${digest}, SHA256SUMS says ${expected}.`)
      return `\`${path.basename(file)}\` \`${digest}\`; matches SHA256SUMS. CI artifact and draft agreement: confirm the files came from the draft.`
    },
  }
}

/** Lists regular files under a directory, relative to it. */
async function listFiles(root, dir = root) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await listFiles(root, full))
    else if (entry.isFile()) out.push(path.relative(root, full))
  }
  return out
}

export default [
  artifactCheck('AppImage SHA-256', 'identity-appimage', 'appImage'),
  artifactCheck('.deb SHA-256', 'identity-deb', 'deb'),
  {
    check: 'Installed .deb payload',
    id: 'installed-payload',
    async run(ctx) {
      if (ctx.options.deb === undefined) throw new NotTested('Pass --deb.')
      const field = (name) => execFileSync('dpkg-deb', ['-f', ctx.options.deb, name], { encoding: 'utf8' }).trim()
      const pkg = field('Package')
      const version = field('Version')
      let installed
      try {
        installed = execFileSync('dpkg-query', ['-W', '-f=${Version}', pkg], { encoding: 'utf8' }).trim()
      } catch {
        throw new NotTested(`${pkg} is not installed. Install the exact .deb with apt first.`)
      }
      if (installed !== version) throw new NotTested(`Installed ${pkg} is ${installed}, the .deb is ${version}.`)
      const verify = execFileSync('dpkg', ['-V', pkg], { encoding: 'utf8' }).trim()
      expectProduct(verify === '', `dpkg -V reports changes: ${verify.slice(0, 300)}`)
      const extracted = await mkdtemp(path.join(os.tmpdir(), 'team-smoke-deb-'))
      try {
        execFileSync('dpkg-deb', ['-x', ctx.options.deb, extracted])
        const files = await listFiles(extracted)
        const different = []
        for (const file of files) {
          const installedFile = path.join('/', file)
          const same = await stat(installedFile).then(() => true, () => false)
            && await sha256(installedFile) === await sha256(path.join(extracted, file))
          if (!same) different.push(file)
        }
        expectProduct(different.length === 0, `${different.length} installed files differ from the package: ${different.slice(0, 5).join(', ')}`)
        return `${pkg} ${version} installed; dpkg -V clean; ${files.length}/${files.length} payload files byte-identical.`
      } finally {
        await rm(extracted, { recursive: true, force: true })
      }
    },
  },
]
