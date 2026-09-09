import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, lstatSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const privateName = /\.(?:sararch|sararchive|zip|sqlite|sqlite3|db|mbtiles|pmtiles|gpkg|gpx|tiff?|p12|pfx|pem|key)(?:-(?:wal|shm))?$|(?:^|\/)(?:tmp|test-results|verification|scratch|profiles?|evidence|raw-evidence|diagnostics|fixtures|\.git|\.env(?:\.[^/]*)?|id_rsa)(?:\/|$)|(?:^|\/)(?:credentials?|secrets?|cookies|login data)(?:\.json)?$/i

/** Reject named private payloads and known database/archive signatures, without printing content. */
export function assertPublicPackageEntry(name, bytes) {
  if (privateName.test(name)
    || bytes.subarray(0, 16).toString() === 'SQLite format 3\0'
    || bytes.subarray(0, 8).toString() === 'SARARCH2'
    || bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    throw new Error(`Package contains a prohibited private-data category: ${name}`)
  }
}

/** Hash the actual bytes observed at a package boundary. */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Scan every physical entry, including Debian files outside the app directory. */
export function inspectPhysicalPackage(root, { installationLinks = false } = {}) {
  root = realpathSync(root)
  const files = []
  /** Walk without following links outside the extracted boundary. */
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const filename = path.join(directory, name)
      const relative = path.relative(root, filename)
      const stat = lstatSync(filename)
      assertPublicPackageEntry(relative, Buffer.alloc(0))
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(filename)
        const resolved = installationLinks && path.isAbsolute(target)
          ? path.join(root, target) : path.resolve(path.dirname(filename), target)
        if (!resolved.startsWith(`${root}${path.sep}`)
          || !realpathSync(resolved).startsWith(`${root}${path.sep}`)) {
          throw new Error(`Package symlink escapes inspected root: ${relative}`)
        }
        files.push({ boundary: 'physical', path: relative, symlink: target })
      } else if (stat.isDirectory()) walk(filename)
      else if (stat.isFile()) {
        const bytes = readFileSync(filename)
        assertPublicPackageEntry(relative, bytes)
        files.push({ boundary: 'physical', path: relative, size: bytes.length, sha256: sha256(bytes), executableBits: stat.mode & 0o111 })
      } else throw new Error(`Unsupported package entry: ${relative}`)
    }
  }
  walk(root)
  return files
}

/** Bind all runtime and extra-resource bytes to the unpacked smoke target. */
export function assertPayloadMatches(reference, candidate, { appImage = false } = {}) {
  // FPM adds these to linux-unpacked after AppImage construction. They are
  // Debian installation controls, not shared runtime payload; Debian must
  // still match them byte-for-byte, and both are scanned for private data.
  const expected = new Map(reference.filter((entry) => entry.boundary === 'physical'
    && !(appImage && ['resources/apparmor-profile', 'resources/package-type'].includes(entry.path)))
    .map((entry) => [entry.path, entry]))
  const observed = new Map(candidate.filter((entry) => entry.boundary === 'physical').map((entry) => [entry.path, entry]))
  for (const [name, entry] of expected) {
    const other = observed.get(name)
    if (!other) throw new Error(`Installer payload missing: ${name}`)
    if (JSON.stringify(entry) !== JSON.stringify(other)) throw new Error(`Installer payload bytes differ: ${name}`)
  }
  for (const name of observed.keys()) {
    if (!expected.has(name) && !(appImage && /^(?:AppRun|\.DirIcon|sartracker-web\.(?:desktop|png|svg)|usr\/share\/icons\/.+)$/.test(name))) {
      throw new Error(`Installer payload has unexpected extra entry: ${name}`)
    }
  }
}

/** Inspect all physical files plus logical ASAR entries; match shipped modules to the lock. */
export function inspectLinuxPackage(root, lock) {
  const files = inspectPhysicalPackage(root)
  const packages = []
  const archive = path.join(root, 'resources/app.asar')
  const allowed = new Set(Object.entries(lock.packages).filter(([key]) => key).map(([key, value]) =>
    `${value.name ?? key.split('node_modules/').at(-1)}@${value.version}`))
  /** Record an entry without exposing its contents. */
  function inspect(boundary, name, bytes) {
    assertPublicPackageEntry(name, bytes)
    files.push({ boundary, path: name, size: bytes.length, sha256: sha256(bytes) })
  }
  for (const entry of asar.listPackage(archive)) {
    const name = entry.replace(/^\//, '')
    const stat = asar.statFile(archive, name, false)
    if (stat.files) continue
    if (stat.link) throw new Error(`Unexpected ASAR link: ${name}`)
    const bytes = asar.extractFile(archive, name)
    inspect('asar', name, bytes)
    if (/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package.json$/.test(name)) {
      const pkg = JSON.parse(bytes)
      if (!allowed.has(`${pkg.name}@${pkg.version}`)) throw new Error(`Packaged dependency not in lock: ${pkg.name}@${pkg.version}`)
      packages.push({ name: pkg.name, version: pkg.version, path: name })
    }
  }
  if (!packages.some((pkg) => pkg.name === 'better-sqlite3' && pkg.version === '12.10.0')) {
    throw new Error('Expected unchanged better-sqlite3 package is missing.')
  }
  return { asarSha256: sha256(readFileSync(archive)), files, packages }
}
