'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const {
  normalizeArchiveCustodyOperationTicket,
} = require('./archive-custody-operation-envelope.cjs')

const HASH_CHUNK_BYTES = 1024 * 1024
const PROGRESS_REPORT_BYTES = 8 * 1024 * 1024

/** Signals one safe closed filesystem outcome rather than a worker fault. */
class CustodyOutcomeError extends Error {
  /** Creates an outcome-bearing internal control-flow error. */
  constructor(outcome) {
    super(`Archive custody operation stopped safely (${outcome}).`)
    this.name = 'CustodyOutcomeError'
    this.outcome = outcome
  }
}

/** Throws cancellation at bounded worker checkpoints. */
function assertNotCancelled(cancellationFlag) {
  if (Atomics.load(cancellationFlag, 0) !== 0) {
    const error = new Error('Archive custody operation was cancelled.')
    error.code = 'ARCHIVE_CANCELLED'
    throw error
  }
}

/** Projects one bigint stat into the closed custody identity. */
function projectFileIdentity(stat) {
  const sizeBytes = Number(stat.size)
  const linkCount = Number(stat.nlink)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1
    || !Number.isSafeInteger(linkCount) || ![1, 2].includes(linkCount)) {
    throw new CustodyOutcomeError('not_regular')
  }
  return Object.freeze({
    changedTimeNanoseconds: stat.ctimeNs.toString(),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    linkCount,
    modifiedTimeNanoseconds: stat.mtimeNs.toString(),
    sizeBytes,
  })
}

/** Returns whether two identities are byte-for-byte filesystem-equal. */
function sameExactIdentity(left, right) {
  return left.changedTimeNanoseconds === right.changedTimeNanoseconds
    && left.device === right.device
    && left.inode === right.inode
    && left.linkCount === right.linkCount
    && left.modifiedTimeNanoseconds === right.modifiedTimeNanoseconds
    && left.sizeBytes === right.sizeBytes
}

/** Returns whether one post-link identity remains the original inode and bytes. */
function sameTransferIdentity(expected, observed) {
  return expected.device === observed.device
    && expected.inode === observed.inode
    && expected.modifiedTimeNanoseconds === observed.modifiedTimeNanoseconds
    && expected.sizeBytes === observed.sizeBytes
    && BigInt(observed.changedTimeNanoseconds) >= BigInt(expected.changedTimeNanoseconds)
}

/** Returns whether two identities denote the same current inode. */
function sameInode(left, right) {
  return left.device === right.device && left.inode === right.inode
}

/** Validates and permission-restricts the configured custody root. */
function prepareCustodyRoot(archiveDirectory, allowAbsent = false) {
  let root
  try {
    root = fs.lstatSync(archiveDirectory, { bigint: true })
  } catch (error) {
    if (allowAbsent && error?.code === 'ENOENT') return false
    throw new Error('Archive custody root is unavailable.')
  }
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error('Archive custody root is unsafe.')
  }
  fs.chmodSync(archiveDirectory, 0o700)
  return true
}

/** Traverses existing ancestors without following symbolic links. */
function inspectParent(root, relativePath) {
  const segments = relativePath.split('/')
  let parent = root
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment)
    let stat
    try {
      stat = fs.lstatSync(parent, { bigint: true })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return Object.freeze({ state: 'missing', parent, path: path.join(root, ...segments) })
      }
      return Object.freeze({ state: 'unsafe', parent, path: path.join(root, ...segments) })
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return Object.freeze({ state: 'unsafe', parent, path: path.join(root, ...segments) })
    }
    fs.chmodSync(parent, 0o700)
  }
  return Object.freeze({ state: 'ready', parent, path: path.join(root, ...segments) })
}

/** Creates only missing target ancestors and rejects every symbolic-link ancestor. */
function ensureParent(root, relativePath) {
  const segments = relativePath.split('/')
  let parent = root
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment)
    try {
      fs.mkdirSync(parent, { mode: 0o700 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const stat = fs.lstatSync(parent, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CustodyOutcomeError('not_regular')
    }
    fs.chmodSync(parent, 0o700)
  }
  return Object.freeze({ parent, path: path.join(root, ...segments) })
}

/** Returns every affected ancestor from the immediate parent back to the custody root. */
function custodyAncestorDirectories(root, relativePath) {
  const segments = relativePath.split('/').slice(0, -1)
  const directories = [root]
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    directories.push(current)
  }
  return directories.reverse()
}

/** Inspects one final component without following it. */
function inspectNode(root, relativePath) {
  const resolved = inspectParent(root, relativePath)
  if (resolved.state === 'unsafe') return Object.freeze({ ...resolved, state: 'unsafe' })
  if (resolved.state === 'missing') return Object.freeze({ ...resolved, state: 'absent' })
  try {
    const stat = fs.lstatSync(resolved.path, { bigint: true })
    return Object.freeze({ ...resolved, state: 'present', stat })
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ ...resolved, state: 'absent' })
    return Object.freeze({ ...resolved, state: 'unsafe' })
  }
}

/** Requires the publish operation directory to contain only its one expected staging file. */
function assertPublishOperationDirectory(ticket, sourceExpected) {
  const operationRelativePath = path.posix.dirname(ticket.stagingRelativePath)
  const operationDirectory = inspectNode(ticket.archiveDirectory, operationRelativePath)
  if (operationDirectory.state === 'absent' && !sourceExpected) return null
  if (operationDirectory.state !== 'present' || !operationDirectory.stat.isDirectory()
    || operationDirectory.stat.isSymbolicLink()) {
    throw new CustodyOutcomeError('not_regular')
  }
  fs.chmodSync(operationDirectory.path, 0o700)
  const before = fs.lstatSync(operationDirectory.path, { bigint: true })
  const entries = fs.readdirSync(operationDirectory.path).sort()
  const after = fs.lstatSync(operationDirectory.path, { bigint: true })
  if (!before.isDirectory() || before.isSymbolicLink()
    || !after.isDirectory() || after.isSymbolicLink()
    || before.dev !== after.dev || before.ino !== after.ino
    || before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs) {
    throw new CustodyOutcomeError('changed')
  }
  const expectedEntries = sourceExpected ? [path.basename(ticket.stagingRelativePath)] : []
  if (entries.length !== expectedEntries.length
    || entries.some((entry, index) => entry !== expectedEntries[index])) {
    throw new CustodyOutcomeError('changed')
  }
  return operationDirectory
}

/** Removes only the exact empty publish operation directory without recursive deletion. */
function removeEmptyPublishOperationDirectory(ticket) {
  const operationDirectory = assertPublishOperationDirectory(ticket, false)
  if (operationDirectory === null) return
  try {
    fs.rmdirSync(operationDirectory.path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    if (error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST') {
      throw new CustodyOutcomeError('changed')
    }
    if (error?.code === 'ENOTDIR' || error?.code === 'ELOOP') {
      throw new CustodyOutcomeError('not_regular')
    }
    throw error
  }
}

/** Requires a regular permission-restricted file with the allowed link count. */
function requireRegularIdentity(node, allowedLinkCounts) {
  if (node.state !== 'present' || !node.stat.isFile() || node.stat.isSymbolicLink()
    || (node.stat.mode & 0o777n) !== 0o600n) {
    throw new CustodyOutcomeError('not_regular')
  }
  const identity = projectFileIdentity(node.stat)
  if (!allowedLinkCounts.includes(identity.linkCount)) {
    throw new CustodyOutcomeError('not_regular')
  }
  return identity
}

/** Opens and pins one candidate without following its final component. */
function openPinnedCandidate(node, allowedLinkCounts) {
  const pathIdentity = requireRegularIdentity(node, allowedLinkCounts)
  let descriptor
  try {
    descriptor = fs.openSync(
      node.path,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const openedStat = fs.fstatSync(descriptor, { bigint: true })
    if (!openedStat.isFile() || openedStat.isSymbolicLink?.()) {
      throw new CustodyOutcomeError('not_regular')
    }
    const openedIdentity = projectFileIdentity(openedStat)
    if (!allowedLinkCounts.includes(openedIdentity.linkCount)
      || !sameExactIdentity(pathIdentity, openedIdentity)) {
      throw new CustodyOutcomeError('changed')
    }
    return { descriptor, node, identity: openedIdentity }
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
    if (error instanceof CustodyOutcomeError) throw error
    throw new CustodyOutcomeError('changed')
  }
}

/** Revalidates a pinned descriptor and its path against an exact current identity. */
function assertPinnedCurrent(pinned, allowedLinkCounts) {
  let descriptorStat
  let pathStat
  try {
    descriptorStat = fs.fstatSync(pinned.descriptor, { bigint: true })
    pathStat = fs.lstatSync(pinned.node.path, { bigint: true })
  } catch {
    throw new CustodyOutcomeError('changed')
  }
  if (!descriptorStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new CustodyOutcomeError('changed')
  }
  const descriptorIdentity = projectFileIdentity(descriptorStat)
  const pathIdentity = projectFileIdentity(pathStat)
  if (!allowedLinkCounts.includes(descriptorIdentity.linkCount)
    || !allowedLinkCounts.includes(pathIdentity.linkCount)
    || !sameExactIdentity(descriptorIdentity, pathIdentity)) {
    throw new CustodyOutcomeError('changed')
  }
  return descriptorIdentity
}

/** Hashes every byte from a pinned descriptor with bounded cancellation checks. */
function hashPinnedCandidate(pinned, cancellationFlag, onProgress) {
  const digest = createHash('sha256')
  const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
  let completed = 0
  let lastReported = 0
  try {
    while (completed < pinned.identity.sizeBytes) {
      assertNotCancelled(cancellationFlag)
      const length = Math.min(chunk.length, pinned.identity.sizeBytes - completed)
      const bytesRead = fs.readSync(pinned.descriptor, chunk, 0, length, completed)
      if (bytesRead < 1) throw new CustodyOutcomeError('changed')
      digest.update(chunk.subarray(0, bytesRead))
      completed += bytesRead
      if (completed === pinned.identity.sizeBytes
        || completed - lastReported >= PROGRESS_REPORT_BYTES) {
        onProgress(completed, pinned.identity.sizeBytes)
        lastReported = completed
      }
    }
    const extra = fs.readSync(pinned.descriptor, chunk, 0, 1, completed)
    if (extra !== 0) throw new CustodyOutcomeError('changed')
    return digest.digest('hex')
  } finally {
    chunk.fill(0)
  }
}

/** Fully proves one candidate against the journalled inode, size, and ciphertext hash. */
function verifyCandidate({
  node,
  ticket,
  cancellationFlag,
  identityMode,
  allowedLinkCounts,
  emitHashProgress,
}) {
  const pinned = openPinnedCandidate(node, allowedLinkCounts)
  try {
    const identityMatches = identityMode === 'exact'
      ? sameExactIdentity(ticket.expectedFileIdentity, pinned.identity)
      : sameTransferIdentity(ticket.expectedFileIdentity, pinned.identity)
    if (!identityMatches || pinned.identity.sizeBytes !== ticket.expectedSizeBytes) {
      throw new CustodyOutcomeError('changed')
    }
    const digest = hashPinnedCandidate(pinned, cancellationFlag, emitHashProgress)
    const currentIdentity = assertPinnedCurrent(pinned, allowedLinkCounts)
    if (digest !== ticket.expectedCiphertextSha256) {
      throw new CustodyOutcomeError('changed')
    }
    pinned.identity = currentIdentity
    return pinned
  } catch (error) {
    fs.closeSync(pinned.descriptor)
    throw error
  }
}

/** Fsyncs one descriptor and every affected safe directory before success. */
function syncFileAndDirectories(descriptor, directories) {
  if (descriptor !== null) fs.fsyncSync(descriptor)
  const unique = [...new Set(directories)]
  for (const directory of unique) {
    let stat
    try {
      stat = fs.lstatSync(directory, { bigint: true })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Archive custody sync parent became unsafe.')
    }
    const descriptorForDirectory = fs.openSync(
      directory,
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0),
    )
    try {
      fs.fsyncSync(descriptorForDirectory)
    } finally {
      fs.closeSync(descriptorForDirectory)
    }
  }
}

/** Constructs one exact closed worker result. */
function createResult(ticket, outcome, sourceIdentity = null, targetIdentity = null) {
  return Object.freeze({
    type: 'complete',
    protocolVersion: ticket.protocolVersion,
    maintenanceOperationId: ticket.maintenanceOperationId,
    creationOperationId: ticket.creationOperationId,
    journalRevision: ticket.journalRevision,
    action: ticket.action,
    sourceRelativePath: ticket.sourceRelativePath,
    targetRelativePath: ticket.targetRelativePath,
    outcome,
    sourceIdentity,
    targetIdentity,
    directoriesSynced: true,
  })
}

/** Returns a final single-link target identity after one completed transfer. */
function readCompletedTarget(ticket) {
  const target = inspectNode(ticket.archiveDirectory, ticket.targetRelativePath)
  if (target.state !== 'present') throw new Error('Archive custody target disappeared.')
  const identity = requireRegularIdentity(target, [1])
  if (!sameTransferIdentity(ticket.expectedFileIdentity, identity)) {
    throw new Error('Archive custody target identity changed after transfer.')
  }
  return identity
}

/** Finishes one same-inode link state without ever unlinking an unrelated source. */
function finishLinkedTransfer(ticket, pinned, emit) {
  const linkedSource = inspectNode(ticket.archiveDirectory, ticket.sourceRelativePath)
  const linkedTarget = inspectNode(ticket.archiveDirectory, ticket.targetRelativePath)
  if (linkedSource.state !== 'present' || linkedTarget.state !== 'present') {
    throw new CustodyOutcomeError('changed')
  }
  const sourceIdentity = requireRegularIdentity(linkedSource, [2])
  const targetIdentity = requireRegularIdentity(linkedTarget, [2])
  if (!sameInode(sourceIdentity, targetIdentity)
    || !sameInode(pinned.identity, targetIdentity)) {
    throw new CustodyOutcomeError('both_present')
  }
  syncFileAndDirectories(
    pinned.descriptor,
    custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
  )
  const currentSource = inspectNode(ticket.archiveDirectory, ticket.sourceRelativePath)
  if (currentSource.state !== 'present') {
    if (ticket.action === 'publish') {
      try {
        removeEmptyPublishOperationDirectory(ticket)
      } catch (error) {
        if (!(error instanceof CustodyOutcomeError)) throw error
        syncFileAndDirectories(pinned.descriptor, [
          ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
          ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
        ])
        fs.closeSync(pinned.descriptor)
        emit('sync', 'directories', 1, 1)
        return createResult(ticket, error.outcome)
      }
      emit('cleanup', 'files', 1, 1)
    }
    syncFileAndDirectories(pinned.descriptor, [
      ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
      ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
    ])
    const completedIdentity = readCompletedTarget(ticket)
    fs.closeSync(pinned.descriptor)
    emit('sync', 'directories', 1, 1)
    return createResult(ticket, 'moved', null, completedIdentity)
  }
  const currentSourceIdentity = requireRegularIdentity(currentSource, [2])
  if (!sameInode(currentSourceIdentity, pinned.identity)) {
    fs.closeSync(pinned.descriptor)
    throw new CustodyOutcomeError('both_present')
  }
  fs.unlinkSync(currentSource.path)
  if (ticket.action === 'publish') {
    try {
      removeEmptyPublishOperationDirectory(ticket)
    } catch (error) {
      if (!(error instanceof CustodyOutcomeError)) throw error
      syncFileAndDirectories(pinned.descriptor, [
        ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
        ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
      ])
      fs.closeSync(pinned.descriptor)
      emit('sync', 'directories', 1, 1)
      return createResult(ticket, error.outcome)
    }
  }
  emit('cleanup', 'files', 1, 1)
  syncFileAndDirectories(pinned.descriptor, [
    ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
    ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
  ])
  const completedIdentity = readCompletedTarget(ticket)
  fs.closeSync(pinned.descriptor)
  emit('sync', 'directories', 1, 1)
  return createResult(ticket, 'moved', null, completedIdentity)
}

/** Inspects the journalled staging file when quarantine source and target are absent. */
function inspectStagingOnly(ticket) {
  const staging = inspectNode(ticket.archiveDirectory, ticket.stagingRelativePath)
  if (staging.state === 'unsafe') throw new CustodyOutcomeError('not_regular')
  if (staging.state === 'absent') return false
  requireRegularIdentity(staging, [1])
  return true
}

/** Executes publish or quarantine via crash-recoverable no-overwrite link then unlink. */
function transferArchive(ticket, cancellationFlag, emit) {
  assertNotCancelled(cancellationFlag)
  const source = inspectNode(ticket.archiveDirectory, ticket.sourceRelativePath)
  const target = inspectNode(ticket.archiveDirectory, ticket.targetRelativePath)
  emit('inspect', 'files', 1, 1)
  if (source.state === 'unsafe' || target.state === 'unsafe') {
    syncFileAndDirectories(null, [ticket.archiveDirectory])
    emit('sync', 'directories', 1, 1)
    return createResult(ticket, 'not_regular')
  }
  if (source.state === 'absent' && target.state === 'absent') {
    let outcome = 'neither_present'
    try {
      if (ticket.action === 'quarantine' && inspectStagingOnly(ticket)) {
        outcome = 'staging_only'
      }
    } catch (error) {
      if (!(error instanceof CustodyOutcomeError)) throw error
      outcome = error.outcome
    }
    syncFileAndDirectories(null, [ticket.archiveDirectory])
    emit('sync', 'directories', 1, 1)
    return createResult(ticket, outcome)
  }
  if (source.state === 'absent') {
    let pinned
    try {
      if (ticket.action === 'publish') assertPublishOperationDirectory(ticket, false)
      pinned = verifyCandidate({
        node: target,
        ticket,
        cancellationFlag,
        identityMode: 'transfer',
        allowedLinkCounts: [1],
        emitHashProgress: (completed, total) => emit('hash', 'bytes', completed, total),
      })
      fs.fsyncSync(pinned.descriptor)
      if (ticket.action === 'publish') {
        removeEmptyPublishOperationDirectory(ticket)
        emit('cleanup', 'files', 1, 1)
      }
      fs.closeSync(pinned.descriptor)
      syncFileAndDirectories(null, [
        ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
        ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
      ])
      emit('sync', 'directories', 1, 1)
      return createResult(ticket, 'target_only', null, readCompletedTarget(ticket))
    } catch (error) {
      if (pinned?.descriptor !== undefined) {
        try { fs.closeSync(pinned.descriptor) } catch {}
      }
      if (error instanceof CustodyOutcomeError) {
        syncFileAndDirectories(null, [ticket.archiveDirectory])
        emit('sync', 'directories', 1, 1)
        return createResult(ticket, error.outcome)
      }
      throw error
    }
  }
  if (target.state === 'present') {
    let sourceIdentity
    let targetIdentity
    try {
      sourceIdentity = requireRegularIdentity(source, [1, 2])
      targetIdentity = requireRegularIdentity(target, [1, 2])
    } catch (error) {
      if (error instanceof CustodyOutcomeError) {
        syncFileAndDirectories(null, [ticket.archiveDirectory])
        emit('sync', 'directories', 1, 1)
        return createResult(ticket, error.outcome)
      }
      throw error
    }
    if (!sameInode(sourceIdentity, targetIdentity)) {
      if (sourceIdentity.linkCount !== 1 || targetIdentity.linkCount !== 1) {
        syncFileAndDirectories(null, [ticket.archiveDirectory])
        emit('sync', 'directories', 1, 1)
        return createResult(ticket, 'not_regular')
      }
      syncFileAndDirectories(null, [
        ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
        ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
      ])
      emit('sync', 'directories', 1, 1)
      return createResult(ticket, 'both_present', sourceIdentity, targetIdentity)
    }
    if (sourceIdentity.linkCount !== 2 || targetIdentity.linkCount !== 2) {
      syncFileAndDirectories(null, [ticket.archiveDirectory])
      emit('sync', 'directories', 1, 1)
      return createResult(ticket, 'not_regular')
    }
    try {
      if (ticket.action === 'publish') assertPublishOperationDirectory(ticket, true)
      const pinned = verifyCandidate({
        node: target,
        ticket,
        cancellationFlag,
        identityMode: 'transfer',
        allowedLinkCounts: [2],
        emitHashProgress: (completed, total) => emit('hash', 'bytes', completed, total),
      })
      return finishLinkedTransfer(ticket, pinned, emit)
    } catch (error) {
      if (error instanceof CustodyOutcomeError) {
        syncFileAndDirectories(null, [ticket.archiveDirectory])
        emit('sync', 'directories', 1, 1)
        if (error.outcome === 'both_present') {
          const currentSource = inspectNode(ticket.archiveDirectory, ticket.sourceRelativePath)
          const currentTarget = inspectNode(ticket.archiveDirectory, ticket.targetRelativePath)
          if (currentSource.state === 'present' && currentTarget.state === 'present') {
            return createResult(
              ticket,
              'both_present',
              requireRegularIdentity(currentSource, [1]),
              requireRegularIdentity(currentTarget, [1]),
            )
          }
        }
        return createResult(ticket, error.outcome)
      }
      throw error
    }
  }

  let pinned
  try {
    if (ticket.action === 'publish') assertPublishOperationDirectory(ticket, true)
    pinned = verifyCandidate({
      node: source,
      ticket,
      cancellationFlag,
      identityMode: ticket.action === 'publish' ? 'exact' : 'transfer',
      allowedLinkCounts: [1],
      emitHashProgress: (completed, total) => emit('hash', 'bytes', completed, total),
    })
    assertNotCancelled(cancellationFlag)
    const targetResolved = ensureParent(ticket.archiveDirectory, ticket.targetRelativePath)
    assertPinnedCurrent(pinned, [1])
    try {
      fs.linkSync(source.path, targetResolved.path)
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const currentSource = inspectNode(ticket.archiveDirectory, ticket.sourceRelativePath)
        const currentTarget = inspectNode(ticket.archiveDirectory, ticket.targetRelativePath)
        if (currentSource.state === 'present' && currentTarget.state === 'present') {
          const currentSourceIdentity = requireRegularIdentity(currentSource, [1, 2])
          const currentTargetIdentity = requireRegularIdentity(currentTarget, [1, 2])
          if (sameInode(currentSourceIdentity, currentTargetIdentity)
            && currentSourceIdentity.linkCount === 2 && currentTargetIdentity.linkCount === 2) {
            pinned.identity = assertPinnedCurrent(pinned, [2])
            return finishLinkedTransfer(ticket, pinned, emit)
          }
          fs.closeSync(pinned.descriptor)
          pinned = null
          if (currentSourceIdentity.linkCount === 1 && currentTargetIdentity.linkCount === 1) {
            syncFileAndDirectories(null, [
              ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
              ...custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
            ])
            emit('sync', 'directories', 1, 1)
            return createResult(
              ticket,
              'both_present',
              currentSourceIdentity,
              currentTargetIdentity,
            )
          }
        }
      }
      fs.closeSync(pinned.descriptor)
      pinned = null
      if (error?.code === 'EEXIST') throw new CustodyOutcomeError('changed')
      throw error
    }
    emit('transfer', 'files', 1, 1)
    const linkedTarget = inspectNode(ticket.archiveDirectory, ticket.targetRelativePath)
    let linkedIdentity
    try {
      linkedIdentity = requireRegularIdentity(linkedTarget, [2])
    } catch (error) {
      try { fs.unlinkSync(targetResolved.path) } catch {}
      syncFileAndDirectories(
        null,
        custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
      )
      throw error
    }
    if (!sameInode(linkedIdentity, pinned.identity)) {
      fs.unlinkSync(targetResolved.path)
      syncFileAndDirectories(
        null,
        custodyAncestorDirectories(ticket.archiveDirectory, ticket.targetRelativePath),
      )
      throw new CustodyOutcomeError('changed')
    }
    pinned.identity = assertPinnedCurrent(pinned, [2])
    return finishLinkedTransfer(ticket, pinned, emit)
  } catch (error) {
    if (pinned?.descriptor !== undefined) {
      try { fs.closeSync(pinned.descriptor) } catch {}
    }
    if (error instanceof CustodyOutcomeError) {
      syncFileAndDirectories(null, [ticket.archiveDirectory])
      emit('sync', 'directories', 1, 1)
      return createResult(ticket, error.outcome)
    }
    throw error
  }
}

/** Recursively removes one exact operation directory without following symlink entries. */
function removeTreeNoFollow(directoryPath, cancellationFlag) {
  assertNotCancelled(cancellationFlag)
  const rootStat = fs.lstatSync(directoryPath, { bigint: true })
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new CustodyOutcomeError('not_regular')
  }
  fs.chmodSync(directoryPath, 0o700)
  for (const entry of fs.readdirSync(directoryPath)) {
    assertNotCancelled(cancellationFlag)
    const entryPath = path.join(directoryPath, entry)
    const stat = fs.lstatSync(entryPath, { bigint: true })
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      removeTreeNoFollow(entryPath, cancellationFlag)
    } else {
      fs.unlinkSync(entryPath)
    }
  }
  fs.rmdirSync(directoryPath)
}

/** Removes only the exact journalled abandoned staging operation directory. */
function cleanupStaging(ticket, cancellationFlag, emit) {
  assertNotCancelled(cancellationFlag)
  const finalNode = inspectNode(ticket.archiveDirectory, ticket.finalRelativePath)
  const source = inspectNode(ticket.archiveDirectory, ticket.sourceRelativePath)
  emit('inspect', 'files', 1, 1)
  if (finalNode.state !== 'absent') {
    syncFileAndDirectories(null, [ticket.archiveDirectory])
    emit('sync', 'directories', 1, 1)
    return createResult(ticket, finalNode.state === 'present' ? 'unexpected_final' : 'not_regular')
  }
  if (source.state === 'unsafe') {
    syncFileAndDirectories(null, [ticket.archiveDirectory])
    emit('sync', 'directories', 1, 1)
    return createResult(ticket, 'not_regular')
  }
  if (source.state === 'absent') {
    syncFileAndDirectories(null, [ticket.archiveDirectory])
    emit('sync', 'directories', 1, 1)
    return createResult(ticket, 'source_absent')
  }
  if (!source.stat.isDirectory() || source.stat.isSymbolicLink()) {
    syncFileAndDirectories(
      null,
      custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
    )
    emit('sync', 'directories', 1, 1)
    return createResult(ticket, 'not_regular')
  }
  try {
    removeTreeNoFollow(source.path, cancellationFlag)
  } catch (error) {
    if (error instanceof CustodyOutcomeError) {
      syncFileAndDirectories(
        null,
        custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
      )
      emit('sync', 'directories', 1, 1)
      return createResult(ticket, error.outcome)
    }
    throw error
  }
  emit('cleanup', 'files', 1, 1)
  syncFileAndDirectories(
    null,
    custodyAncestorDirectories(ticket.archiveDirectory, ticket.sourceRelativePath),
  )
  emit('sync', 'directories', 1, 1)
  return createResult(ticket, 'removed')
}

/** Runs one normalized custody operation and emits bounded closed progress. */
function runArchiveCustodyOperation(ticket, cancellationFlag, onProgress) {
  let sequence = 0
  /** Emits one closed monotonically sequenced progress message. */
  const emit = (phase, unit, completed, total) => {
    sequence += 1
    onProgress({
      type: 'progress',
      maintenanceOperationId: ticket.maintenanceOperationId,
      sequence,
      phase,
      unit,
      completed,
      total,
    })
  }
  assertNotCancelled(cancellationFlag)
  const rootPresent = prepareCustodyRoot(
    ticket.archiveDirectory,
    ticket.action === 'staging_cleanup',
  )
  emit('preflight', 'phases', 1, 1)
  if (!rootPresent) {
    emit('inspect', 'files', 1, 1)
    emit('sync', 'directories', 1, 1)
    return createResult(ticket, 'source_absent')
  }
  if (ticket.action === 'staging_cleanup') {
    return cleanupStaging(ticket, cancellationFlag, emit)
  }
  return transferArchive(ticket, cancellationFlag, emit)
}

/** Owns worker-thread message handling and closed terminal error projection. */
function runWorkerMain() {
  let ticket
  try {
    ticket = normalizeArchiveCustodyOperationTicket(workerData?.ticket)
    if (!(workerData?.cancellationBuffer instanceof SharedArrayBuffer)
      || workerData.cancellationBuffer.byteLength !== Int32Array.BYTES_PER_ELEMENT) {
      throw new Error('Archive custody operation cancellation state is invalid.')
    }
    const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
    const result = runArchiveCustodyOperation(
      ticket,
      cancellationFlag,
      (progress) => parentPort.postMessage(progress),
    )
    parentPort.postMessage(result)
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      maintenanceOperationId: ticket?.maintenanceOperationId ?? null,
      code: error?.code === 'ARCHIVE_CANCELLED'
        ? 'ARCHIVE_CANCELLED'
        : 'ARCHIVE_CUSTODY_OPERATION_FAILED',
    })
  }
}

if (!isMainThread) runWorkerMain()
