/**
 * Pure safety predicates shared by exact-artifact release smoke scripts.
 */

const RECONCILIATION_WARNING =
  /(?:current fixes loaded; loading breadcrumb history|breadcrumb history (?:is reconciling|incomplete|could not be loaded)|breadcrumb reconciliation failed)/iu

/**
 * Returns whether tracking status still reports incomplete or failed
 * breadcrumb history reconciliation.
 *
 * @param {string} statusText
 * @returns {boolean}
 */
export function hasBreadcrumbReconciliationWarning(statusText) {
  return RECONCILIATION_WARNING.test(statusText)
}

/**
 * Compares complete filename, byte-size, and SHA-256 snapshots.
 *
 * @param {Record<string, {bytes: number, sha256: string}>} before
 * @param {Record<string, {bytes: number, sha256: string}>} after
 * @returns {boolean}
 */
export function fileSnapshotsMatch(before, after) {
  const beforeNames = Object.keys(before).sort()
  const afterNames = Object.keys(after).sort()
  if (beforeNames.length !== afterNames.length) {
    return false
  }
  for (let index = 0; index < beforeNames.length; index += 1) {
    const name = beforeNames[index]
    if (name !== afterNames[index]) {
      return false
    }
    if (
      before[name].bytes !== after[name].bytes ||
      before[name].sha256 !== after[name].sha256
    ) {
      return false
    }
  }
  return true
}

/**
 * Builds the exact startup-refusal expectation for one immutable artifact and
 * one deliberately newer disposable mission-store profile.
 *
 * @param {string} newerSchemaInput
 * @param {string} supportedSchemaInput
 * @returns {{newerSchemaVersion: number, supportedSchemaVersion: number, expectedMessage: string}}
 */
export function createNewerSchemaRefusalExpectation(
  newerSchemaInput,
  supportedSchemaInput,
) {
  const newerSchemaVersion = parseRequiredSchemaVersion(
    newerSchemaInput,
    'Newer schema version',
  )
  const supportedSchemaVersion = parseRequiredSchemaVersion(
    supportedSchemaInput,
    'Supported schema version',
  )
  if (newerSchemaVersion <= supportedSchemaVersion) {
    throw new Error(
      `Newer schema version ${newerSchemaVersion} must be newer than supported schema version ${supportedSchemaVersion}.`,
    )
  }
  return {
    newerSchemaVersion,
    supportedSchemaVersion,
    expectedMessage:
      `Cannot open mission store created by newer mission store schema ${newerSchemaVersion}; ` +
      `this build supports schema ${supportedSchemaVersion}.`,
  }
}

/** @param {string} input @param {string} label @returns {number} */
function parseRequiredSchemaVersion(input, label) {
  const normalized = typeof input === 'string' ? input.trim() : ''
  if (!/^[1-9]\d*$/u.test(normalized)) {
    throw new Error(`${label} must be a positive integer.`)
  }
  const version = Number(normalized)
  if (!Number.isSafeInteger(version)) {
    throw new Error(`${label} must be a safe integer.`)
  }
  return version
}

/**
 * Counts Electron renderer processes in the complete descendant tree of one
 * AppImage launcher. Other Electron applications on the host are excluded.
 *
 * @param {Array<{pid: number, parentPid: number, command: string}>} processes
 * @param {number} rootPid
 * @returns {number}
 */
export function countDescendantElectronRenderers(processes, rootPid) {
  const descendantPids = new Set([rootPid])
  let addedDescendant = true
  while (addedDescendant) {
    addedDescendant = false
    for (const process of processes) {
      if (
        !descendantPids.has(process.pid) &&
        descendantPids.has(process.parentPid)
      ) {
        descendantPids.add(process.pid)
        addedDescendant = true
      }
    }
  }

  return processes.filter(
    (process) =>
      process.pid !== rootPid &&
      descendantPids.has(process.pid) &&
      /(?:^|\s)--type=renderer(?:\s|$)/u.test(process.command),
  ).length
}
