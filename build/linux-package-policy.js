/** Require the exact installed identity from the lock, never a manifest range. */
function lockedVersion(lock, name) {
  const version = lock.packages?.[`node_modules/${name}`]?.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
    throw new Error(`Missing or malformed locked ${name} version; regenerate and review package-lock.json.`)
  }
  return version
}

/** Compare the runtime that actually loaded SQLite with the reviewed lock. */
export function assertPackagedNativeRuntime(lock, observed) {
  const expected = {
    electron: lockedVersion(lock, 'electron'),
    betterSqlite3: lockedVersion(lock, 'better-sqlite3'),
    arch: 'x64', integrity: 'ok', value: 42,
  }
  for (const [field, value] of Object.entries(expected)) {
    if (observed[field] !== value) {
      throw new Error(`Packaged runtime ${field}: expected ${JSON.stringify(value)}, observed ${JSON.stringify(observed[field])}.`)
    }
  }
  // Loading the actual native module proves ABI compatibility. Keep the ABI
  // attestation, without duplicating Electron's version-to-ABI mapping here.
  if (typeof observed.abi !== 'string' || !/^[1-9]\d*$/.test(observed.abi)) {
    throw new Error(`Packaged runtime abi: expected a positive ABI identifier, observed ${JSON.stringify(observed.abi)}.`)
  }
}
