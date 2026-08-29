const MAX_GPX_IMPORT_MISSION_ID_LENGTH = 1_000
const MAX_GPX_IMPORT_PATH_LENGTH = 4_096
const MAX_GPX_IMPORT_PATHS = 100

/** Validates the bounded renderer/worker GPX import envelope before runtime work begins. */
function validateGpxImportEnvelope(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('GPX import payload must be an object.')
  }
  if (typeof input.missionId !== 'string'
    || input.missionId.length < 1
    || input.missionId.length > MAX_GPX_IMPORT_MISSION_ID_LENGTH) {
    throw new Error('GPX import mission ID must be between 1 and 1000 characters.')
  }
  const missionId = input.missionId.trim()
  if (missionId === '') {
    throw new Error('GPX import mission ID must be between 1 and 1000 characters.')
  }
  return {
    missionId,
    paths: normalizeGpxImportPaths(input.paths),
  }
}

/** Bounds a GPX path collection before mapping or dispatching any entry. */
function normalizeGpxImportPaths(paths, label = 'GPX import') {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_GPX_IMPORT_PATHS) {
    throw new Error(
      `${label} path count must be between 1 and 100; more than 100 paths cannot be imported.`,
    )
  }
  return paths.map((entry) => normalizeRawGpxPath(entry, `${label} path`))
}

/** Bounds one raw path before trimming, resolving, normalizing, or inspecting it. */
function normalizeRawGpxPath(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }
  if (value.length > MAX_GPX_IMPORT_PATH_LENGTH) {
    throw new Error(`${label} must be 4096 characters or fewer.`)
  }
  const normalized = value.trim()
  if (normalized === '') {
    throw new Error(`${label} is required.`)
  }
  return normalized
}

module.exports = {
  MAX_GPX_IMPORT_MISSION_ID_LENGTH,
  MAX_GPX_IMPORT_PATH_LENGTH,
  MAX_GPX_IMPORT_PATHS,
  normalizeGpxImportPaths,
  normalizeRawGpxPath,
  validateGpxImportEnvelope,
}
