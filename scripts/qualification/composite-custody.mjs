import { constants } from 'node:fs'
import { copyFile, lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { hashCandidateFile } from './candidate-artifacts.mjs'

/** Enumerate only the fixed composite byte references, never arbitrary report paths. */
function referenceSlots(report) {
  const slots = []
  const add = (key, parent, field, digestField, limit) => {
    if (parent?.[field] !== undefined && parent[field] !== null) {
      slots.push({key,parent,field,digestField,limit})
    }
  }
  add('composite-app.asar', report?.app, 'retainedPackagedAppPath', 'retainedPackagedAppSha256', 512 * 1024 ** 2)
  add('composite-pass-pages.ndjson', report?.phases?.markerSearch?.passPaging ?? report?.failure?.c11RawPaging,
    'rawPagesPath', 'rawPagesSha256', 64 * 1024 ** 2)
  add('composite-diagnostic-output.txt', report?.phases?.sanitizedDiagnostics,
    'retainedOutputPath', 'outputSha256', 1024 ** 2)
  add('composite-diagnostic-canaries.txt', report?.phases?.sanitizedDiagnostics,
    'retainedCanaryManifestPath', 'canaryManifestSha256', 4096)
  return slots
}

/** Resolve one regular file within a canonical custody root, rejecting symlink escapes. */
async function custodyFile(filename, root, limit) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || path.resolve(filename) !== filename) {
    throw new Error('Composite reference must be a canonical absolute path.')
  }
  const base = await realpath(root)
  const relative = path.relative(base, filename)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Composite reference escapes evidence custody.')
  const stat = await lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || await realpath(filename) !== filename) {
    throw new Error('Composite reference is not a bounded regular custody file.')
  }
  return hashCandidateFile(filename)
}

/** Copy immutable raw bytes into the sealed attempt before the runtime work root is removed. */
export async function retainCompositeReferences({report,evidenceDirectory,attemptDirectory}) {
  const references = []
  for (const slot of referenceSlots(report)) {
    const source = await custodyFile(slot.parent[slot.field], evidenceDirectory, slot.limit)
    if (source.sha256 !== slot.parent[slot.digestField]) throw new Error('Composite source reference identity differs from the raw report.')
    const destination = path.join(attemptDirectory, slot.key)
    await copyFile(source.path, destination, constants.COPYFILE_EXCL)
    const copied = await custodyFile(destination, attemptDirectory, slot.limit)
    const after = await custodyFile(source.path, evidenceDirectory, slot.limit)
    if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes
      || after.sha256 !== source.sha256 || after.bytes !== source.bytes) throw new Error('Composite reference identity changed during retention.')
    references.push({key:slot.key,originalPath:source.path,path:slot.key,sha256:source.sha256,bytes:source.bytes})
  }
  return references
}

/** Re-hash flat retained files and project only their paths; preserve the original observed report. */
export async function rebindCompositeReferences({report,references,attemptDirectory}) {
  const rebound = structuredClone(report)
  const slots = referenceSlots(rebound)
  if (!Array.isArray(references) || references.length !== slots.length) throw new Error('Composite retained reference inventory is incomplete.')
  for (const slot of slots) {
    const matches = references.filter((entry) => entry?.key === slot.key)
    if (matches.length !== 1) throw new Error('Composite retained reference inventory is duplicated or missing.')
    const entry = matches[0]
    if (entry.path !== slot.key || entry.originalPath !== slot.parent[slot.field]
      || entry.sha256 !== slot.parent[slot.digestField]) throw new Error('Composite retained reference binding differs from the raw report.')
    const identity = await custodyFile(path.join(attemptDirectory,slot.key), attemptDirectory, slot.limit)
    if (identity.sha256 !== entry.sha256 || identity.bytes !== entry.bytes) throw new Error('Composite retained reference identity changed.')
    slot.parent[slot.field] = identity.path
  }
  return rebound
}
