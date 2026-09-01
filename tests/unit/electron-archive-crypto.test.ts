import { createRequire } from 'node:module'

import { beforeAll, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

interface ScryptProfile {
  readonly version: number
  readonly N: number
  readonly r: number
  readonly p: number
  readonly keyLength: number
  readonly saltBytes: number
  readonly maxmem: number
}

type SlotType = 'passphrase' | 'recovery' | 'machine'

interface MissionArchiveKeySlot {
  readonly slotType: SlotType
  readonly slotId: string
  readonly slotVersion: 1
  readonly kdf: 'scrypt'
  readonly profile: ScryptProfile
  readonly salt: string
  readonly nonce: string
  readonly ciphertext: string
  readonly authTag: string
}

interface FrameEncryptionResult {
  readonly ciphertext: Buffer
  readonly authTag: Buffer
}

interface ArchiveCryptoModule {
  readonly SARARCH2_SCRYPT_PROFILE: ScryptProfile
  readonly ArchiveWrongKeyError: new (message?: string) => Error
  readonly ArchiveAuthenticationError: new (message?: string) => Error
  readonly generateMissionArchiveKey: (randomBytes?: (size: number) => Buffer) => Buffer
  readonly generateRecoveryCode: (randomBytes?: (size: number) => Buffer) => string
  readonly normalizeRecoveryCode: (value: string) => string
  readonly validateScryptParameters: (profile: unknown) => ScryptProfile
  readonly deriveSlotKey: (input: {
    readonly secret: string | Buffer | Uint8Array
    readonly salt: Buffer | Uint8Array
    readonly profile?: ScryptProfile
  }) => Promise<Buffer>
  readonly wrapMissionArchiveKey: (input: {
    readonly missionArchiveKey: Buffer | Uint8Array
    readonly slotType: SlotType
    readonly slotId: string
    readonly secret: string | Buffer | Uint8Array
    readonly headerDigest: Buffer | Uint8Array
    readonly randomBytes?: (size: number) => Buffer
  }) => Promise<MissionArchiveKeySlot>
  readonly unwrapMissionArchiveKey: (input: {
    readonly slot: MissionArchiveKeySlot
    readonly secret: string | Buffer | Uint8Array
    readonly headerDigest: Buffer | Uint8Array
  }) => Promise<Buffer>
  readonly deriveFrameNonce: (
    noncePrefix: Buffer | Uint8Array,
    frameIndex: bigint | number,
  ) => Buffer
  readonly createFrameAad: (input: {
    readonly headerDigest: Buffer | Uint8Array
    readonly frameIndex: bigint | number
    readonly final: boolean
    readonly plaintextLength: number
  }) => Buffer
  readonly encryptFrame: (input: {
    readonly missionArchiveKey: Buffer | Uint8Array
    readonly noncePrefix: Buffer | Uint8Array
    readonly frameIndex: bigint | number
    readonly final: boolean
    readonly plaintext: Buffer | Uint8Array
    readonly headerDigest: Buffer | Uint8Array
  }) => FrameEncryptionResult
  readonly decryptFrame: (input: {
    readonly missionArchiveKey: Buffer | Uint8Array
    readonly noncePrefix: Buffer | Uint8Array
    readonly frameIndex: bigint | number
    readonly final: boolean
    readonly ciphertext: Buffer | Uint8Array
    readonly authTag: Buffer | Uint8Array
    readonly headerDigest: Buffer | Uint8Array
    readonly plaintextLength?: number
  }) => Buffer
  readonly zeroBuffer: (value: Buffer | Uint8Array) => void
}

const {
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
} = require('../../electron/archive-crypto.cjs') as ArchiveCryptoModule

const FIXED_MAK = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
const FIXED_SALT = Buffer.from(Array.from({ length: 32 }, (_, index) => 0x80 + index))
const FIXED_WRAP_NONCE = Buffer.from('101112131415161718191a1b', 'hex')
const FIXED_HEADER_DIGEST = Buffer.alloc(32, 0xa5)
const FIXED_NONCE_PREFIX = Buffer.from([0x01, 0x02, 0x03, 0x04])

/** Returns deterministic bytes for slot-wrap tests without weakening production randomness. */
function fixedSlotRandomBytes(size: number): Buffer {
  if (size === 32) {
    return Buffer.from(FIXED_SALT)
  }
  if (size === 12) {
    return Buffer.from(FIXED_WRAP_NONCE)
  }
  throw new Error(`Unexpected deterministic random-byte request: ${size}`)
}

/** Flips one bit without mutating the source buffer. */
function flipFirstBit(value: Buffer): Buffer {
  const mutated = Buffer.from(value)
  mutated[0] = mutated[0]! ^ 0x01
  return mutated
}

describe('SARARCH2 strict scrypt profile', () => {
  it('accepts only the frozen, versioned v1 resource profile', () => {
    expect(SARARCH2_SCRYPT_PROFILE).toEqual({
      version: 1,
      N: 131_072,
      r: 8,
      p: 1,
      keyLength: 32,
      saltBytes: 32,
      maxmem: 268_435_456,
    })
    expect(Object.isFrozen(SARARCH2_SCRYPT_PROFILE)).toBe(true)
    expect(validateScryptParameters({ ...SARARCH2_SCRYPT_PROFILE })).toEqual(
      SARARCH2_SCRYPT_PROFILE,
    )
  })

  it.each([
    ['unknown version', { ...SARARCH2_SCRYPT_PROFILE, version: 2 }],
    ['weaker N', { ...SARARCH2_SCRYPT_PROFILE, N: 65_536 }],
    ['unknown stronger N', { ...SARARCH2_SCRYPT_PROFILE, N: 262_144 }],
    ['weaker r', { ...SARARCH2_SCRYPT_PROFILE, r: 4 }],
    ['unknown p', { ...SARARCH2_SCRYPT_PROFILE, p: 2 }],
    ['short key', { ...SARARCH2_SCRYPT_PROFILE, keyLength: 16 }],
    ['short salt', { ...SARARCH2_SCRYPT_PROFILE, saltBytes: 16 }],
    ['lower maxmem', { ...SARARCH2_SCRYPT_PROFILE, maxmem: 134_217_728 }],
    ['above-ceiling maxmem', { ...SARARCH2_SCRYPT_PROFILE, maxmem: 536_870_912 }],
    ['undeclared field', { ...SARARCH2_SCRYPT_PROFILE, workFactor: 'auto' }],
  ])('rejects %s instead of silently changing it', (_label, profile) => {
    expect(() => validateScryptParameters(profile)).toThrow(/scrypt profile/i)
  })

  it('matches the locked v1 deterministic derivation vector', async () => {
    const key = await deriveSlotKey({
      secret: 'SARARCH2 deterministic passphrase',
      salt: Buffer.from(Array.from({ length: 32 }, (_, index) => index)),
    })

    expect(key.toString('hex')).toBe(
      'bbb875e188b734408e568dfe0408d76bce05a4d7905920e53072c9dfcdb46767',
    )
    zeroBuffer(key)
  })
})

describe('SARARCH2 mission archive keys and recovery codes', () => {
  it('generates exactly one 256-bit mission archive key from the supplied CSPRNG', () => {
    const requestedSizes: number[] = []
    const key = generateMissionArchiveKey((size) => {
      requestedSizes.push(size)
      return Buffer.alloc(size, 0x5a)
    })

    expect(requestedSizes).toEqual([32])
    expect(key).toEqual(Buffer.alloc(32, 0x5a))
  })

  it('rejects a random source that returns the wrong number of bytes', () => {
    expect(() => generateMissionArchiveKey(() => Buffer.alloc(31))).toThrow(/32 bytes/i)
  })

  it('encodes all 200 random bits as eight Crockford Base32 groups', () => {
    const requestedSizes: number[] = []
    const zeroCode = generateRecoveryCode((size) => {
      requestedSizes.push(size)
      return Buffer.alloc(size)
    })
    const oneCode = generateRecoveryCode((size) => Buffer.alloc(size, 0xff))

    expect(requestedSizes).toEqual([25])
    expect(zeroCode).toBe('00000-00000-00000-00000-00000-00000-00000-00000')
    expect(oneCode).toBe('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')
  })

  it('normalizes case and separators without translating ambiguous characters', () => {
    expect(
      normalizeRecoveryCode('01234 56789 abcde fghjk mnpqr stvwx yz012 34567'),
    ).toBe('01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567')

    for (const ambiguous of ['I', 'L', 'O', 'U']) {
      expect(() =>
        normalizeRecoveryCode(`${ambiguous}123456789ABCDEFGHJKMNPQRSTVWXYZ01234567`),
      ).toThrow(/ambiguous/i)
    }
    expect(() => normalizeRecoveryCode('0'.repeat(39))).toThrow(/40 characters/i)
    expect(() => normalizeRecoveryCode(`${'0'.repeat(20)}_${'0'.repeat(19)}`)).toThrow(
      /invalid/i,
    )
  })
})

describe('SARARCH2 key slots', () => {
  let passphraseSlot: MissionArchiveKeySlot

  beforeAll(async () => {
    passphraseSlot = await wrapMissionArchiveKey({
      missionArchiveKey: FIXED_MAK,
      slotType: 'passphrase',
      slotId: 'operator-passphrase-v1',
      secret: 'correct horse battery staple',
      headerDigest: FIXED_HEADER_DIGEST,
      randomBytes: fixedSlotRandomBytes,
    })
  })

  it('serializes an explicit authenticated profile and round-trips the MAK', async () => {
    expect(passphraseSlot).toEqual({
      slotType: 'passphrase',
      slotId: 'operator-passphrase-v1',
      slotVersion: 1,
      kdf: 'scrypt',
      profile: SARARCH2_SCRYPT_PROFILE,
      salt: FIXED_SALT.toString('base64'),
      nonce: FIXED_WRAP_NONCE.toString('base64'),
      ciphertext: expect.any(String),
      authTag: expect.any(String),
    })
    expect(Buffer.from(passphraseSlot.ciphertext, 'base64')).toHaveLength(32)
    expect(Buffer.from(passphraseSlot.authTag, 'base64')).toHaveLength(16)
    expect(Buffer.from(passphraseSlot.ciphertext, 'base64')).not.toEqual(FIXED_MAK)

    const unwrapped = await unwrapMissionArchiveKey({
      slot: passphraseSlot,
      secret: 'correct horse battery staple',
      headerDigest: FIXED_HEADER_DIGEST,
    })
    expect(unwrapped).toEqual(FIXED_MAK)
    zeroBuffer(unwrapped)
  })

  it('fails with ArchiveWrongKeyError before payload access for a wrong secret', async () => {
    await expect(
      unwrapMissionArchiveKey({
        slot: passphraseSlot,
        secret: 'wrong but well-formed passphrase',
        headerDigest: FIXED_HEADER_DIGEST,
      }),
    ).rejects.toBeInstanceOf(ArchiveWrongKeyError)
  })

  it('authenticates the header digest and slot identity', async () => {
    await expect(
      unwrapMissionArchiveKey({
        slot: passphraseSlot,
        secret: 'correct horse battery staple',
        headerDigest: flipFirstBit(FIXED_HEADER_DIGEST),
      }),
    ).rejects.toBeInstanceOf(ArchiveWrongKeyError)

    await expect(
      unwrapMissionArchiveKey({
        slot: { ...passphraseSlot, slotId: 'substituted-slot' },
        secret: 'correct horse battery staple',
        headerDigest: FIXED_HEADER_DIGEST,
      }),
    ).rejects.toBeInstanceOf(ArchiveWrongKeyError)
  })

  it('rejects a tampered or unknown KDF profile before attempting unwrap', async () => {
    await expect(
      unwrapMissionArchiveKey({
        slot: {
          ...passphraseSlot,
          profile: { ...passphraseSlot.profile, N: 65_536 },
        },
        secret: 'correct horse battery staple',
        headerDigest: FIXED_HEADER_DIGEST,
      }),
    ).rejects.toThrow(/scrypt profile/i)
  })

  it('rejects wrapped-key ciphertext mutation as a wrong-key failure', async () => {
    const ciphertext = Buffer.from(passphraseSlot.ciphertext, 'base64')
    await expect(
      unwrapMissionArchiveKey({
        slot: {
          ...passphraseSlot,
          ciphertext: flipFirstBit(ciphertext).toString('base64'),
        },
        secret: 'correct horse battery staple',
        headerDigest: FIXED_HEADER_DIGEST,
      }),
    ).rejects.toBeInstanceOf(ArchiveWrongKeyError)
  })

  it('uses the canonical per-archive recovery code as an independent slot secret', async () => {
    const recoveryCode = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
    const recoverySlot = await wrapMissionArchiveKey({
      missionArchiveKey: FIXED_MAK,
      slotType: 'recovery',
      slotId: 'recovery-v1',
      secret: recoveryCode,
      headerDigest: FIXED_HEADER_DIGEST,
      randomBytes: fixedSlotRandomBytes,
    })
    const unwrapped = await unwrapMissionArchiveKey({
      slot: recoverySlot,
      secret: recoveryCode.toLowerCase().replaceAll('-', ' '),
      headerDigest: FIXED_HEADER_DIGEST,
    })

    expect(unwrapped).toEqual(FIXED_MAK)
    zeroBuffer(unwrapped)
  })
})

describe('SARARCH2 frame nonces and authenticated encryption', () => {
  it('derives the locked 96-bit nonce from a prefix and unsigned 64-bit index', () => {
    expect(deriveFrameNonce(FIXED_NONCE_PREFIX, 42n).toString('hex')).toBe(
      '01020304000000000000002a',
    )
    expect(deriveFrameNonce(FIXED_NONCE_PREFIX, 0n)).not.toEqual(
      deriveFrameNonce(FIXED_NONCE_PREFIX, 1n),
    )
    expect(deriveFrameNonce(FIXED_NONCE_PREFIX, 0xffff_ffff_ffff_ffffn).subarray(4)).toEqual(
      Buffer.alloc(8, 0xff),
    )
  })

  it.each([-1, -1n, 1.5, Number.MAX_SAFE_INTEGER + 1, 0x1_0000_0000_0000_0000n])(
    'rejects unsafe, negative or overflowing frame index %s',
    (frameIndex) => {
      expect(() => deriveFrameNonce(FIXED_NONCE_PREFIX, frameIndex)).toThrow(/frame index/i)
    },
  )

  it('constructs the exact header/index/final/length AAD vector', () => {
    expect(
      createFrameAad({
        headerDigest: FIXED_HEADER_DIGEST,
        frameIndex: 42n,
        final: false,
        plaintextLength: 16,
      }).toString('hex'),
    ).toBe(
      `${'a5'.repeat(32)}000000000000002a0000000010`,
    )
  })

  it('binds every AAD field and validates its bounds', () => {
    const baseline = createFrameAad({
      headerDigest: FIXED_HEADER_DIGEST,
      frameIndex: 1n,
      final: false,
      plaintextLength: 7,
    })
    expect(
      createFrameAad({
        headerDigest: flipFirstBit(FIXED_HEADER_DIGEST),
        frameIndex: 1n,
        final: false,
        plaintextLength: 7,
      }),
    ).not.toEqual(baseline)
    expect(
      createFrameAad({
        headerDigest: FIXED_HEADER_DIGEST,
        frameIndex: 2n,
        final: false,
        plaintextLength: 7,
      }),
    ).not.toEqual(baseline)
    expect(
      createFrameAad({
        headerDigest: FIXED_HEADER_DIGEST,
        frameIndex: 1n,
        final: true,
        plaintextLength: 7,
      }),
    ).not.toEqual(baseline)
    expect(
      createFrameAad({
        headerDigest: FIXED_HEADER_DIGEST,
        frameIndex: 1n,
        final: false,
        plaintextLength: 8,
      }),
    ).not.toEqual(baseline)
    expect(() =>
      createFrameAad({
        headerDigest: FIXED_HEADER_DIGEST,
        frameIndex: 0n,
        final: false,
        plaintextLength: 0x1_0000_0000,
      }),
    ).toThrow(/plaintext length/i)
  })

  it('matches a deterministic AES-256-GCM frame vector and decrypts it', () => {
    const plaintext = Buffer.from('mission evidence', 'utf8')
    const encrypted = encryptFrame({
      missionArchiveKey: FIXED_MAK,
      noncePrefix: FIXED_NONCE_PREFIX,
      frameIndex: 42n,
      final: false,
      plaintext,
      headerDigest: FIXED_HEADER_DIGEST,
    })

    expect(encrypted.ciphertext.toString('hex')).toBe(
      '2c992c28b9e45bfa1b36bb79f290a337',
    )
    expect(encrypted.authTag.toString('hex')).toBe('003156bbd75245421c21ff32a4f6a249')
    expect(
      decryptFrame({
        missionArchiveKey: FIXED_MAK,
        noncePrefix: FIXED_NONCE_PREFIX,
        frameIndex: 42n,
        final: false,
        ciphertext: encrypted.ciphertext,
        authTag: encrypted.authTag,
        headerDigest: FIXED_HEADER_DIGEST,
      }),
    ).toEqual(plaintext)
  })

  it('round-trips the authenticated zero-length final frame', () => {
    const encrypted = encryptFrame({
      missionArchiveKey: FIXED_MAK,
      noncePrefix: FIXED_NONCE_PREFIX,
      frameIndex: 9n,
      final: true,
      plaintext: Buffer.alloc(0),
      headerDigest: FIXED_HEADER_DIGEST,
    })
    expect(
      decryptFrame({
        missionArchiveKey: FIXED_MAK,
        noncePrefix: FIXED_NONCE_PREFIX,
        frameIndex: 9n,
        final: true,
        ciphertext: encrypted.ciphertext,
        authTag: encrypted.authTag,
        headerDigest: FIXED_HEADER_DIGEST,
      }),
    ).toEqual(Buffer.alloc(0))
  })

  it('fails closed on a wrong key, ciphertext mutation, tag mutation or AAD mutation', () => {
    const encrypted = encryptFrame({
      missionArchiveKey: FIXED_MAK,
      noncePrefix: FIXED_NONCE_PREFIX,
      frameIndex: 3n,
      final: false,
      plaintext: Buffer.from('immutable evidence', 'utf8'),
      headerDigest: FIXED_HEADER_DIGEST,
    })
    const baseline = {
      missionArchiveKey: FIXED_MAK,
      noncePrefix: FIXED_NONCE_PREFIX,
      frameIndex: 3n,
      final: false,
      ciphertext: encrypted.ciphertext,
      authTag: encrypted.authTag,
      headerDigest: FIXED_HEADER_DIGEST,
    } as const

    expect(() =>
      decryptFrame({ ...baseline, missionArchiveKey: flipFirstBit(FIXED_MAK) }),
    ).toThrow(ArchiveAuthenticationError)
    expect(() =>
      decryptFrame({ ...baseline, ciphertext: flipFirstBit(encrypted.ciphertext) }),
    ).toThrow(ArchiveAuthenticationError)
    expect(() =>
      decryptFrame({ ...baseline, authTag: flipFirstBit(encrypted.authTag) }),
    ).toThrow(ArchiveAuthenticationError)
    expect(() => decryptFrame({ ...baseline, final: true })).toThrow(
      ArchiveAuthenticationError,
    )
    expect(() => decryptFrame({ ...baseline, frameIndex: 4n })).toThrow(
      ArchiveAuthenticationError,
    )
    expect(() =>
      decryptFrame({ ...baseline, headerDigest: flipFirstBit(FIXED_HEADER_DIGEST) }),
    ).toThrow(ArchiveAuthenticationError)
    expect(() => decryptFrame({ ...baseline, plaintextLength: 19 })).toThrow(
      ArchiveAuthenticationError,
    )
  })
})

describe('mutable secret-buffer cleanup', () => {
  it('overwrites Buffer and Uint8Array copies in place', () => {
    const buffer = Buffer.from('derived secret bytes', 'utf8')
    const byteArray = new Uint8Array([1, 2, 3, 4])

    zeroBuffer(buffer)
    zeroBuffer(byteArray)

    expect(buffer).toEqual(Buffer.alloc(buffer.length))
    expect(byteArray).toEqual(new Uint8Array(4))
  })

  it('does not imply that immutable JavaScript strings can be erased', () => {
    expect(() => zeroBuffer('managed-runtime-secret' as unknown as Buffer)).toThrow(
      /mutable buffer/i,
    )
  })

  it('cleans copied key material when validation fails after the copy', async () => {
    const fillSpy = vi.spyOn(Buffer.prototype, 'fill')
    try {
      await expect(
        wrapMissionArchiveKey({
          missionArchiveKey: FIXED_MAK,
          slotType: 'invalid' as SlotType,
          slotId: 'operator-passphrase-v1',
          secret: 'correct horse battery staple',
          headerDigest: FIXED_HEADER_DIGEST,
          randomBytes: fixedSlotRandomBytes,
        }),
      ).rejects.toThrow(/slot type/i)
      expect(fillSpy).toHaveBeenCalled()

      fillSpy.mockClear()
      expect(() =>
        encryptFrame({
          missionArchiveKey: FIXED_MAK,
          noncePrefix: FIXED_NONCE_PREFIX,
          frameIndex: 0n,
          final: 'invalid' as unknown as boolean,
          plaintext: Buffer.from('evidence'),
          headerDigest: FIXED_HEADER_DIGEST,
        }),
      ).toThrow(/final flag/i)
      expect(fillSpy).toHaveBeenCalled()

      fillSpy.mockClear()
      expect(() =>
        decryptFrame({
          missionArchiveKey: FIXED_MAK,
          noncePrefix: FIXED_NONCE_PREFIX,
          frameIndex: 0n,
          final: 'invalid' as unknown as boolean,
          ciphertext: Buffer.alloc(0),
          authTag: Buffer.alloc(16),
          headerDigest: FIXED_HEADER_DIGEST,
        }),
      ).toThrow(/final flag/i)
      expect(fillSpy).toHaveBeenCalled()
    } finally {
      fillSpy.mockRestore()
    }
  })
})
