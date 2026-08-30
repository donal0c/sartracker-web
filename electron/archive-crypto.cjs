const {
  createCipheriv,
  createDecipheriv,
  randomBytes: cryptoRandomBytes,
  scrypt,
} = require('node:crypto')

const MISSION_ARCHIVE_KEY_BYTES = 32
const RECOVERY_CODE_BYTES = 25
const WRAP_NONCE_BYTES = 12
const FRAME_NONCE_PREFIX_BYTES = 4
const FRAME_NONCE_BYTES = 12
const HEADER_DIGEST_BYTES = 32
const AUTH_TAG_BYTES = 16
const MAX_UINT64 = 0xffff_ffff_ffff_ffffn
const MAX_UINT32 = 0xffff_ffff
const SLOT_VERSION = 1
const SLOT_KDF = 'scrypt'
const SLOT_TYPES = Object.freeze(new Set(['passphrase', 'recovery', 'machine']))
const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const SARARCH2_SCRYPT_PROFILE = Object.freeze({
  version: 1,
  N: 131_072,
  r: 8,
  p: 1,
  keyLength: 32,
  saltBytes: 32,
  maxmem: 268_435_456,
})

const SCRYPT_PROFILE_KEYS = Object.freeze(
  Object.keys(SARARCH2_SCRYPT_PROFILE).sort(),
)
const SLOT_KEYS = Object.freeze(
  [
    'authTag',
    'ciphertext',
    'kdf',
    'nonce',
    'profile',
    'salt',
    'slotId',
    'slotType',
    'slotVersion',
  ].sort(),
)

/** Signals that a valid key slot did not authenticate with the supplied credential. */
class ArchiveWrongKeyError extends Error {
  /**
   * @param {string} [message] Safe operator-facing failure detail.
   */
  constructor(
    message = 'The archive key slot could not be unlocked with the supplied credential.',
  ) {
    super(message)
    this.name = 'ArchiveWrongKeyError'
    this.code = 'ARCHIVE_WRONG_KEY'
  }
}

/** Signals that an encrypted archive frame failed AES-GCM authentication. */
class ArchiveAuthenticationError extends Error {
  /**
   * @param {string} [message] Safe operator-facing failure detail.
   */
  constructor(
    message = 'The archive frame failed authentication and cannot be read safely.',
  ) {
    super(message)
    this.name = 'ArchiveAuthenticationError'
    this.code = 'ARCHIVE_AUTHENTICATION_FAILED'
  }
}

/**
 * Creates an error with a stable machine-readable code.
 *
 * @param {new (message: string) => Error} ErrorType Error constructor.
 * @param {string} code Stable error code.
 * @param {string} message Safe error detail.
 * @returns {Error & { code?: string }} Coded error.
 */
function createCodedError(ErrorType, code, message) {
  const error = new ErrorType(message)
  error.code = code
  return error
}

/**
 * Copies and validates a byte-array input.
 *
 * @param {unknown} value Candidate byte array.
 * @param {string} label Field label used in safe errors.
 * @param {number | undefined} expectedLength Required byte length when fixed.
 * @returns {Buffer} Defensive byte copy.
 */
function copyBytes(value, label, expectedLength) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a mutable byte buffer.`)
  }
  const copy = Buffer.from(value)
  if (expectedLength !== undefined && copy.length !== expectedLength) {
    throw new RangeError(`${label} must contain exactly ${expectedLength} bytes.`)
  }
  return copy
}

/**
 * Validates a random-byte provider and its exact-size result.
 *
 * @param {((size: number) => Buffer | Uint8Array) | undefined} source Random provider.
 * @param {number} size Required byte count.
 * @param {string} label Output label.
 * @returns {Buffer} Defensive copy of random bytes.
 */
function obtainRandomBytes(source, size, label) {
  const provider = source === undefined ? cryptoRandomBytes : source
  if (typeof provider !== 'function') {
    throw new TypeError('The random-byte source must be a function.')
  }
  return copyBytes(provider(size), label, size)
}

/**
 * Converts a supported frame index into an unsigned 64-bit integer.
 *
 * @param {unknown} value Candidate frame index.
 * @returns {bigint} Validated index.
 */
function normalizeFrameIndex(value) {
  let normalized
  if (typeof value === 'bigint') {
    normalized = value
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    normalized = BigInt(value)
  } else {
    throw new RangeError('The frame index must be a safe unsigned 64-bit integer.')
  }
  if (normalized < 0n || normalized > MAX_UINT64) {
    throw new RangeError('The frame index must be between 0 and 2^64-1.')
  }
  return normalized
}

/**
 * Validates a frame plaintext length for its uint32 framing field.
 *
 * @param {unknown} value Candidate length.
 * @returns {number} Validated length.
 */
function normalizePlaintextLength(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new RangeError('The frame plaintext length must fit an unsigned 32-bit integer.')
  }
  return value
}

/**
 * Validates a boolean final-frame flag without truthy coercion.
 *
 * @param {unknown} value Candidate flag.
 * @returns {boolean} Validated flag.
 */
function normalizeFinalFlag(value) {
  if (typeof value !== 'boolean') {
    throw new TypeError('The frame final flag must be a boolean.')
  }
  return value
}

/**
 * Validates an internal slot type.
 *
 * @param {unknown} value Candidate slot type.
 * @returns {'passphrase' | 'recovery' | 'machine'} Validated slot type.
 */
function normalizeSlotType(value) {
  if (typeof value !== 'string' || !SLOT_TYPES.has(value)) {
    throw new TypeError('The archive key slot type is unsupported.')
  }
  return value
}

/**
 * Validates a bounded internal key-slot identifier.
 *
 * @param {unknown} value Candidate identifier.
 * @returns {string} Validated identifier.
 */
function normalizeSlotId(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new TypeError(
      'The archive key slot identifier must be 1-128 safe identifier characters.',
    )
  }
  return value
}

/**
 * Converts a secret into an owned mutable copy for the KDF.
 *
 * @param {unknown} secret Candidate secret.
 * @returns {Buffer} Owned mutable bytes.
 */
function copySecretBytes(secret) {
  if (typeof secret === 'string') {
    const encoded = Buffer.from(secret, 'utf8')
    if (encoded.length === 0) {
      throw new TypeError('The archive credential must not be empty.')
    }
    return encoded
  }
  const encoded = copyBytes(secret, 'The archive credential')
  if (encoded.length === 0) {
    throw new TypeError('The archive credential must not be empty.')
  }
  return encoded
}

/**
 * Canonicalizes a slot credential while preserving passphrases exactly.
 *
 * @param {'passphrase' | 'recovery' | 'machine'} slotType Valid slot type.
 * @param {unknown} secret Candidate secret.
 * @returns {string | Buffer | Uint8Array} Canonical credential.
 */
function normalizeSlotSecret(slotType, secret) {
  if (slotType === 'recovery') {
    if (typeof secret !== 'string') {
      throw new TypeError('The archive recovery credential must be a recovery-code string.')
    }
    return normalizeRecoveryCode(secret)
  }
  return secret
}

/**
 * Encodes a uint32 value as big-endian bytes.
 *
 * @param {number} value Valid uint32 value.
 * @returns {Buffer} Four-byte encoding.
 */
function uint32be(value) {
  const encoded = Buffer.allocUnsafe(4)
  encoded.writeUInt32BE(value, 0)
  return encoded
}

/**
 * Encodes UTF-8 or binary data with a uint32 byte-length prefix.
 *
 * @param {string | Buffer | Uint8Array} value Input value.
 * @returns {Buffer} Length-declared bytes.
 */
function lengthPrefixed(value) {
  const encoded =
    typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  if (encoded.length > MAX_UINT32) {
    throw new RangeError('The authenticated slot field is too large.')
  }
  return Buffer.concat([uint32be(encoded.length), encoded])
}

/**
 * Produces stable AAD for an independently wrapped archive-key slot.
 *
 * @param {object} input Authenticated slot metadata.
 * @param {Buffer} input.headerDigest Canonical header SHA-256.
 * @param {'passphrase' | 'recovery' | 'machine'} input.slotType Slot type.
 * @param {string} input.slotId Slot identifier.
 * @param {number} input.slotVersion Slot format version.
 * @param {string} input.kdf KDF identifier.
 * @param {typeof SARARCH2_SCRYPT_PROFILE} input.profile Exact KDF profile.
 * @param {Buffer} input.salt KDF salt.
 * @param {Buffer} input.nonce AES-GCM wrap nonce.
 * @returns {Buffer} Stable authenticated bytes.
 */
function createSlotAad({
  headerDigest,
  slotType,
  slotId,
  slotVersion,
  kdf,
  profile,
  salt,
  nonce,
}) {
  return Buffer.concat([
    Buffer.from('SARARCH2\0KEYSLOT\0', 'ascii'),
    headerDigest,
    lengthPrefixed(slotType),
    lengthPrefixed(slotId),
    uint32be(slotVersion),
    lengthPrefixed(kdf),
    uint32be(profile.version),
    uint32be(profile.N),
    uint32be(profile.r),
    uint32be(profile.p),
    uint32be(profile.keyLength),
    uint32be(profile.saltBytes),
    uint32be(profile.maxmem),
    lengthPrefixed(salt),
    lengthPrefixed(nonce),
  ])
}

/**
 * Decodes canonical padded Base64 and validates the exact byte length.
 *
 * @param {unknown} value Candidate Base64 field.
 * @param {string} label Field label.
 * @param {number} expectedLength Required decoded length.
 * @returns {Buffer} Decoded bytes.
 */
function decodeCanonicalBase64(value, label, expectedLength) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be canonical Base64 text.`)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new TypeError(`${label} must be canonical padded Base64 text.`)
  }
  if (decoded.length !== expectedLength) {
    throw new RangeError(`${label} must decode to exactly ${expectedLength} bytes.`)
  }
  return decoded
}

/**
 * Validates the exact serializable v1 key-slot shape.
 *
 * @param {unknown} slot Candidate slot.
 * @returns {{
 *   slotType: 'passphrase' | 'recovery' | 'machine',
 *   slotId: string,
 *   slotVersion: 1,
 *   kdf: 'scrypt',
 *   profile: typeof SARARCH2_SCRYPT_PROFILE,
 *   salt: Buffer,
 *   nonce: Buffer,
 *   ciphertext: Buffer,
 *   authTag: Buffer,
 * }} Validated slot data.
 */
function validateKeySlot(slot) {
  if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
    throw new TypeError('The archive key slot must be an object.')
  }
  const keys = Object.keys(slot).sort()
  if (
    keys.length !== SLOT_KEYS.length ||
    keys.some((key, index) => key !== SLOT_KEYS[index])
  ) {
    throw new TypeError('The archive key slot has missing or unknown fields.')
  }
  const slotType = normalizeSlotType(slot.slotType)
  const slotId = normalizeSlotId(slot.slotId)
  if (slot.slotVersion !== SLOT_VERSION) {
    throw new RangeError('The archive key slot version is unsupported.')
  }
  if (slot.kdf !== SLOT_KDF) {
    throw new RangeError('The archive key slot KDF is unsupported.')
  }
  const profile = validateScryptParameters(slot.profile)
  return {
    slotType,
    slotId,
    slotVersion: SLOT_VERSION,
    kdf: SLOT_KDF,
    profile,
    salt: decodeCanonicalBase64(slot.salt, 'The archive key slot salt', profile.saltBytes),
    nonce: decodeCanonicalBase64(slot.nonce, 'The archive key slot nonce', WRAP_NONCE_BYTES),
    ciphertext: decodeCanonicalBase64(
      slot.ciphertext,
      'The wrapped mission archive key',
      MISSION_ARCHIVE_KEY_BYTES,
    ),
    authTag: decodeCanonicalBase64(
      slot.authTag,
      'The archive key slot authentication tag',
      AUTH_TAG_BYTES,
    ),
  }
}

/**
 * Generates a fresh 256-bit mission archive key.
 *
 * @param {(size: number) => Buffer | Uint8Array} [randomBytes] Injectable CSPRNG.
 * @returns {Buffer} New mission archive key.
 */
function generateMissionArchiveKey(randomBytes) {
  return obtainRandomBytes(
    randomBytes,
    MISSION_ARCHIVE_KEY_BYTES,
    'The generated mission archive key',
  )
}

/**
 * Generates one archive-specific 200-bit Crockford Base32 recovery code.
 *
 * @param {(size: number) => Buffer | Uint8Array} [randomBytes] Injectable CSPRNG.
 * @returns {string} Eight groups of five recovery characters.
 */
function generateRecoveryCode(randomBytes) {
  const entropy = obtainRandomBytes(
    randomBytes,
    RECOVERY_CODE_BYTES,
    'The generated archive recovery entropy',
  )
  try {
    let accumulator = 0
    let bits = 0
    let encoded = ''
    for (const byte of entropy) {
      accumulator = (accumulator << 8) | byte
      bits += 8
      while (bits >= 5) {
        bits -= 5
        encoded += CROCKFORD_BASE32_ALPHABET[(accumulator >>> bits) & 0x1f]
      }
      accumulator = bits === 0 ? 0 : accumulator & ((1 << bits) - 1)
    }
    if (bits !== 0 || encoded.length !== 40) {
      throw new Error('The archive recovery-code encoder did not consume exactly 200 bits.')
    }
    return encoded.match(/.{5}/g).join('-')
  } finally {
    zeroBuffer(entropy)
  }
}

/**
 * Canonicalizes a recovery code without mapping ambiguous Crockford characters.
 *
 * @param {string} value Candidate recovery code.
 * @returns {string} Uppercase eight-by-five grouped code.
 */
function normalizeRecoveryCode(value) {
  if (typeof value !== 'string') {
    throw new TypeError('The archive recovery code must be text.')
  }
  if (/[ILOU]/i.test(value)) {
    throw new TypeError(
      'The archive recovery code contains an ambiguous character (I, L, O or U).',
    )
  }
  if (/[^0-9A-HJKMNP-TV-Z\s-]/i.test(value)) {
    throw new TypeError('The archive recovery code contains an invalid character.')
  }
  const compact = value.replace(/[\s-]/g, '').toUpperCase()
  if (compact.length !== 40) {
    throw new RangeError('The archive recovery code must contain exactly 40 characters.')
  }
  if (!/^[0-9A-HJKMNP-TV-Z]{40}$/.test(compact)) {
    throw new TypeError('The archive recovery code contains an invalid character.')
  }
  return compact.match(/.{5}/g).join('-')
}

/**
 * Accepts only the exact supported SARARCH2 scrypt v1 profile.
 *
 * @param {unknown} profile Candidate serialized profile.
 * @returns {typeof SARARCH2_SCRYPT_PROFILE} Canonical frozen profile.
 */
function validateScryptParameters(profile) {
  const fail = () => {
    throw createCodedError(
      RangeError,
      'ARCHIVE_SCRYPT_PROFILE_UNSUPPORTED',
      'Unsupported SARARCH2 scrypt profile; the exact v1 profile is required and is never weakened automatically.',
    )
  }
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    return fail()
  }
  const keys = Object.keys(profile).sort()
  if (
    keys.length !== SCRYPT_PROFILE_KEYS.length ||
    keys.some((key, index) => key !== SCRYPT_PROFILE_KEYS[index])
  ) {
    return fail()
  }
  for (const key of SCRYPT_PROFILE_KEYS) {
    if (!Number.isInteger(profile[key]) || profile[key] !== SARARCH2_SCRYPT_PROFILE[key]) {
      return fail()
    }
  }
  return SARARCH2_SCRYPT_PROFILE
}

/**
 * Derives a key-slot wrapping key with the exact supported scrypt profile.
 * Owned secret bytes are overwritten when derivation settles.
 *
 * @param {object} input Derivation input.
 * @param {string | Buffer | Uint8Array} input.secret Slot credential.
 * @param {Buffer | Uint8Array} input.salt Exact 32-byte salt.
 * @param {typeof SARARCH2_SCRYPT_PROFILE} [input.profile] Serialized profile.
 * @returns {Promise<Buffer>} Derived 256-bit wrapping key; caller must overwrite it.
 */
async function deriveSlotKey({ secret, salt, profile = SARARCH2_SCRYPT_PROFILE }) {
  const validatedProfile = validateScryptParameters(profile)
  const saltBytes = copyBytes(salt, 'The archive key slot salt', validatedProfile.saltBytes)
  const secretBytes = copySecretBytes(secret)
  try {
    return await new Promise((resolve, reject) => {
      scrypt(
        secretBytes,
        saltBytes,
        validatedProfile.keyLength,
        {
          N: validatedProfile.N,
          r: validatedProfile.r,
          p: validatedProfile.p,
          maxmem: validatedProfile.maxmem,
        },
        (error, derivedKey) => {
          if (error) {
            reject(
              createCodedError(
                Error,
                'ARCHIVE_SCRYPT_UNAVAILABLE',
                'This computer could not run the required SARARCH2 scrypt v1 profile; archive access was stopped without weakening it.',
              ),
            )
            return
          }
          // Return the one mutable buffer produced by Node so the caller can
          // overwrite the actual derived-key allocation instead of only a copy.
          resolve(derivedKey)
        },
      )
    })
  } finally {
    zeroBuffer(secretBytes)
    zeroBuffer(saltBytes)
  }
}

/**
 * Wraps a mission archive key into one authenticated, serializable key slot.
 *
 * @param {object} input Wrap input.
 * @param {Buffer | Uint8Array} input.missionArchiveKey Random 256-bit MAK.
 * @param {'passphrase' | 'recovery' | 'machine'} input.slotType Slot type.
 * @param {string} input.slotId Internal slot identifier.
 * @param {string | Buffer | Uint8Array} input.secret Slot credential.
 * @param {Buffer | Uint8Array} input.headerDigest Canonical header SHA-256.
 * @param {(size: number) => Buffer | Uint8Array} [input.randomBytes] Injectable CSPRNG.
 * @returns {Promise<object>} Serializable authenticated key slot.
 */
async function wrapMissionArchiveKey({
  missionArchiveKey,
  slotType,
  slotId,
  secret,
  headerDigest,
  randomBytes,
}) {
  const mak = copyBytes(
    missionArchiveKey,
    'The mission archive key',
    MISSION_ARCHIVE_KEY_BYTES,
  )
  const normalizedSlotType = normalizeSlotType(slotType)
  const normalizedSlotId = normalizeSlotId(slotId)
  const normalizedSecret = normalizeSlotSecret(normalizedSlotType, secret)
  const header = copyBytes(headerDigest, 'The canonical archive header digest', HEADER_DIGEST_BYTES)
  const salt = obtainRandomBytes(
    randomBytes,
    SARARCH2_SCRYPT_PROFILE.saltBytes,
    'The archive key slot salt',
  )
  const nonce = obtainRandomBytes(randomBytes, WRAP_NONCE_BYTES, 'The archive key slot nonce')
  let wrappingKey
  try {
    wrappingKey = await deriveSlotKey({
      secret: normalizedSecret,
      salt,
      profile: SARARCH2_SCRYPT_PROFILE,
    })
    const aad = createSlotAad({
      headerDigest: header,
      slotType: normalizedSlotType,
      slotId: normalizedSlotId,
      slotVersion: SLOT_VERSION,
      kdf: SLOT_KDF,
      profile: SARARCH2_SCRYPT_PROFILE,
      salt,
      nonce,
    })
    const cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    })
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([cipher.update(mak), cipher.final()])
    const authTag = cipher.getAuthTag()
    return Object.freeze({
      slotType: normalizedSlotType,
      slotId: normalizedSlotId,
      slotVersion: SLOT_VERSION,
      kdf: SLOT_KDF,
      profile: SARARCH2_SCRYPT_PROFILE,
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: authTag.toString('base64'),
    })
  } finally {
    zeroBuffer(mak)
    zeroBuffer(header)
    zeroBuffer(salt)
    zeroBuffer(nonce)
    if (wrappingKey !== undefined) {
      zeroBuffer(wrappingKey)
    }
  }
}

/**
 * Authenticates and unwraps one mission archive key before any payload access.
 *
 * @param {object} input Unwrap input.
 * @param {unknown} input.slot Serialized key slot.
 * @param {string | Buffer | Uint8Array} input.secret Slot credential.
 * @param {Buffer | Uint8Array} input.headerDigest Canonical header SHA-256.
 * @returns {Promise<Buffer>} Authenticated 256-bit MAK; caller must overwrite it.
 * @throws {ArchiveWrongKeyError} When credential or authenticated slot metadata is wrong.
 */
async function unwrapMissionArchiveKey({ slot, secret, headerDigest }) {
  const validatedSlot = validateKeySlot(slot)
  const normalizedSecret = normalizeSlotSecret(validatedSlot.slotType, secret)
  const header = copyBytes(headerDigest, 'The canonical archive header digest', HEADER_DIGEST_BYTES)
  let wrappingKey
  try {
    wrappingKey = await deriveSlotKey({
      secret: normalizedSecret,
      salt: validatedSlot.salt,
      profile: validatedSlot.profile,
    })
    const aad = createSlotAad({
      headerDigest: header,
      slotType: validatedSlot.slotType,
      slotId: validatedSlot.slotId,
      slotVersion: validatedSlot.slotVersion,
      kdf: validatedSlot.kdf,
      profile: validatedSlot.profile,
      salt: validatedSlot.salt,
      nonce: validatedSlot.nonce,
    })
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        wrappingKey,
        validatedSlot.nonce,
        { authTagLength: AUTH_TAG_BYTES },
      )
      decipher.setAAD(aad)
      decipher.setAuthTag(validatedSlot.authTag)
      return Buffer.concat([
        decipher.update(validatedSlot.ciphertext),
        decipher.final(),
      ])
    } catch {
      throw new ArchiveWrongKeyError()
    }
  } finally {
    zeroBuffer(header)
    zeroBuffer(validatedSlot.salt)
    zeroBuffer(validatedSlot.nonce)
    zeroBuffer(validatedSlot.ciphertext)
    zeroBuffer(validatedSlot.authTag)
    if (wrappingKey !== undefined) {
      zeroBuffer(wrappingKey)
    }
  }
}

/**
 * Derives a unique 96-bit frame nonce from a four-byte prefix and uint64 index.
 *
 * @param {Buffer | Uint8Array} noncePrefix Random per-archive nonce prefix.
 * @param {bigint | number} frameIndex Monotonic unsigned frame index.
 * @returns {Buffer} Twelve-byte AES-GCM nonce.
 */
function deriveFrameNonce(noncePrefix, frameIndex) {
  const prefix = copyBytes(
    noncePrefix,
    'The archive frame nonce prefix',
    FRAME_NONCE_PREFIX_BYTES,
  )
  const index = normalizeFrameIndex(frameIndex)
  const nonce = Buffer.alloc(FRAME_NONCE_BYTES)
  prefix.copy(nonce, 0)
  nonce.writeBigUInt64BE(index, FRAME_NONCE_PREFIX_BYTES)
  zeroBuffer(prefix)
  return nonce
}

/**
 * Builds the fixed SARARCH2 frame AAD layout.
 *
 * @param {object} input Frame metadata.
 * @param {Buffer | Uint8Array} input.headerDigest Canonical header SHA-256.
 * @param {bigint | number} input.frameIndex Monotonic unsigned frame index.
 * @param {boolean} input.final Exact final-frame flag.
 * @param {number} input.plaintextLength Declared uint32 plaintext length.
 * @returns {Buffer} 45-byte frame AAD.
 */
function createFrameAad({ headerDigest, frameIndex, final, plaintextLength }) {
  const header = copyBytes(headerDigest, 'The canonical archive header digest', HEADER_DIGEST_BYTES)
  const index = normalizeFrameIndex(frameIndex)
  const finalFlag = normalizeFinalFlag(final)
  const length = normalizePlaintextLength(plaintextLength)
  const aad = Buffer.alloc(HEADER_DIGEST_BYTES + 8 + 1 + 4)
  header.copy(aad, 0)
  aad.writeBigUInt64BE(index, HEADER_DIGEST_BYTES)
  aad.writeUInt8(finalFlag ? 1 : 0, HEADER_DIGEST_BYTES + 8)
  aad.writeUInt32BE(length, HEADER_DIGEST_BYTES + 9)
  zeroBuffer(header)
  return aad
}

/**
 * Encrypts one independently authenticated SARARCH2 frame.
 *
 * @param {object} input Frame input.
 * @param {Buffer | Uint8Array} input.missionArchiveKey Authenticated MAK.
 * @param {Buffer | Uint8Array} input.noncePrefix Per-archive nonce prefix.
 * @param {bigint | number} input.frameIndex Monotonic frame index.
 * @param {boolean} input.final Exact final-frame flag.
 * @param {Buffer | Uint8Array} input.plaintext Frame plaintext.
 * @param {Buffer | Uint8Array} input.headerDigest Canonical header SHA-256.
 * @returns {{ ciphertext: Buffer, authTag: Buffer }} Encrypted frame body.
 */
function encryptFrame({
  missionArchiveKey,
  noncePrefix,
  frameIndex,
  final,
  plaintext,
  headerDigest,
}) {
  const mak = copyBytes(
    missionArchiveKey,
    'The mission archive key',
    MISSION_ARCHIVE_KEY_BYTES,
  )
  const plaintextBytes = copyBytes(plaintext, 'The archive frame plaintext')
  const finalFlag = normalizeFinalFlag(final)
  normalizePlaintextLength(plaintextBytes.length)
  const nonce = deriveFrameNonce(noncePrefix, frameIndex)
  const aad = createFrameAad({
    headerDigest,
    frameIndex,
    final: finalFlag,
    plaintextLength: plaintextBytes.length,
  })
  try {
    const cipher = createCipheriv('aes-256-gcm', mak, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    })
    cipher.setAAD(aad)
    return {
      ciphertext: Buffer.concat([cipher.update(plaintextBytes), cipher.final()]),
      authTag: cipher.getAuthTag(),
    }
  } finally {
    zeroBuffer(mak)
    zeroBuffer(plaintextBytes)
    zeroBuffer(nonce)
    zeroBuffer(aad)
  }
}

/**
 * Authenticates and decrypts one SARARCH2 frame.
 *
 * @param {object} input Frame input.
 * @param {Buffer | Uint8Array} input.missionArchiveKey Authenticated MAK.
 * @param {Buffer | Uint8Array} input.noncePrefix Per-archive nonce prefix.
 * @param {bigint | number} input.frameIndex Monotonic frame index.
 * @param {boolean} input.final Exact final-frame flag.
 * @param {Buffer | Uint8Array} input.ciphertext Frame ciphertext.
 * @param {Buffer | Uint8Array} input.authTag Sixteen-byte GCM tag.
 * @param {Buffer | Uint8Array} input.headerDigest Canonical header SHA-256.
 * @param {number} [input.plaintextLength] Declared framing length; defaults to ciphertext length.
 * @returns {Buffer} Authenticated plaintext.
 * @throws {ArchiveAuthenticationError} When any authenticated input is wrong.
 */
function decryptFrame({
  missionArchiveKey,
  noncePrefix,
  frameIndex,
  final,
  ciphertext,
  authTag,
  headerDigest,
  plaintextLength,
}) {
  const mak = copyBytes(
    missionArchiveKey,
    'The mission archive key',
    MISSION_ARCHIVE_KEY_BYTES,
  )
  const ciphertextBytes = copyBytes(ciphertext, 'The archive frame ciphertext')
  const tag = copyBytes(authTag, 'The archive frame authentication tag', AUTH_TAG_BYTES)
  const finalFlag = normalizeFinalFlag(final)
  const declaredPlaintextLength = normalizePlaintextLength(
    plaintextLength === undefined ? ciphertextBytes.length : plaintextLength,
  )
  const nonce = deriveFrameNonce(noncePrefix, frameIndex)
  const aad = createFrameAad({
    headerDigest,
    frameIndex,
    final: finalFlag,
    plaintextLength: declaredPlaintextLength,
  })
  try {
    try {
      const decipher = createDecipheriv('aes-256-gcm', mak, nonce, {
        authTagLength: AUTH_TAG_BYTES,
      })
      decipher.setAAD(aad)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertextBytes), decipher.final()])
    } catch {
      throw new ArchiveAuthenticationError()
    }
  } finally {
    zeroBuffer(mak)
    zeroBuffer(ciphertextBytes)
    zeroBuffer(tag)
    zeroBuffer(nonce)
    zeroBuffer(aad)
  }
}

/**
 * Overwrites a mutable Buffer or Uint8Array in place where Node permits.
 * JavaScript strings are intentionally unsupported because they cannot be erased reliably.
 *
 * @param {Buffer | Uint8Array} value Mutable byte storage.
 * @returns {void}
 */
function zeroBuffer(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError('Secret cleanup requires a mutable buffer; JavaScript strings cannot be erased.')
  }
  value.fill(0)
}

module.exports = {
  SARARCH2_SCRYPT_PROFILE,
  ArchiveWrongKeyError,
  ArchiveAuthenticationError,
  generateMissionArchiveKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  validateScryptParameters,
  deriveSlotKey,
  wrapMissionArchiveKey,
  unwrapMissionArchiveKey,
  deriveFrameNonce,
  createFrameAad,
  encryptFrame,
  decryptFrame,
  zeroBuffer,
}
