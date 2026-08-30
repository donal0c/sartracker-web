'use strict'

const fs = require('node:fs')
const path = require('node:path')

const {
  runArchiveReviewProjectionInWorker,
} = require('./archive-review-projection-runner.cjs')
const {
  runMissionReviewReadQueryInWorker,
} = require('./mission-review-read-query-runner.cjs')
const { runMissionReplayInWorker } = require('./mission-replay-runner.cjs')
const { runSearchOperationPageInWorker } = require('./search-operations-page-runner.cjs')

const MAX_ID_BYTES = 200
const MAX_REQUEST_ID_BYTES = 200

/** Stable archive-review source failure. */
class ArchiveReviewSourceError extends Error {
  /** Creates a typed non-reflective read-source failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveReviewSourceError'
    this.code = code
  }
}

/** Requires one bounded non-control string. */
function normalizeText(value, label, maximumBytes) {
  if (typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ArchiveReviewSourceError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      `${label} is invalid.`,
    )
  }
  return value
}

/** Creates the stable closed-session failure. */
function createClosedError() {
  return new ArchiveReviewSourceError(
    'ARCHIVE_REVIEW_SESSION_CLOSED',
    'Archive review session is closed.',
  )
}

/** Creates the stable no-mutation failure. */
function createReadOnlyError() {
  return new ArchiveReviewSourceError(
    'ARCHIVE_REVIEW_READ_ONLY',
    'Archive review is read-only and does not expose mutation capabilities.',
  )
}

/** Returns true for path-bearing fields whose private directory components must not cross IPC. */
function isPortableEvidencePathKey(key) {
  return key === 'attachment_path'
    || key === 'attachmentPath'
    || key === 'source_path'
    || key === 'sourcePath'
}

/** Removes private paths from one JSON-encoded archive evidence envelope. */
function scrubJsonEnvelope(value, sessionDirectory) {
  try {
    const parsed = JSON.parse(value)
    if (parsed === null || typeof parsed !== 'object') return value
    return JSON.stringify(scrubSessionPaths(parsed, sessionDirectory))
  } catch {
    return value
  }
}

/** Removes any private or app-owned restored-session path from a result projection. */
function scrubSessionPaths(value, sessionDirectory, key = null) {
  if (typeof value === 'string') {
    if (isPortableEvidencePathKey(key)) return portableBasename(value)
    if (typeof key === 'string' && (key.endsWith('_json') || key.endsWith('Json'))) {
      return scrubJsonEnvelope(value, sessionDirectory)
    }
    return value === sessionDirectory || value.startsWith(`${sessionDirectory}${path.sep}`)
      ? null
      : value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubSessionPaths(entry, sessionDirectory, key))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      scrubSessionPaths(child, sessionDirectory, key),
    ]))
  }
  return value
}

/** Returns one portable filename from a historical absolute attachment path. */
function portableBasename(value) {
  return value.replaceAll('\\', '/').split('/').at(-1)
}

/** Pins one regular restored database and exposes only its process-local descriptor alias. */
function openPinnedDatabase(databasePath, expectedIdentity, databaseFileHandle) {
  let pathStat
  let descriptor = null
  const transferred = databaseFileHandle !== undefined
  try {
    if (expectedIdentity !== undefined
      && (expectedIdentity === null
        || typeof expectedIdentity !== 'object'
        || Array.isArray(expectedIdentity)
        || Object.keys(expectedIdentity).sort().join(',') !== 'dev,ino,sizeBytes'
        || !Number.isSafeInteger(expectedIdentity.dev) || expectedIdentity.dev < 0
        || !Number.isSafeInteger(expectedIdentity.ino) || expectedIdentity.ino < 1
        || !Number.isSafeInteger(expectedIdentity.sizeBytes) || expectedIdentity.sizeBytes < 1)) {
      throw new Error('invalid expected database identity')
    }
    if (transferred
      && (databaseFileHandle === null
        || typeof databaseFileHandle !== 'object'
        || !Number.isSafeInteger(databaseFileHandle.fd)
        || databaseFileHandle.fd < 0
        || typeof databaseFileHandle.close !== 'function')) {
      throw new Error('invalid transferred database handle')
    }
    if (transferred && expectedIdentity === undefined) {
      throw new Error('transferred database handle requires an authenticated identity')
    }
    pathStat = fs.lstatSync(databasePath)
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error('not a regular file')
    descriptor = transferred
      ? databaseFileHandle.fd
      : fs.openSync(databasePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const descriptorStat = fs.fstatSync(descriptor)
    if (!descriptorStat.isFile()
      || descriptorStat.nlink !== 1
      || descriptorStat.dev !== pathStat.dev
      || descriptorStat.ino !== pathStat.ino
      || (expectedIdentity !== undefined
        && (descriptorStat.dev !== expectedIdentity.dev
          || descriptorStat.ino !== expectedIdentity.ino
          || descriptorStat.size !== expectedIdentity.sizeBytes))) {
      throw new Error('database identity changed')
    }
    const descriptorPath = process.platform === 'linux'
      ? `/proc/self/fd/${descriptor}`
      : process.platform === 'darwin'
        ? `/dev/fd/${descriptor}`
        : null
    if (descriptorPath === null) throw new Error('unsupported descriptor path')
    return Object.freeze({
      descriptor,
      descriptorPath,
      transferredFileHandle: transferred ? databaseFileHandle : null,
      identity: Object.freeze({
        dev: descriptorStat.dev,
        ino: descriptorStat.ino,
        sizeBytes: descriptorStat.size,
      }),
    })
  } catch (error) {
    if (descriptor !== null) {
      if (transferred) {
        try { fs.ftruncateSync(descriptor, 0) } catch {}
        try { fs.fsyncSync(descriptor) } catch {}
        try { void Promise.resolve(databaseFileHandle.close()).catch(() => undefined) } catch {}
      } else {
        try { fs.closeSync(descriptor) } catch {}
      }
    }
    const failure = new ArchiveReviewSourceError(
      'ARCHIVE_REVIEW_DATABASE_UNAVAILABLE',
      'Archive review restored database could not be pinned safely.',
    )
    failure.cause = error
    throw failure
  }
}

/** Validates and indexes restored attachment identities without exposing their paths. */
function normalizeAttachmentMappings(input, sessionDirectory) {
  if (input === undefined) return new Map()
  if (!Array.isArray(input) || input.length > 10_000) {
    throw new ArchiveReviewSourceError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review attachment mappings are invalid.',
    )
  }
  const mappings = new Map()
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',')
        !== 'entryName,references,sha256,sizeBytes,sourceRelativePath'
      || typeof entry.entryName !== 'string'
      || entry.entryName.includes('\\')
      || path.posix.dirname(entry.entryName) !== 'attachments'
      || path.posix.normalize(entry.entryName) !== entry.entryName
      || typeof entry.sourceRelativePath !== 'string'
      || path.basename(entry.sourceRelativePath) !== entry.sourceRelativePath
      || entry.sourceRelativePath !== entry.sourceRelativePath.normalize('NFC')
      || Buffer.byteLength(entry.sourceRelativePath, 'utf8') < 1
      || Buffer.byteLength(entry.sourceRelativePath, 'utf8') > 255
      || typeof entry.sha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(entry.sha256)
      || !Number.isSafeInteger(entry.sizeBytes)
      || entry.sizeBytes < 1
      || entry.sizeBytes > 8 * 1024 * 1024 * 1024
      || !Array.isArray(entry.references)
      || entry.references.length < 1
      || entry.references.length > 10_000) {
      throw new ArchiveReviewSourceError(
        'ARCHIVE_REVIEW_INPUT_INVALID',
        'Archive review attachment mapping is invalid.',
      )
    }
    const restoredPath = path.join(sessionDirectory, ...entry.entryName.split('/'))
    if (path.dirname(restoredPath) !== path.join(sessionDirectory, 'attachments')) {
      throw new ArchiveReviewSourceError(
        'ARCHIVE_REVIEW_INPUT_INVALID',
        'Archive review attachment mapping is outside its session.',
      )
    }
    for (const reference of entry.references) {
      if (reference === null || typeof reference !== 'object' || Array.isArray(reference)
        || Object.keys(reference).sort().join(',') !== 'referenceId,referenceKind') {
        throw new ArchiveReviewSourceError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive review attachment reference is invalid.',
        )
      }
      const referenceKind = normalizeText(
        reference.referenceKind,
        'Archive review attachment reference kind',
        100,
      )
      const referenceId = normalizeText(
        reference.referenceId,
        'Archive review attachment reference identity',
        MAX_ID_BYTES,
      )
      const key = `${entry.sourceRelativePath}\0${referenceKind}\0${referenceId}`
      if (mappings.has(key)) {
        throw new ArchiveReviewSourceError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive review attachment mapping is ambiguous.',
        )
      }
      mappings.set(key, Object.freeze({
        restoredPath,
        displayName: entry.sourceRelativePath,
        expectedSha256: entry.sha256,
        expectedSizeBytes: entry.sizeBytes,
      }))
    }
  }
  return mappings
}

/**
 * Opens one fixed-mission read-only facade over an app-owned restored session database.
 * Unknown properties deliberately throw so a future mutation cannot appear by accident.
 */
function createArchiveReviewSource(options) {
  const databasePath = options?.databasePath
  if (typeof databasePath !== 'string'
    || !path.isAbsolute(databasePath)
    || path.resolve(databasePath) !== databasePath) {
    throw new ArchiveReviewSourceError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review database path is invalid.',
    )
  }
  const missionId = normalizeText(options?.missionId, 'Archive review mission identity', MAX_ID_BYTES)
  const sessionId = normalizeText(options?.sessionId, 'Archive review session identity', MAX_ID_BYTES)
  const sessionDirectory = path.dirname(databasePath)
  const attachmentMappings = normalizeAttachmentMappings(
    options.attachmentMappings,
    sessionDirectory,
  )
  const attachmentReferences = Object.freeze([...attachmentMappings.entries()]
    .map(([key, mapping]) => {
      const [, referenceKind, referenceId] = key.split('\0')
      return Object.freeze({
        attachmentPath: mapping.displayName,
        referenceKind,
        referenceId,
      })
    })
    .sort((left, right) => {
      const leftKey = `${left.attachmentPath}\0${left.referenceKind}\0${left.referenceId}`
      const rightKey = `${right.attachmentPath}\0${right.referenceKind}\0${right.referenceId}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    }))
  const runReview = options.runMissionReviewRead ?? runMissionReviewReadQueryInWorker
  const runReplay = options.runMissionReplayRead ?? runMissionReplayInWorker
  const runSearch = options.runSearchOperationPage ?? runSearchOperationPageInWorker
  const runProjection = options.runProjectionRead ?? runArchiveReviewProjectionInWorker
  const openAttachmentAction = options.openRestoredAttachment ?? (async () => false)
  const onMutationDenied = options.onMutationDenied ?? (() => undefined)
  if (typeof runReview !== 'function' || typeof runReplay !== 'function'
    || typeof runSearch !== 'function' || typeof runProjection !== 'function'
    || typeof openAttachmentAction !== 'function'
    || typeof onMutationDenied !== 'function') {
    throw new ArchiveReviewSourceError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review source adapters are invalid.',
    )
  }
  const pinnedDatabase = openPinnedDatabase(
    databasePath,
    options.expectedDatabaseIdentity,
    options.databaseFileHandle,
  )
  const pinnedDatabasePath = pinnedDatabase.descriptorPath
  let databaseDescriptorClosed = false
  let closed = false
  let closePromise = null
  const activeReview = new Map()
  const activeReplay = new Map()
  const activeOperations = new Set()
  const activeProjections = new Set()
  const activeAttachments = new Set()
  const openAttachmentLeases = new Set()

  /** Rejects use after the session owner has closed the source. */
  function assertOpen() {
    if (closed) throw createClosedError()
  }

  /** Requires every mission-bearing call to remain within the restored scope. */
  function assertMission(candidate) {
    assertOpen()
    if (candidate !== missionId) {
      throw new ArchiveReviewSourceError(
        'ARCHIVE_REVIEW_MISSION_MISMATCH',
        'Archive review mission does not match its fixed restored session.',
      )
    }
  }

  /** Tracks worker physical exit so close can join every source-owned read. */
  function trackOperation(operation) {
    const exited = Promise.resolve(operation?.workerExited ?? operation).catch(() => undefined)
    activeOperations.add(exited)
    void exited.finally(() => activeOperations.delete(exited))
    return operation
  }

  /** Starts one request-ID-owned cancellable worker read. */
  async function runOwnedRead(map, requestId, factory) {
    assertOpen()
    const normalizedRequestId = requestId === undefined
      ? null
      : normalizeText(requestId, 'Archive review request identity', MAX_REQUEST_ID_BYTES)
    if (normalizedRequestId !== null && map.has(normalizedRequestId)) {
      throw new ArchiveReviewSourceError(
        'ARCHIVE_REVIEW_REQUEST_ACTIVE',
        'Archive review request identity is already active.',
      )
    }
    const controller = new AbortController()
    const operation = trackOperation(factory(controller.signal))
    const active = { controller, completion: Promise.resolve(operation) }
    if (normalizedRequestId !== null) map.set(normalizedRequestId, active)
    try {
      return scrubSessionPaths(await operation, sessionDirectory)
    } finally {
      if (normalizedRequestId !== null && map.get(normalizedRequestId) === active) {
        map.delete(normalizedRequestId)
      }
    }
  }

  /** Cancels one exact request and joins its public completion. */
  async function cancelOwnedRead(map, requestId) {
    assertOpen()
    const normalized = normalizeText(
      requestId,
      'Archive review request identity',
      MAX_REQUEST_ID_BYTES,
    )
    const active = map.get(normalized)
    if (active === undefined) return false
    active.controller.abort()
    await active.completion.catch(() => undefined)
    return true
  }

  /** Runs one bounded simple projection in its own cancellable read worker. */
  async function runSimpleProjection(method, input) {
    assertOpen()
    const controller = new AbortController()
    const operation = trackOperation(runProjection({
      databasePath: pinnedDatabasePath,
      method,
      ...input,
      signal: controller.signal,
    }))
    const active = { controller, completion: Promise.resolve(operation) }
    activeProjections.add(active)
    try {
      return scrubSessionPaths(await operation, sessionDirectory)
    } finally {
      activeProjections.delete(active)
    }
  }

  const source = {
    async info() {
      assertOpen()
      return Object.freeze({ mission_id: missionId, session_id: sessionId, read_only: true })
    },
    async listMissions() {
      return runSimpleProjection('listMissions', { missionId })
    },
    async readMissionReview(input, requestId) {
      assertMission(input?.missionId)
      return runOwnedRead(activeReview, requestId, (signal) => runReview({
        databasePath: pinnedDatabasePath,
        query: input,
        signal,
      }))
    },
    async cancelMissionReviewRead(requestId) {
      return cancelOwnedRead(activeReview, requestId)
    },
    async readMissionReplay(input, requestId) {
      assertMission(input?.missionId)
      return runOwnedRead(activeReplay, requestId, (signal) => runReplay({
        databasePath: pinnedDatabasePath,
        query: input,
        kind: 'state',
        signal,
      }))
    },
    async readMissionReplayTrackChunk(input, requestId) {
      assertMission(input?.missionId)
      return runOwnedRead(activeReplay, requestId, (signal) => runReplay({
        databasePath: pinnedDatabasePath,
        query: input,
        kind: 'chunk',
        signal,
      }))
    },
    async readMissionReplayObjectChunk(input, requestId) {
      assertMission(input?.missionId)
      return runOwnedRead(activeReplay, requestId, (signal) => runReplay({
        databasePath: pinnedDatabasePath,
        query: input,
        kind: 'objects',
        signal,
      }))
    },
    async readMissionReplayFilterPage(input, requestId) {
      assertMission(input?.missionId)
      return runOwnedRead(activeReplay, requestId, (signal) => runReplay({
        databasePath: pinnedDatabasePath,
        query: input,
        kind: 'filters',
        signal,
      }))
    },
    async cancelMissionReplay(requestId) {
      return cancelOwnedRead(activeReplay, requestId)
    },
    async listMarkers(candidateMissionId) {
      assertMission(candidateMissionId)
      return runSimpleProjection('listMarkers', { missionId })
    },
    async listDevices(candidateMissionId) {
      assertMission(candidateMissionId)
      return runSimpleProjection('listDevices', { missionId })
    },
    async listDrawings(candidateMissionId) {
      assertMission(candidateMissionId)
      return runSimpleProjection('listDrawings', { missionId })
    },
    async listHelicopters(candidateMissionId) {
      assertMission(candidateMissionId)
      return runSimpleProjection('listHelicopters', { missionId })
    },
    async listGpxImports(candidateMissionId) {
      assertMission(candidateMissionId)
      return runSimpleProjection('listGpxImports', { missionId })
    },
    async listGpxImportPage(input) {
      assertMission(input?.missionId)
      return runSimpleProjection('listGpxImportPage', { query: input })
    },
    async listSearchOperationPage(input) {
      assertMission(input?.missionId)
      const controller = new AbortController()
      const operation = trackOperation(runSearch({
        databasePath: pinnedDatabasePath,
        query: input,
        signal: controller.signal,
      }))
      const active = { controller, completion: Promise.resolve(operation) }
      activeProjections.add(active)
      try {
        return scrubSessionPaths(await operation, sessionDirectory)
      } finally {
        activeProjections.delete(active)
      }
    },
    async listOutings(candidateMissionId) {
      assertMission(candidateMissionId)
      return runSimpleProjection('listOutings', { missionId })
    },
    async listLayerCatalogMetadata(candidateMissionId) {
      assertMission(candidateMissionId)
      return runSimpleProjection('listLayerCatalogMetadata', { missionId })
    },
    async listArchiveAttachmentPage(input) {
      assertMission(input?.missionId)
      if (input === null || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).sort().join(',') !== 'cursor,limit,missionId'
        || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100
        || (input.cursor !== null
          && (typeof input.cursor !== 'string'
            || !/^(?:0|[1-9][0-9]{0,4})$/u.test(input.cursor)))) {
        throw new ArchiveReviewSourceError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive review attachment page request is invalid.',
        )
      }
      const offset = input.cursor === null ? 0 : Number(input.cursor)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > attachmentReferences.length) {
        throw new ArchiveReviewSourceError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive review attachment page cursor is invalid.',
        )
      }
      const entries = attachmentReferences.slice(offset, offset + input.limit)
      const nextOffset = offset + entries.length
      return Object.freeze({
        entries: Object.freeze(entries),
        nextCursor: nextOffset < attachmentReferences.length ? String(nextOffset) : null,
        totalCount: attachmentReferences.length,
      })
    },
    async openAttachment(input) {
      assertMission(input?.missionId)
      if (activeAttachments.size > 0) {
        throw new ArchiveReviewSourceError(
          'ARCHIVE_REVIEW_ATTACHMENT_BUSY',
          'Another archived attachment is already being opened.',
        )
      }
      if (input === null || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).sort().join(',')
          !== 'attachmentPath,missionId,referenceId,referenceKind') {
        throw new ArchiveReviewSourceError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive review attachment request is invalid.',
        )
      }
      const attachmentPath = normalizeText(
        input?.attachmentPath,
        'Archive review attachment identity',
        4_096,
      )
      const referenceKind = normalizeText(
        input.referenceKind,
        'Archive review attachment reference kind',
        100,
      )
      const referenceId = normalizeText(
        input.referenceId,
        'Archive review attachment reference identity',
        MAX_ID_BYTES,
      )
      const relativeName = portableBasename(attachmentPath)
      const restoredAttachment = attachmentMappings.get(
        `${relativeName}\0${referenceKind}\0${referenceId}`,
      )
      if (restoredAttachment === undefined) {
        throw new ArchiveReviewSourceError(
          'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
          'Archived attachment is not present for this evidence reference.',
        )
      }
      const controller = new AbortController()
      const operation = trackOperation((async () => {
        assertOpen()
        let opened
        try {
          opened = await openAttachmentAction(Object.freeze({
            ...restoredAttachment,
            sessionDirectory,
            signal: controller.signal,
          }))
        } catch (error) {
          const cleanupLease = error?.cleanupLease
          if (cleanupLease !== null && typeof cleanupLease === 'object'
            && !Array.isArray(cleanupLease)
            && Object.keys(cleanupLease).sort().join(',') === 'close'
            && typeof cleanupLease.close === 'function') {
            openAttachmentLeases.add(cleanupLease)
          }
          throw error
        }
        if (opened !== null && typeof opened === 'object' && !Array.isArray(opened)) {
          if (Object.keys(opened).sort().join(',') !== 'close,opened'
            || opened.opened !== true || typeof opened.close !== 'function') {
            throw new ArchiveReviewSourceError(
              'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
              'Archived attachment viewer returned an invalid ownership lease.',
            )
          }
          openAttachmentLeases.add(opened)
          if (closed) {
            try {
              await opened.close()
              openAttachmentLeases.delete(opened)
            } catch {
              // The source-level close owns the retained lease and will retry it.
            }
            throw createClosedError()
          }
          return true
        }
        return opened === true
      })())
      const active = { controller, completion: Promise.resolve(operation) }
      activeAttachments.add(active)
      try {
        return await operation
      } finally {
        activeAttachments.delete(active)
      }
    },
    close() {
      if (closePromise !== null) return closePromise
      closed = true
      const attempt = (async () => {
        for (const active of [...activeReview.values(), ...activeReplay.values()]) {
          active.controller.abort()
        }
        for (const active of activeProjections) active.controller.abort()
        for (const active of activeAttachments) active.controller.abort()
        await Promise.allSettled([
          ...[...activeReview.values(), ...activeReplay.values()]
            .map((active) => active.completion),
          ...[...activeProjections].map((active) => active.completion),
          ...[...activeAttachments].map((active) => active.completion),
          ...activeOperations,
        ])
        activeReview.clear()
        activeReplay.clear()
        activeProjections.clear()
        activeAttachments.clear()
        const leaseResults = await Promise.allSettled(
          [...openAttachmentLeases].map(async (lease) => {
            await lease.close()
            openAttachmentLeases.delete(lease)
          }),
        )
        if (!databaseDescriptorClosed) {
          if (pinnedDatabase.transferredFileHandle !== null) {
            let pathMatches = false
            try {
              const observed = fs.lstatSync(databasePath)
              const descriptorStat = fs.fstatSync(pinnedDatabase.descriptor)
              pathMatches = observed.isFile() && !observed.isSymbolicLink()
                && observed.dev === descriptorStat.dev && observed.ino === descriptorStat.ino
            } catch {}
            if (!pathMatches) {
              try { fs.ftruncateSync(pinnedDatabase.descriptor, 0) } catch {}
              try { fs.fsyncSync(pinnedDatabase.descriptor) } catch {}
            }
            await pinnedDatabase.transferredFileHandle.close()
          } else {
            fs.closeSync(pinnedDatabase.descriptor)
          }
          databaseDescriptorClosed = true
        }
        const failedLease = leaseResults.find((result) => result.status === 'rejected')
        if (failedLease !== undefined) throw failedLease.reason
      })()
      closePromise = attempt
      void attempt.catch(() => {
        if (closePromise === attempt) closePromise = null
      })
      return attempt
    },
  }

  return new Proxy(Object.freeze(source), {
    get(target, property, receiver) {
      if (typeof property !== 'string' || Object.prototype.hasOwnProperty.call(target, property)) {
        return Reflect.get(target, property, receiver)
      }
      onMutationDenied(property.slice(0, 100))
      throw createReadOnlyError()
    },
    set(_target, property) {
      onMutationDenied(`set:${String(property)}`.slice(0, 100))
      throw createReadOnlyError()
    },
    defineProperty(_target, property) {
      onMutationDenied(`define:${String(property)}`.slice(0, 100))
      throw createReadOnlyError()
    },
    deleteProperty(_target, property) {
      onMutationDenied(`delete:${String(property)}`.slice(0, 100))
      throw createReadOnlyError()
    },
  })
}

module.exports = {
  ArchiveReviewSourceError,
  createArchiveReviewSource,
}
