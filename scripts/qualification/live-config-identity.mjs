import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const REQUIRED_FILES = Object.freeze(['credentials.json', 'settings.json'])
const MAX_JSON_BYTES = 1024 * 1024

/**
 * Hash the exact private live configuration directory without retaining its
 * contents. Only the two reviewed JSON members are accepted; their bounded
 * byte identities are combined into a deterministic directory digest.
 *
 * @param {string} directory private live configuration directory
 * @returns {Promise<object>} safe path, byte and digest metadata
 */
export async function hashLiveConfigDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Live config directory must be absolute.')
  const resolved = path.resolve(directory)
  const directoryInfo = await lstat(resolved)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Live config directory must be a real directory.')
  const names = (await readdir(resolved)).sort()
  if (names.length !== REQUIRED_FILES.length || names.some((name, index) => name !== REQUIRED_FILES[index])) {
    throw new Error('Live config directory must contain exactly credentials.json and settings.json.')
  }
  const files = []
  for (const name of REQUIRED_FILES) {
    const filePath = path.join(resolved, name)
    const fileInfo = await lstat(filePath)
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error('Live config members must be regular non-symlink files.')
    if (!Number.isSafeInteger(fileInfo.size) || fileInfo.size <= 0 || fileInfo.size > MAX_JSON_BYTES) {
      throw new Error(`Live config member ${name} exceeds the bounded 1 MiB JSON input limit.`)
    }
    const bytes = await readFile(filePath)
    if (bytes.byteLength !== fileInfo.size) throw new Error('Live config member changed while hashing.')
    try { JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`Live config member ${name} is not valid JSON.`) }
    files.push(Object.freeze({ name, bytes: bytes.byteLength, sha256: sha256(bytes) }))
  }
  const canonical = files.map((file) => `${file.name}\0${file.bytes}\0${file.sha256}\0`).join('')
  return Object.freeze({
    path: resolved,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256(Buffer.from(canonical, 'utf8')),
    files: Object.freeze(files),
  })
}

/** Return the deterministic SHA-256 identity of bounded bytes. */
function sha256(value) { return createHash('sha256').update(value).digest('hex') }

export { MAX_JSON_BYTES, REQUIRED_FILES }
