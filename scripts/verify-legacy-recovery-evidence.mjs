import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const directory = fileURLToPath(new URL('../docs/evidence/legacy-object-recovery/', import.meta.url))
const manifestPath = path.join(directory, 'manifest.json')
const files = {}

/** Includes every descendant file; only the self-referential root manifest is excluded. */
async function collect(relative = '') {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name)
    if (name === 'manifest.json') continue
    assert.ok(!entry.isSymbolicLink(), `Evidence cannot be a symlink: ${name}`)
    if (entry.isDirectory()) await collect(name)
    else {
      assert.ok(entry.isFile(), `Unsupported evidence entry: ${name}`)
      const bytes = await readFile(path.join(directory, name))
      files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    }
  }
}

assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--write'),
  'Usage: node scripts/verify-legacy-recovery-evidence.mjs [--write]')
await collect()
if (process.argv[2] === '--write') {
  await writeFile(manifestPath, `${JSON.stringify({ schema: 'don254-legacy-object-evidence-v2',
    excludes: ['manifest.json'], files }, null, 2)}\n`)
} else {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.schema, 'don254-legacy-object-evidence-v2')
  assert.deepEqual(manifest.excludes, ['manifest.json'])
  assert.deepEqual(manifest.files, files, 'Legacy recovery evidence manifest has missing, stale or extra entries.')
}
console.log(`Legacy recovery evidence manifest: ${Object.keys(files).length} files verified.`)
