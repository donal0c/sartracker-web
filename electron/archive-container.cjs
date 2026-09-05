const { createHash } = require('node:crypto')

const {
  decryptFrame,
  encryptFrame,
  validateScryptParameters,
} = require('./archive-crypto.cjs')

const SARARCH2_MAGIC = Buffer.from('SARARCH2', 'ascii')
const SARARCH2_TRAILER_MAGIC = Buffer.from('SARTRLR2', 'ascii')
const SARARCH2_ENTRY_MAGIC = Buffer.from('SARENTRY', 'ascii')
const SARARCH2_CONTAINER_VERSION = 2
const DEFAULT_ARCHIVE_FRAME_SIZE = 8 * 1024 * 1024

const SUPPORTED_CIPHER = 'aes-256-gcm'
const SUPPORTED_FRAMING = 'sararch2-framed-v1'
const FRAME_RECORD_HEADER_BYTES = 13
const FRAME_AUTH_TAG_BYTES = 16
const TRAILER_BYTES = 17
const MAX_HEADER_BYTES = 64 * 1024
const MAX_KEY_SLOT_BLOCK_BYTES = 1024 * 1024
const MAX_ENTRY_HEADER_BYTES = 16 * 1024
const MAX_ENTRY_NAME_BYTES = 4096
const MAX_ARCHIVE_FRAME_SIZE = 16 * 1024 * 1024
const MAX_UINT64 = 0xffff_ffff_ffff_ffffn
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

const ARCHIVE_HEADER_KEYS = Object.freeze([
  'cipher',
  'container_version',
  'created_at',
  'creation_operation_id',
  'frame_size',
  'framing',
  'inventory_version',
  'key_slot_count',
  'mission_id',
  'nonce_prefix',
  'previous_archive_sha256',
  'protected_finalization_epoch',
  'request_event_id',
  'request_event_rowid',
  'schema_version',
])
const KEY_SLOT_KEYS = Object.freeze([
  'authTag',
  'ciphertext',
  'kdf',
  'nonce',
  'profile',
  'salt',
  'slotId',
  'slotType',
  'slotVersion',
])

/** Identifies structurally invalid or unsupported SARARCH2 data. */
class ArchiveFormatError extends Error {
  /** Creates a fail-closed archive format error. */
  constructor(message, options = undefined) {
    super(message)
    this.name = 'ArchiveFormatError'
    this.code = 'SARARCH2_FORMAT_INVALID'
    if (options?.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

/** Identifies a SARARCH2 byte stream that ended before a required boundary. */
class ArchiveTruncationError extends ArchiveFormatError {
  /** Creates an archive truncation error for a named boundary. */
  constructor(message) {
    super(message)
    this.name = 'ArchiveTruncationError'
    this.code = 'SARARCH2_TRUNCATED'
  }
}

/** Returns true only for plain record values that have no custom serializer. */
function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Serializes JSON deterministically while refusing values JSON would silently change. */
function canonicalJson(value) {
  const active = new Set()

  /** Serializes one recursively validated JSON value. */
  function encode(current, location) {
    if (current === null) {
      return 'null'
    }
    if (typeof current === 'string' || typeof current === 'boolean') {
      return JSON.stringify(current)
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new ArchiveFormatError(`Canonical JSON contains a non-finite number at ${location}.`)
      }
      return JSON.stringify(current)
    }
    if (typeof current !== 'object') {
      throw new ArchiveFormatError(`Canonical JSON contains an unsupported value at ${location}.`)
    }
    if (active.has(current)) {
      throw new ArchiveFormatError(`Canonical JSON contains a cycle at ${location}.`)
    }
    active.add(current)
    try {
      if (Array.isArray(current)) {
        return `[${current.map((item, index) => encode(item, `${location}[${index}]`)).join(',')}]`
      }
      if (!isPlainRecord(current)) {
        throw new ArchiveFormatError(`Canonical JSON requires a plain object at ${location}.`)
      }
      const members = Object.keys(current)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${encode(current[key], `${location}.${key}`)}`)
      return `{${members.join(',')}}`
    } finally {
      active.delete(current)
    }
  }

  return encode(value, '$')
}

/** Decodes canonical UTF-8 JSON and rejects alternative encodings or field order. */
function parseCanonicalJson(bytes, label) {
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new ArchiveFormatError(`${label} is not valid UTF-8.`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ArchiveFormatError(`${label} is not valid JSON.`, { cause: error })
  }
  if (canonicalJson(parsed) !== text) {
    throw new ArchiveFormatError(`${label} is not canonical JSON.`)
  }
  return parsed
}

/** Requires an object to have exactly the supported keys. */
function requireExactKeys(record, expectedKeys, label) {
  const actual = Object.keys(record).sort()
  if (actual.length !== expectedKeys.length || actual.some((key, index) => key !== expectedKeys[index])) {
    throw new ArchiveFormatError(`${label} contains missing or unsupported fields.`)
  }
}

/** Requires a bounded, positive safe integer. */
function requirePositiveSafeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ArchiveFormatError(`${label} must be a positive supported integer.`)
  }
}

/** Requires a bounded, non-negative safe integer. */
function requireNonNegativeSafeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new ArchiveFormatError(`${label} must be a non-negative supported integer.`)
  }
}

/** Decodes and validates one canonical fixed-size base64 field. */
function decodeCanonicalBase64(value, expectedBytes, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new ArchiveFormatError(`${label} must be canonical base64.`)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== expectedBytes || decoded.toString('base64') !== value) {
    throw new ArchiveFormatError(`${label} must encode exactly ${expectedBytes} bytes.`)
  }
  return decoded
}

/** Validates and returns a closed SARARCH2 v2 plaintext header projection. */
function validateArchiveHeader(header) {
  if (!isPlainRecord(header)) {
    throw new ArchiveFormatError('SARARCH2 header must be a plain object.')
  }
  requireExactKeys(header, ARCHIVE_HEADER_KEYS, 'SARARCH2 header')
  if (header.container_version !== SARARCH2_CONTAINER_VERSION) {
    throw new ArchiveFormatError(
      `Unsupported SARARCH2 container version ${String(header.container_version)}; this reader supports version 2.`,
    )
  }
  if (header.cipher !== SUPPORTED_CIPHER) {
    throw new ArchiveFormatError(`Unsupported SARARCH2 cipher ${String(header.cipher)}.`)
  }
  if (header.framing !== SUPPORTED_FRAMING) {
    throw new ArchiveFormatError(`Unsupported SARARCH2 framing ${String(header.framing)}.`)
  }
  requirePositiveSafeInteger(header.frame_size, 'SARARCH2 frame_size', MAX_ARCHIVE_FRAME_SIZE)
  decodeCanonicalBase64(header.nonce_prefix, 4, 'SARARCH2 nonce_prefix')
  if (
    typeof header.mission_id !== 'string'
    || header.mission_id.length < 1
    || Buffer.byteLength(header.mission_id, 'utf8') > 256
    || /[\u0000-\u001f\u007f]/.test(header.mission_id)
  ) {
    throw new ArchiveFormatError('SARARCH2 mission_id must be a bounded non-control string.')
  }
  requirePositiveSafeInteger(header.request_event_rowid, 'SARARCH2 request_event_rowid')
  if (!UUID_V4.test(header.request_event_id)
    || !UUID_V4.test(header.creation_operation_id)) {
    throw new ArchiveFormatError(
      'SARARCH2 request and creation operation identities must be version-four UUIDs.',
    )
  }
  if (header.protected_finalization_epoch !== null) {
    requirePositiveSafeInteger(
      header.protected_finalization_epoch,
      'SARARCH2 protected_finalization_epoch',
    )
  }
  if (
    typeof header.created_at !== 'string'
    || Number.isNaN(Date.parse(header.created_at))
    || new Date(header.created_at).toISOString() !== header.created_at
  ) {
    throw new ArchiveFormatError('SARARCH2 created_at must be a canonical ISO-8601 timestamp.')
  }
  requirePositiveSafeInteger(header.schema_version, 'SARARCH2 schema_version')
  requirePositiveSafeInteger(header.inventory_version, 'SARARCH2 inventory_version')
  if (
    header.previous_archive_sha256 !== null
    && (
      typeof header.previous_archive_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(header.previous_archive_sha256)
    )
  ) {
    throw new ArchiveFormatError('SARARCH2 previous_archive_sha256 must be null or lowercase SHA-256 hex.')
  }
  requireNonNegativeSafeInteger(header.key_slot_count, 'SARARCH2 key_slot_count', 16)

  return Object.freeze(JSON.parse(canonicalJson(header)))
}

/** Validates the canonical slot-block collection without interpreting slot secrets. */
function validateKeySlots(keySlots, expectedCount) {
  if (!Array.isArray(keySlots)) {
    throw new ArchiveFormatError('SARARCH2 key-slot block must be an array.')
  }
  if (keySlots.length !== expectedCount) {
    throw new ArchiveFormatError(
      `SARARCH2 key-slot count mismatch: header declares ${expectedCount}, block contains ${keySlots.length}.`,
    )
  }
  const slotIds = new Set()
  const slotTypes = new Set()
  for (const [index, slot] of keySlots.entries()) {
    if (!isPlainRecord(slot) || Object.keys(slot).length === 0) {
      throw new ArchiveFormatError(`SARARCH2 key slot ${index} must be a non-empty plain object.`)
    }
    requireExactKeys(slot, KEY_SLOT_KEYS, `SARARCH2 key slot ${index}`)
    if (
      typeof slot.slotId !== 'string'
      || slot.slotId.length === 0
      || slot.slotId.length > 128
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(slot.slotId)
    ) {
      throw new ArchiveFormatError(`SARARCH2 key slot ${index} has an invalid bounded slotId.`)
    }
    if (!['passphrase', 'recovery', 'machine'].includes(slot.slotType)) {
      throw new ArchiveFormatError(`SARARCH2 key slot ${index} has an unsupported slotType.`)
    }
    if (slot.slotVersion !== 1 || slot.kdf !== 'scrypt') {
      throw new ArchiveFormatError(`SARARCH2 key slot ${index} uses an unsupported slot format.`)
    }
    try {
      validateScryptParameters(slot.profile)
    } catch (error) {
      throw new ArchiveFormatError(
        `SARARCH2 key slot ${index} uses an unsupported scrypt profile.`,
        { cause: error },
      )
    }
    decodeCanonicalBase64(slot.salt, 32, `SARARCH2 key slot ${index} salt`)
    decodeCanonicalBase64(slot.nonce, 12, `SARARCH2 key slot ${index} nonce`)
    decodeCanonicalBase64(slot.ciphertext, 32, `SARARCH2 key slot ${index} ciphertext`)
    decodeCanonicalBase64(slot.authTag, 16, `SARARCH2 key slot ${index} authTag`)
    if (slotIds.has(slot.slotId)) {
      throw new ArchiveFormatError(`SARARCH2 key-slot block contains duplicate slotId ${slot.slotId}.`)
    }
    if (slotTypes.has(slot.slotType)) {
      throw new ArchiveFormatError(`SARARCH2 key-slot block contains duplicate slotType ${slot.slotType}.`)
    }
    slotIds.add(slot.slotId)
    slotTypes.add(slot.slotType)
  }
  if (
    !slotTypes.has('passphrase')
    || !slotTypes.has('recovery')
    || keySlots.length < 2
    || keySlots.length > 3
  ) {
    throw new ArchiveFormatError(
      'SARARCH2 requires exactly one passphrase slot and one recovery slot, with at most one optional machine slot.',
    )
  }
  return Object.freeze(keySlots.map((slot) => deepFreezeJson(slot)))
}

/** Returns a detached, recursively frozen canonical JSON value. */
function deepFreezeJson(value) {
  const detached = JSON.parse(canonicalJson(value))
  const freeze = (current) => {
    if (current !== null && typeof current === 'object' && !Object.isFrozen(current)) {
      for (const child of Object.values(current)) freeze(child)
      Object.freeze(current)
    }
    return current
  }
  return freeze(detached)
}

/** Converts a supported stream-like input into one async byte iterator. */
function createAsyncIterator(readable) {
  if (Buffer.isBuffer(readable) || readable instanceof Uint8Array) {
    return (async function* bufferIterator() {
      yield Buffer.from(readable.buffer, readable.byteOffset, readable.byteLength)
    })()[Symbol.asyncIterator]()
  }
  if (readable && typeof readable[Symbol.asyncIterator] === 'function') {
    return readable[Symbol.asyncIterator]()
  }
  throw new ArchiveFormatError('SARARCH2 input must be a readable async byte stream.')
}

/** Provides exact bounded reads without losing a source chunk that crosses a boundary. */
class ArchiveByteReader {
  /** Creates a byte reader with optional whole-source accounting. */
  constructor(readable, onSourceChunk = undefined) {
    this.iterator = createAsyncIterator(readable)
    this.onSourceChunk = onSourceChunk
    this.current = Buffer.alloc(0)
    this.offset = 0
    this.done = false
    this.released = false
  }

  /** Loads the next non-empty byte chunk when the current chunk is exhausted. */
  async loadChunk() {
    if (this.released) {
      throw new ArchiveFormatError('SARARCH2 reader continuation has already been released.')
    }
    while (this.offset >= this.current.length && !this.done) {
      const next = await this.iterator.next()
      if (next.done) {
        this.done = true
        this.current = Buffer.alloc(0)
        this.offset = 0
        return false
      }
      if (!Buffer.isBuffer(next.value) && !(next.value instanceof Uint8Array)) {
        throw new ArchiveFormatError('SARARCH2 input yielded a non-byte chunk.')
      }
      const chunk = Buffer.isBuffer(next.value)
        ? next.value
        : Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength)
      if (chunk.length === 0) {
        continue
      }
      this.current = chunk
      this.offset = 0
      this.onSourceChunk?.(chunk)
    }
    return this.offset < this.current.length
  }

  /** Reads exactly the requested bounded byte count or reports truncation. */
  async readExactly(length, boundary) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ArchiveFormatError(`Invalid internal SARARCH2 read length for ${boundary}.`)
    }
    if (length === 0) {
      return Buffer.alloc(0)
    }
    const output = Buffer.allocUnsafe(length)
    let written = 0
    while (written < length) {
      if (!(await this.loadChunk())) {
        throw new ArchiveTruncationError(
          `SARARCH2 archive ended while reading ${boundary}; expected ${length} bytes and received ${written}.`,
        )
      }
      const available = this.current.length - this.offset
      const take = Math.min(available, length - written)
      this.current.copy(output, written, this.offset, this.offset + take)
      this.offset += take
      written += take
    }
    return output
  }

  /** Requires immediate end-of-file after the authenticated trailer. */
  async requireEndOfFile() {
    if (await this.loadChunk()) {
      throw new ArchiveFormatError('SARARCH2 contains data after its trailer; end-of-file was required.')
    }
  }

  /** Releases an iterator that yields the unread boundary-crossing bytes and source remainder. */
  continuation() {
    if (this.released) {
      throw new ArchiveFormatError('SARARCH2 continuation was already released.')
    }
    this.released = true
    const current = this.current
    const offset = this.offset
    const iterator = this.iterator
    const done = this.done
    return (async function* continueBytes() {
      if (offset < current.length) {
        yield current.subarray(offset)
      }
      if (done) {
        return
      }
      while (true) {
        const next = await iterator.next()
        if (next.done) {
          return
        }
        if (!Buffer.isBuffer(next.value) && !(next.value instanceof Uint8Array)) {
          throw new ArchiveFormatError('SARARCH2 continuation yielded a non-byte chunk.')
        }
        const chunk = Buffer.isBuffer(next.value)
          ? next.value
          : Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength)
        if (chunk.length > 0) {
          yield chunk
        }
      }
    })()
  }
}

/** Reads and validates a SARARCH2 preamble from an existing byte reader. */
async function readPreambleFromReader(reader) {
  const magic = await reader.readExactly(SARARCH2_MAGIC.length, 'container magic')
  if (!magic.equals(SARARCH2_MAGIC)) {
    throw new ArchiveFormatError('Unknown archive magic; expected SARARCH2.')
  }
  const headerLengthBytes = await reader.readExactly(4, 'header length')
  const headerLength = headerLengthBytes.readUInt32BE(0)
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
    throw new ArchiveFormatError(`SARARCH2 header length ${headerLength} is outside the supported bound.`)
  }
  const headerBytes = await reader.readExactly(headerLength, 'canonical header')
  const header = validateArchiveHeader(parseCanonicalJson(headerBytes, 'SARARCH2 header'))
  const slotLengthBytes = await reader.readExactly(4, 'key-slot block length')
  const slotLength = slotLengthBytes.readUInt32BE(0)
  if (slotLength < 2 || slotLength > MAX_KEY_SLOT_BLOCK_BYTES) {
    throw new ArchiveFormatError(
      `SARARCH2 key-slot block length ${slotLength} is outside the supported bound.`,
    )
  }
  const slotBytes = await reader.readExactly(slotLength, 'canonical key-slot block')
  const keySlots = validateKeySlots(
    parseCanonicalJson(slotBytes, 'SARARCH2 key-slot block'),
    header.key_slot_count,
  )
  return {
    header,
    keySlots,
    headerDigest: createHash('sha256').update(headerBytes).digest(),
  }
}

/** Reads only the bounded plaintext preamble and exposes the unread continuation. */
async function readArchivePreamble(readable) {
  const reader = new ArchiveByteReader(readable)
  const preamble = await readPreambleFromReader(reader)
  return Object.freeze({ ...preamble, continuation: reader.continuation() })
}

/** Encodes one exact unsigned 64-bit big-endian value. */
function encodeUint64(value, label) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_UINT64) {
    throw new ArchiveFormatError(`${label} is outside the unsigned 64-bit range.`)
  }
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64BE(value)
  return bytes
}

/** Normalizes a declared entry size without a lossy integer conversion. */
function normalizeUint64(value, label) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ArchiveFormatError(`${label} must be a non-negative safe integer or bigint.`)
    }
    return BigInt(value)
  }
  if (typeof value !== 'bigint' || value < 0n || value > MAX_UINT64) {
    throw new ArchiveFormatError(`${label} is outside the unsigned 64-bit range.`)
  }
  return value
}

/** Validates that an encrypted logical entry name is relative and canonical. */
function validateEntryName(name) {
  if (
    typeof name !== 'string'
    || name.length === 0
    || Buffer.byteLength(name, 'utf8') > MAX_ENTRY_NAME_BYTES
    || name.startsWith('/')
    || name.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(name)
    || /^[A-Za-z]:/.test(name)
  ) {
    throw new ArchiveFormatError('SARARCH2 entry name must be a bounded canonical relative path.')
  }
  const segments = name.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new ArchiveFormatError('SARARCH2 entry name must be a canonical relative path without traversal.')
  }
  return name
}

/** Converts a supported entry source into an async byte sequence. */
async function* iterateEntrySource(source, entryName) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    if (source.byteLength > 0) {
      yield Buffer.isBuffer(source)
        ? source
        : Buffer.from(source.buffer, source.byteOffset, source.byteLength)
    }
    return
  }
  if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
    throw new ArchiveFormatError(`SARARCH2 entry ${entryName} source must be bytes or an async byte stream.`)
  }
  for await (const value of source) {
    if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
      throw new ArchiveFormatError(`SARARCH2 entry ${entryName} source yielded a non-byte chunk.`)
    }
    const chunk = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    if (chunk.length > 0) {
      yield chunk
    }
  }
}

/** Converts an entry collection into the ordered plaintext logical stream. */
async function* encodeLogicalEntries(entries) {
  if (
    !entries
    || (
      typeof entries[Symbol.iterator] !== 'function'
      && typeof entries[Symbol.asyncIterator] !== 'function'
    )
  ) {
    throw new ArchiveFormatError('SARARCH2 entries must be an iterable collection.')
  }
  const names = new Set()
  let expectedIndex = 0
  for await (const entry of entries) {
    if (!isPlainRecord(entry)) {
      throw new ArchiveFormatError(`SARARCH2 entry ${expectedIndex} must be a plain object.`)
    }
    const name = validateEntryName(entry.name)
    if (expectedIndex === 0 && name !== 'manifest.json') {
      throw new ArchiveFormatError('The first SARARCH2 entry must be manifest.json.')
    }
    if (names.has(name)) {
      throw new ArchiveFormatError(`Duplicate SARARCH2 entry name ${name}.`)
    }
    names.add(name)
    const declaredSize = normalizeUint64(entry.size, `SARARCH2 entry ${name} declared length`)
    const entryHeader = Buffer.from(canonicalJson({ index: expectedIndex, name }), 'utf8')
    if (entryHeader.length > MAX_ENTRY_HEADER_BYTES) {
      throw new ArchiveFormatError(`SARARCH2 entry header ${expectedIndex} exceeds the supported bound.`)
    }
    const entryHeaderLength = Buffer.alloc(4)
    entryHeaderLength.writeUInt32BE(entryHeader.length)
    yield SARARCH2_ENTRY_MAGIC
    yield entryHeaderLength
    yield entryHeader
    yield encodeUint64(declaredSize, `SARARCH2 entry ${name} declared length`)

    let observedSize = 0n
    for await (const chunk of iterateEntrySource(entry.source, name)) {
      const nextSize = observedSize + BigInt(chunk.length)
      if (nextSize > declaredSize) {
        throw new ArchiveFormatError(
          `SARARCH2 entry ${name} exceeded its declared length ${declaredSize.toString()}.`,
        )
      }
      observedSize = nextSize
      yield chunk
    }
    if (observedSize !== declaredSize) {
      throw new ArchiveFormatError(
        `SARARCH2 entry ${name} declared length ${declaredSize.toString()} but supplied ${observedSize.toString()} bytes.`,
      )
    }
    expectedIndex += 1
  }
  if (expectedIndex === 0) {
    throw new ArchiveFormatError('SARARCH2 requires manifest.json and cannot contain zero entries.')
  }
}

/** Writes one chunk and waits until the Writable has consumed it. */
async function writeToWritable(writable, bytes) {
  if (!writable || typeof writable.write !== 'function') {
    throw new ArchiveFormatError('SARARCH2 output must be a Node Writable stream.')
  }
  await new Promise((resolve, reject) => {
    writable.write(bytes, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

/** Ends a successfully completed Writable and waits for its finish boundary. */
async function finishWritable(writable) {
  await new Promise((resolve, reject) => {
    let settled = false
    /** Rejects the pending finish wait once. */
    const onError = (error) => {
      if (!settled) {
        settled = true
        writable.off('finish', onFinish)
        reject(error)
      }
    }
    /** Resolves the pending finish wait once. */
    const onFinish = () => {
      if (!settled) {
        settled = true
        writable.off('error', onError)
        resolve()
      }
    }
    writable.once('error', onError)
    writable.once('finish', onFinish)
    writable.end()
  })
}

/** Streams one complete repository-owned SARARCH2 container to a Writable. */
async function writeArchiveContainer({
  writable,
  header: headerInput,
  keySlots: keySlotsInput,
  missionArchiveKey,
  entries,
  frameSize = undefined,
  onProgress = undefined,
}) {
  const header = validateArchiveHeader(headerInput)
  const keySlots = validateKeySlots(keySlotsInput, header.key_slot_count)
  if (frameSize !== undefined && frameSize !== header.frame_size) {
    throw new ArchiveFormatError(
      `SARARCH2 requested frame size ${String(frameSize)} does not match authenticated header frame_size ${header.frame_size}.`,
    )
  }
  if (!Buffer.isBuffer(missionArchiveKey) || missionArchiveKey.length !== 32) {
    throw new ArchiveFormatError('SARARCH2 mission archive key must be a 32-byte Buffer.')
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') {
    throw new ArchiveFormatError('SARARCH2 progress observer must be a function.')
  }
  const headerBytes = Buffer.from(canonicalJson(header), 'utf8')
  const slotBytes = Buffer.from(canonicalJson(keySlots), 'utf8')
  if (headerBytes.length > MAX_HEADER_BYTES) {
    throw new ArchiveFormatError('SARARCH2 canonical header exceeds the supported bound.')
  }
  if (slotBytes.length > MAX_KEY_SLOT_BLOCK_BYTES) {
    throw new ArchiveFormatError('SARARCH2 canonical key-slot block exceeds the supported bound.')
  }
  const headerDigest = createHash('sha256').update(headerBytes).digest()
  const noncePrefix = decodeCanonicalBase64(header.nonce_prefix, 4, 'SARARCH2 nonce_prefix')
  const ciphertextHash = createHash('sha256')
  let sizeBytes = 0
  let frameIndex = 0n
  let frameBuffer
  let writableFailure
  const onWritableError = (error) => {
    writableFailure = error
  }
  if (writable && typeof writable.on === 'function') {
    writable.on('error', onWritableError)
  }

  /** Accounts for and writes one exact container byte sequence. */
  async function writeTracked(bytes) {
    if (sizeBytes > Number.MAX_SAFE_INTEGER - bytes.length) {
      throw new ArchiveFormatError('SARARCH2 container size exceeds JavaScript exact byte accounting.')
    }
    ciphertextHash.update(bytes)
    sizeBytes += bytes.length
    await writeToWritable(writable, bytes)
    if (writableFailure !== undefined) {
      throw writableFailure
    }
  }

  /** Encrypts and writes one monotonically indexed frame record. */
  async function writeFrame(plaintext, final) {
    if (!Buffer.isBuffer(plaintext) || plaintext.length > header.frame_size) {
      throw new ArchiveFormatError('SARARCH2 internal frame plaintext exceeds the authenticated frame size.')
    }
    if (frameIndex >= MAX_UINT64) {
      throw new ArchiveFormatError('SARARCH2 frame counter cannot advance without uint64 overflow.')
    }
    const encrypted = encryptFrame({
      missionArchiveKey,
      noncePrefix,
      frameIndex,
      final,
      plaintext,
      headerDigest,
    })
    if (
      !Buffer.isBuffer(encrypted?.ciphertext)
      || encrypted.ciphertext.length !== plaintext.length
      || !Buffer.isBuffer(encrypted.authTag)
      || encrypted.authTag.length !== FRAME_AUTH_TAG_BYTES
    ) {
      throw new ArchiveFormatError('SARARCH2 frame encryption returned an invalid bounded result.')
    }
    const recordHeader = Buffer.alloc(FRAME_RECORD_HEADER_BYTES)
    recordHeader.writeBigUInt64BE(frameIndex)
    recordHeader[8] = final ? 1 : 0
    recordHeader.writeUInt32BE(plaintext.length, 9)
    await writeTracked(recordHeader)
    await writeTracked(encrypted.ciphertext)
    await writeTracked(encrypted.authTag)
    frameIndex += 1n
    if (onProgress !== undefined) {
      if (frameIndex > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ArchiveFormatError('SARARCH2 frame progress exceeds exact integer accounting.')
      }
      onProgress(Object.freeze({
        processedBytes: sizeBytes,
        frameCount: Number(frameIndex),
      }))
    }
  }

  try {
    const headerLength = Buffer.alloc(4)
    headerLength.writeUInt32BE(headerBytes.length)
    const slotLength = Buffer.alloc(4)
    slotLength.writeUInt32BE(slotBytes.length)
    await writeTracked(SARARCH2_MAGIC)
    await writeTracked(headerLength)
    await writeTracked(headerBytes)
    await writeTracked(slotLength)
    await writeTracked(slotBytes)

    frameBuffer = Buffer.allocUnsafe(header.frame_size)
    let buffered = 0
    for await (const chunk of encodeLogicalEntries(entries)) {
      let offset = 0
      while (offset < chunk.length) {
        const take = Math.min(header.frame_size - buffered, chunk.length - offset)
        chunk.copy(frameBuffer, buffered, offset, offset + take)
        buffered += take
        offset += take
        if (buffered === header.frame_size) {
          await writeFrame(frameBuffer, false)
          buffered = 0
        }
      }
    }
    if (buffered > 0) {
      await writeFrame(frameBuffer.subarray(0, buffered), false)
    }
    await writeFrame(Buffer.alloc(0), true)

    const trailer = Buffer.alloc(TRAILER_BYTES)
    SARARCH2_TRAILER_MAGIC.copy(trailer, 0)
    trailer.writeBigUInt64BE(frameIndex, SARARCH2_TRAILER_MAGIC.length)
    trailer[TRAILER_BYTES - 1] = 1
    await writeTracked(trailer)
    await finishWritable(writable)

    return Object.freeze({
      ciphertextSha256: ciphertextHash.digest('hex'),
      sizeBytes,
      frameCount: frameIndex,
      headerDigest: headerDigest.toString('hex'),
    })
  } catch (error) {
    if (writable && typeof writable.destroy === 'function' && !writable.destroyed) {
      writable.destroy()
    }
    throw error
  } finally {
    frameBuffer?.fill(0)
    if (writable && typeof writable.off === 'function') {
      writable.off('error', onWritableError)
    }
  }
}

/** Incrementally decodes the encrypted logical entry stream without whole-entry buffering. */
class LogicalEntryDecoder {
  /** Creates an ordered entry decoder around optional async streaming callbacks. */
  constructor({ onEntryStart, onEntryChunk, onEntryEnd }) {
    this.onEntryStart = onEntryStart
    this.onEntryChunk = onEntryChunk
    this.onEntryEnd = onEntryEnd
    this.pending = Buffer.alloc(0)
    this.state = 'marker'
    this.expectedHeaderLength = 0
    this.expectedIndex = 0
    this.names = new Set()
    this.currentEntry = null
    this.remaining = 0n
  }

  /** Appends one authenticated plaintext frame and drains all complete entry units. */
  async push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      throw new ArchiveFormatError('SARARCH2 logical stream received a non-Buffer frame.')
    }
    this.pending = this.pending.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.pending, chunk])

    while (true) {
      if (this.state === 'marker') {
        if (this.pending.length < SARARCH2_ENTRY_MAGIC.length) {
          return
        }
        const marker = this.take(SARARCH2_ENTRY_MAGIC.length)
        if (!marker.equals(SARARCH2_ENTRY_MAGIC)) {
          throw new ArchiveFormatError(`Invalid SARARCH2 logical entry marker at index ${this.expectedIndex}.`)
        }
        this.state = 'header-length'
      } else if (this.state === 'header-length') {
        if (this.pending.length < 4) {
          return
        }
        this.expectedHeaderLength = this.take(4).readUInt32BE(0)
        if (this.expectedHeaderLength < 2 || this.expectedHeaderLength > MAX_ENTRY_HEADER_BYTES) {
          throw new ArchiveFormatError(
            `SARARCH2 entry header length ${this.expectedHeaderLength} is outside the supported bound.`,
          )
        }
        this.state = 'header'
      } else if (this.state === 'header') {
        if (this.pending.length < this.expectedHeaderLength) {
          return
        }
        const entryHeader = parseCanonicalJson(
          this.take(this.expectedHeaderLength),
          `SARARCH2 entry header ${this.expectedIndex}`,
        )
        if (!isPlainRecord(entryHeader)) {
          throw new ArchiveFormatError(`SARARCH2 entry header ${this.expectedIndex} must be an object.`)
        }
        requireExactKeys(entryHeader, ['index', 'name'], `SARARCH2 entry header ${this.expectedIndex}`)
        if (!Number.isSafeInteger(entryHeader.index) || entryHeader.index !== this.expectedIndex) {
          throw new ArchiveFormatError(
            `SARARCH2 logical entry index sequence expected ${this.expectedIndex} and received ${String(entryHeader.index)}.`,
          )
        }
        const name = validateEntryName(entryHeader.name)
        if (this.expectedIndex === 0 && name !== 'manifest.json') {
          throw new ArchiveFormatError('The first SARARCH2 entry must be manifest.json.')
        }
        if (this.names.has(name)) {
          throw new ArchiveFormatError(`Duplicate SARARCH2 entry name ${name}.`)
        }
        this.names.add(name)
        this.currentEntry = { index: this.expectedIndex, name, size: 0n }
        this.state = 'size'
      } else if (this.state === 'size') {
        if (this.pending.length < 8) {
          return
        }
        const size = this.take(8).readBigUInt64BE(0)
        this.currentEntry = Object.freeze({ ...this.currentEntry, size })
        this.remaining = size
        await this.onEntryStart?.(this.currentEntry)
        if (size === 0n) {
          await this.finishCurrentEntry()
        } else {
          this.state = 'content'
        }
      } else if (this.state === 'content') {
        if (this.pending.length === 0) {
          return
        }
        const available = BigInt(this.pending.length)
        const takeLength = this.remaining < available ? Number(this.remaining) : this.pending.length
        const content = this.take(takeLength)
        this.remaining -= BigInt(takeLength)
        await this.onEntryChunk?.(this.currentEntry, content)
        if (this.remaining === 0n) {
          await this.finishCurrentEntry()
        }
      } else {
        throw new ArchiveFormatError('SARARCH2 logical entry decoder entered an invalid state.')
      }
    }
  }

  /** Removes one already-bounded prefix from the pending plaintext. */
  take(length) {
    const value = this.pending.subarray(0, length)
    const remainder = this.pending.subarray(length)
    this.pending = remainder.length === 0 ? Buffer.alloc(0) : remainder
    return value
  }

  /** Ends the current entry and advances to the next required index. */
  async finishCurrentEntry() {
    const completed = this.currentEntry
    await this.onEntryEnd?.(completed)
    this.expectedIndex += 1
    this.currentEntry = null
    this.state = 'marker'
  }

  /** Requires the authenticated final frame to align exactly with an entry boundary. */
  finish() {
    if (this.state === 'content') {
      const supplied = this.currentEntry.size - this.remaining
      throw new ArchiveFormatError(
        `SARARCH2 entry ${this.currentEntry.name} declared length ${this.currentEntry.size.toString()} but authenticated final frame arrived after ${supplied.toString()} bytes.`,
      )
    }
    if (this.state !== 'marker' || this.pending.length !== 0) {
      throw new ArchiveFormatError('SARARCH2 authenticated final frame interrupted a logical entry header.')
    }
    if (this.expectedIndex === 0) {
      throw new ArchiveFormatError('SARARCH2 encrypted logical stream contains no manifest.json entry.')
    }
    return this.expectedIndex
  }
}

/** Authenticates and streams every entry in one complete SARARCH2 container. */
async function readArchiveContainer({
  readable,
  missionArchiveKey,
  onEntryStart = undefined,
  onEntryChunk = undefined,
  onEntryEnd = undefined,
}) {
  if (!Buffer.isBuffer(missionArchiveKey) || missionArchiveKey.length !== 32) {
    throw new ArchiveFormatError('SARARCH2 mission archive key must be a 32-byte Buffer.')
  }
  const ciphertextHash = createHash('sha256')
  let sizeBytes = 0
  const reader = new ArchiveByteReader(readable, (chunk) => {
    if (sizeBytes > Number.MAX_SAFE_INTEGER - chunk.length) {
      throw new ArchiveFormatError('SARARCH2 input exceeds JavaScript exact byte accounting.')
    }
    ciphertextHash.update(chunk)
    sizeBytes += chunk.length
  })
  const preamble = await readPreambleFromReader(reader)
  const noncePrefix = decodeCanonicalBase64(
    preamble.header.nonce_prefix,
    4,
    'SARARCH2 nonce_prefix',
  )
  const logical = new LogicalEntryDecoder({ onEntryStart, onEntryChunk, onEntryEnd })
  let expectedFrameIndex = 0n

  while (true) {
    const recordHeader = await reader.readExactly(FRAME_RECORD_HEADER_BYTES, 'frame record header')
    const frameIndex = recordHeader.readBigUInt64BE(0)
    const finalFlag = recordHeader[8]
    const plaintextLength = recordHeader.readUInt32BE(9)
    if (frameIndex !== expectedFrameIndex) {
      throw new ArchiveFormatError(
        `SARARCH2 frame index sequence expected ${expectedFrameIndex.toString()} and received ${frameIndex.toString()}.`,
      )
    }
    if (finalFlag !== 0 && finalFlag !== 1) {
      throw new ArchiveFormatError(`SARARCH2 frame ${frameIndex.toString()} has an invalid final flag.`)
    }
    const final = finalFlag === 1
    if (plaintextLength > preamble.header.frame_size) {
      throw new ArchiveFormatError(
        `SARARCH2 frame ${frameIndex.toString()} exceeds authenticated frame_size.`,
      )
    }
    if (final && plaintextLength !== 0) {
      throw new ArchiveFormatError('SARARCH2 final frame must have zero plaintext length.')
    }
    if (!final && plaintextLength === 0) {
      throw new ArchiveFormatError('SARARCH2 non-final frame cannot have zero plaintext length.')
    }
    const ciphertext = await reader.readExactly(
      plaintextLength,
      `frame ${frameIndex.toString()} ciphertext`,
    )
    const authTag = await reader.readExactly(
      FRAME_AUTH_TAG_BYTES,
      `frame ${frameIndex.toString()} authentication tag`,
    )
    const plaintext = decryptFrame({
      missionArchiveKey,
      noncePrefix,
      frameIndex,
      final,
      ciphertext,
      authTag,
      plaintextLength,
      headerDigest: preamble.headerDigest,
    })
    if (!Buffer.isBuffer(plaintext) || plaintext.length !== plaintextLength) {
      throw new ArchiveFormatError(
        `SARARCH2 frame ${frameIndex.toString()} decryption returned an invalid plaintext length.`,
      )
    }
    expectedFrameIndex += 1n
    if (final) {
      plaintext.fill(0)
      break
    }
    try {
      await logical.push(plaintext)
    } finally {
      plaintext.fill(0)
    }
  }

  const entryCount = logical.finish()
  const trailer = await reader.readExactly(TRAILER_BYTES, 'fixed trailer')
  if (!trailer.subarray(0, SARARCH2_TRAILER_MAGIC.length).equals(SARARCH2_TRAILER_MAGIC)) {
    throw new ArchiveFormatError('SARARCH2 trailer magic is invalid.')
  }
  const trailerFrameCount = trailer.readBigUInt64BE(SARARCH2_TRAILER_MAGIC.length)
  if (trailerFrameCount !== expectedFrameIndex) {
    throw new ArchiveFormatError(
      `SARARCH2 trailer frame count ${trailerFrameCount.toString()} does not match authenticated count ${expectedFrameIndex.toString()}.`,
    )
  }
  if (trailer[TRAILER_BYTES - 1] !== 1) {
    throw new ArchiveFormatError('SARARCH2 trailer final-flag echo is invalid.')
  }
  await reader.requireEndOfFile()

  return Object.freeze({
    header: preamble.header,
    keySlots: preamble.keySlots,
    ciphertextSha256: ciphertextHash.digest('hex'),
    sizeBytes,
    frameCount: expectedFrameIndex,
    headerDigest: preamble.headerDigest.toString('hex'),
    entryCount,
  })
}

module.exports = {
  SARARCH2_MAGIC,
  SARARCH2_TRAILER_MAGIC,
  SARARCH2_CONTAINER_VERSION,
  DEFAULT_ARCHIVE_FRAME_SIZE,
  ArchiveFormatError,
  ArchiveTruncationError,
  canonicalJson,
  parseCanonicalJson,
  validateArchiveHeader,
  readArchivePreamble,
  writeArchiveContainer,
  readArchiveContainer,
}
