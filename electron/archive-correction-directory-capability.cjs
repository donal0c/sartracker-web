'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { createHash } = require('node:crypto')

const {
  correctionAttachmentPeerName,
  isCorrectionAttachmentTargetName,
} = require('./archive-correction-custody.cjs')

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u

/** Captures one real directory identity without lossy numeric conversion. */
function captureCorrectionDirectoryIdentity(directory = '.') {
  const identity = fs.lstatSync(directory, { bigint: true })
  if (!identity.isDirectory() || identity.isSymbolicLink()) {
    throw new Error('Archive correction directory capability is unsafe.')
  }
  return Object.freeze({ dev: identity.dev.toString(), ino: identity.ino.toString() })
}

/** Requires the utility process cwd to retain the identity authorized by its parent. */
function assertCorrectionDirectoryIdentity(expected) {
  const observed = captureCorrectionDirectoryIdentity('.')
  if (observed.dev !== expected?.dev || observed.ino !== expected?.ino) {
    throw new Error('Archive correction directory capability changed identity.')
  }
  return observed
}

/** Descends one safe component and proves chdir entered the inode observed before descent. */
function enterCorrectionDirectoryComponent(component) {
  if (!isDirectoryComponent(component)) {
    throw new Error('Archive correction directory component is invalid.')
  }
  try {
    fs.mkdirSync(component, { mode: 0o700 })
    syncCurrentDirectory()
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  const before = captureCorrectionDirectoryIdentity(component)
  process.chdir(component)
  const after = captureCorrectionDirectoryIdentity('.')
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error('Archive correction directory changed during capability descent.')
  }
  return after
}

/** Descends one already-existing safe component without creating filesystem state. */
function enterExistingCorrectionDirectoryComponent(component) {
  if (!isDirectoryComponent(component)) {
    throw new Error('Archive correction directory component is invalid.')
  }
  const before = captureCorrectionDirectoryIdentity(component)
  process.chdir(component)
  const after = captureCorrectionDirectoryIdentity('.')
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error('Archive correction directory changed during capability descent.')
  }
  return after
}

/** Enters the exact mission attachment root from a database-directory cwd. */
function enterCorrectionAttachmentRoot(missionId) {
  if (!isDirectoryComponent(missionId)) {
    throw new Error('Archive correction mission attachment identity is invalid.')
  }
  enterCorrectionDirectoryComponent('missions')
  enterCorrectionDirectoryComponent(missionId)
  return enterCorrectionDirectoryComponent('attachments')
}

/** Enters an existing mission attachment root without any recovery-time mutation. */
function enterExistingCorrectionAttachmentRoot(missionId) {
  if (!isDirectoryComponent(missionId)) {
    throw new Error('Archive correction mission attachment identity is invalid.')
  }
  enterExistingCorrectionDirectoryComponent('missions')
  enterExistingCorrectionDirectoryComponent(missionId)
  return enterExistingCorrectionDirectoryComponent('attachments')
}

/** Creates one immutable retained peer and publishes it by an exact hardlink. */
async function createCorrectionAttachmentPair(input) {
  validatePairInput(input)
  let source
  let peer
  try {
    source = await fsp.open(
      input.sourcePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const sourceStat = await source.stat({ bigint: true })
    const expectedSize = BigInt(input.expected.sizeBytes)
    if (!sourceStat.isFile() || sourceStat.nlink !== 1n
      || sourceStat.size !== expectedSize
      || sourceStat.size < 1n || sourceStat.size > BigInt(MAX_ATTACHMENT_BYTES)) {
      throw new Error('Archive correction attachment source is not a bounded regular file.')
    }
    peer = await fsp.open(
      input.peerName,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const opened = await peer.stat({ bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n || (opened.mode & 0o777n) !== 0o600n) {
      throw new Error('Archive correction retained attachment peer is unsafe.')
    }
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    while (offset < input.expected.sizeBytes) {
      if (input.isCancelled?.() === true) {
        const error = new Error('Archive correction attachment copy was cancelled.')
        error.code = 'ARCHIVE_CANCELLED'
        throw error
      }
      const read = await source.read(
        chunk,
        0,
        Math.min(chunk.length, input.expected.sizeBytes - offset),
        offset,
      )
      if (read.bytesRead < 1) {
        throw new Error('Archive correction attachment ended before its pinned size.')
      }
      hash.update(chunk.subarray(0, read.bytesRead))
      await writeFully(peer, chunk, read.bytesRead)
      offset += read.bytesRead
    }
    const sha256 = hash.digest('hex')
    if (offset !== input.expected.sizeBytes || sha256 !== input.expected.sha256) {
      throw new Error('Archive correction attachment digest does not match its archive proof.')
    }
    await peer.sync()
  } finally {
    await peer?.close().catch(() => undefined)
    await source?.close().catch(() => undefined)
  }
  await fsp.link(input.peerName, input.targetName)
  await syncCurrentDirectoryAsync()
  verifyCorrectionAttachmentPair(input)
  return Object.freeze({
    targetName: input.targetName,
    peerName: input.peerName,
    sizeBytes: input.expected.sizeBytes,
    sha256: input.expected.sha256,
  })
}

/** Classifies exact operation-owned residue without mutating it. */
function inspectCorrectionAttachmentResidue(input) {
  return proveCorrectionAttachmentResidue(input).state
}

/** Computes the full digest and topology proof used by two-phase reconciliation. */
function proveCorrectionAttachmentResidue(input) {
  validatePairInput(input)
  const target = safeLeafStat(input.targetName)
  const peer = safeLeafStat(input.peerName)
  if (target === null && peer === null) {
    return attachmentResidueProof('absent', null, null)
  }
  if (target === null && peer !== null) {
    requireSafeInertPeer(peer)
    if (peer.size === BigInt(input.expected.sizeBytes)) {
      requireExpectedProof(digestRelativeAttachment(input.peerName, peer.size), input.expected)
    }
    const peerAfter = safeLeafStat(input.peerName)
    if (peerAfter === null || !sameAttachmentIdentity(peer, peerAfter)) {
      throw new Error('Archive correction retained attachment peer changed during proof.')
    }
    return attachmentResidueProof('peer', null, peerAfter)
  }
  if (target === null || peer === null) {
    throw new Error('Archive correction attachment residue has one missing owner name.')
  }
  requireSafeAttachmentIdentity(target, 2n)
  requireSafeAttachmentIdentity(peer, 2n)
  if (target.dev !== peer.dev || target.ino !== peer.ino || target.size !== peer.size) {
    throw new Error('Archive correction attachment retained-peer identity is invalid.')
  }
  requireExpectedProof(digestRelativeAttachment(input.targetName, target.size), input.expected)
  const targetAfter = safeLeafStat(input.targetName)
  const peerAfter = safeLeafStat(input.peerName)
  if (targetAfter === null || peerAfter === null
    || !sameAttachmentIdentity(target, targetAfter)
    || !sameAttachmentIdentity(peer, peerAfter)
    || targetAfter.dev !== peerAfter.dev || targetAfter.ino !== peerAfter.ino) {
    throw new Error('Archive correction attachment pair changed during proof.')
  }
  return attachmentResidueProof('pair', targetAfter, peerAfter)
}

/** Rechecks only bounded metadata while the SQLite clear transaction is held. */
function revalidateCorrectionAttachmentResidue(input, observation) {
  validatePairInput(input)
  if (observation === null || typeof observation !== 'object' || Array.isArray(observation)
    || Object.keys(observation).sort().join(',') !== 'peer,state,target,version'
    || observation.version !== 1
    || !['absent', 'peer', 'pair'].includes(observation.state)) {
    throw new Error('Archive correction attachment residue proof is invalid.')
  }
  const target = safeLeafStat(input.targetName)
  const peer = safeLeafStat(input.peerName)
  if (observation.state === 'absent') {
    if (observation.target !== null || observation.peer !== null
      || target !== null || peer !== null) {
      throw new Error('Archive correction attachment residue changed before clear.')
    }
    return 'absent'
  }
  if (observation.state === 'peer') {
    if (observation.target !== null || target !== null || peer === null) {
      throw new Error('Archive correction attachment peer changed before clear.')
    }
    requireSafeInertPeer(peer)
    if (!matchesAttachmentIdentity(peer, observation.peer)) {
      throw new Error('Archive correction attachment peer identity changed before clear.')
    }
    return 'peer'
  }
  if (target === null || peer === null) {
    throw new Error('Archive correction attachment pair changed before clear.')
  }
  requireSafeAttachmentIdentity(target, 2n)
  requireSafeAttachmentIdentity(peer, 2n)
  if (target.dev !== peer.dev || target.ino !== peer.ino || target.size !== peer.size
    || !matchesAttachmentIdentity(target, observation.target)
    || !matchesAttachmentIdentity(peer, observation.peer)) {
    throw new Error('Archive correction attachment pair identity changed before clear.')
  }
  return 'pair'
}

/** Allows an unpublished, operation-owned peer to remain inert after an interrupted write. */
function requireSafeInertPeer(identity) {
  if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1n
    || (identity.mode & 0o777n) !== 0o600n
    || identity.size < 0n || identity.size > BigInt(MAX_ATTACHMENT_BYTES)) {
    throw new Error('Archive correction retained attachment peer residue is invalid.')
  }
}

/** Proves the public name and retained peer are the sole links to expected bytes. */
function verifyCorrectionAttachmentPair(input) {
  const observation = proveCorrectionAttachmentResidue(input)
  if (observation.state !== 'pair') {
    throw new Error('Archive correction attachment retained pair is incomplete.')
  }
  return Object.freeze({
    dev: observation.target.dev,
    ino: observation.target.ino,
    nlink: Number(observation.target.nlink),
    sizeBytes: input.expected.sizeBytes,
    sha256: input.expected.sha256,
  })
}

/** Reads and hashes one relative leaf through a no-follow descriptor. */
function digestRelativeAttachment(name, expectedSize) {
  const boundedExpectedSize = typeof expectedSize === 'bigint'
    ? Number(expectedSize)
    : expectedSize
  if (!Number.isSafeInteger(boundedExpectedSize)
    || boundedExpectedSize < 1 || boundedExpectedSize > MAX_ATTACHMENT_BYTES) {
    throw new Error('Archive correction attachment proof size is invalid.')
  }
  let descriptor
  try {
    descriptor = fs.openSync(name, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const before = fs.fstatSync(descriptor, { bigint: true })
    const named = fs.lstatSync(name, { bigint: true })
    if (!before.isFile() || named.isSymbolicLink()
      || before.dev !== named.dev || before.ino !== named.ino
      || before.size !== named.size || before.nlink !== named.nlink
      || before.size !== BigInt(boundedExpectedSize)) {
      throw new Error('Archive correction attachment changed before proof.')
    }
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    while (offset < boundedExpectedSize) {
      const read = fs.readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.length, boundedExpectedSize - offset),
        offset,
      )
      if (read < 1) throw new Error('Archive correction attachment ended during proof.')
      hash.update(chunk.subarray(0, read))
      offset += read
    }
    const after = fs.fstatSync(descriptor, { bigint: true })
    const namedAfter = fs.lstatSync(name, { bigint: true })
    if (!sameAttachmentIdentity(after, before)
      || !sameAttachmentIdentity(namedAfter, before)
      || namedAfter.dev !== before.dev
      || namedAfter.ino !== before.ino || namedAfter.size !== before.size
      || namedAfter.nlink !== before.nlink) {
      throw new Error('Archive correction attachment changed during proof.')
    }
    return Object.freeze({ sizeBytes: offset, sha256: hash.digest('hex') })
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

/** Returns one serialization-safe exact metadata proof. */
function attachmentResidueProof(state, target, peer) {
  return Object.freeze({
    version: 1,
    state,
    target: target === null ? null : attachmentIdentity(target),
    peer: peer === null ? null : attachmentIdentity(peer),
  })
}

/** Serializes bigint stat fields used to detect drift without rehashing. */
function attachmentIdentity(identity) {
  return Object.freeze({
    dev: identity.dev.toString(),
    ino: identity.ino.toString(),
    nlink: identity.nlink.toString(),
    mode: identity.mode.toString(),
    size: identity.size.toString(),
    mtimeNs: identity.mtimeNs.toString(),
    ctimeNs: identity.ctimeNs.toString(),
  })
}

/** Compares two live bigint identities including mutation timestamps and mode. */
function sameAttachmentIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && left.nlink === right.nlink && left.mode === right.mode
    && left.size === right.size && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

/** Compares a live bigint stat with one serialization-safe proof. */
function matchesAttachmentIdentity(identity, proof) {
  return proof !== null && typeof proof === 'object' && !Array.isArray(proof)
    && Object.keys(proof).sort().join(',') === 'ctimeNs,dev,ino,mode,mtimeNs,nlink,size'
    && identity.dev.toString() === proof.dev
    && identity.ino.toString() === proof.ino
    && identity.nlink.toString() === proof.nlink
    && identity.mode.toString() === proof.mode
    && identity.size.toString() === proof.size
    && identity.mtimeNs.toString() === proof.mtimeNs
    && identity.ctimeNs.toString() === proof.ctimeNs
}

/** Writes a whole source chunk even when the host reports legal short writes. */
async function writeFully(handle, buffer, length) {
  let offset = 0
  while (offset < length) {
    const result = await handle.write(buffer, offset, length - offset)
    if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten < 1
      || result.bytesWritten > length - offset) {
      throw new Error('Archive correction attachment destination write was incomplete.')
    }
    offset += result.bytesWritten
  }
}

/** Validates a closed pair command containing one read-only source path and relative outputs. */
function validatePairInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.sourcePath !== 'string' || input.sourcePath.length < 1
    || !isCorrectionAttachmentTargetName(input.targetName)
    || input.peerName !== correctionAttachmentPeerName(input.targetName)
    || input.expected === null || typeof input.expected !== 'object'
    || !Number.isSafeInteger(input.expected.sizeBytes)
    || input.expected.sizeBytes < 1 || input.expected.sizeBytes > MAX_ATTACHMENT_BYTES
    || !SHA256.test(input.expected.sha256 ?? '')
    || (input.isCancelled !== undefined && typeof input.isCancelled !== 'function')) {
    throw new Error('Archive correction attachment pair request is invalid.')
  }
}

/** Requires one regular private attachment with exactly the expected link topology. */
function requireSafeAttachmentIdentity(identity, nlink) {
  if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== nlink
    || (identity.mode & 0o777n) !== 0o600n
    || identity.size < 1n || identity.size > BigInt(MAX_ATTACHMENT_BYTES)) {
    throw new Error('Archive correction attachment link topology is invalid.')
  }
}

/** Requires measured bytes to match their authenticated archive proof. */
function requireExpectedProof(proof, expected) {
  if (proof.sizeBytes !== expected.sizeBytes || proof.sha256 !== expected.sha256) {
    throw new Error('Archive correction attachment bytes differ from their archive proof.')
  }
}

/** Returns one leaf stat or null without accepting another error. */
function safeLeafStat(name) {
  try {
    return fs.lstatSync(name, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** Restricts directory traversal to generated or validated single components. */
function isDirectoryComponent(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(value)
}

/** Flushes the cwd directory on hosts supporting directory fsync. */
function syncCurrentDirectory() {
  if (process.platform === 'win32') return
  const descriptor = fs.openSync('.', fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0))
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

/** Flushes the cwd directory asynchronously on hosts supporting directory fsync. */
async function syncCurrentDirectoryAsync() {
  if (process.platform === 'win32') return
  const handle = await fsp.open('.', fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0))
  try { await handle.sync() } finally { await handle.close() }
}

module.exports = {
  assertCorrectionDirectoryIdentity,
  captureCorrectionDirectoryIdentity,
  createCorrectionAttachmentPair,
  enterCorrectionAttachmentRoot,
  enterCorrectionDirectoryComponent,
  enterExistingCorrectionAttachmentRoot,
  enterExistingCorrectionDirectoryComponent,
  inspectCorrectionAttachmentResidue,
  proveCorrectionAttachmentResidue,
  revalidateCorrectionAttachmentResidue,
  verifyCorrectionAttachmentPair,
}
