import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Readable, Writable } from 'node:stream'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface ArchiveHeader {
  readonly container_version: number
  readonly cipher: string
  readonly framing: string
  readonly frame_size: number
  readonly nonce_prefix: string
  readonly mission_id: string
  readonly request_event_rowid: number
  readonly request_event_id: string
  readonly creation_operation_id: string
  readonly protected_finalization_epoch: number | null
  readonly created_at: string
  readonly schema_version: number
  readonly inventory_version: number
  readonly previous_archive_sha256: string | null
  readonly key_slot_count: number
}

interface ArchiveEntryInput {
  readonly name: string
  readonly size: number | bigint
  readonly source: Buffer | Readable | AsyncIterable<Buffer>
}

interface ArchiveContainerModule {
  readonly SARARCH2_MAGIC: Buffer
  readonly SARARCH2_TRAILER_MAGIC: Buffer
  readonly SARARCH2_CONTAINER_VERSION: number
  readonly DEFAULT_ARCHIVE_FRAME_SIZE: number
  readonly ArchiveFormatError: new (...args: readonly unknown[]) => Error
  readonly ArchiveTruncationError: new (...args: readonly unknown[]) => Error
  readonly canonicalJson: (value: unknown) => string
  readonly validateArchiveHeader: (header: unknown) => ArchiveHeader
  readonly readArchivePreamble: (readable: AsyncIterable<Buffer> | Readable) => Promise<{
    readonly header: ArchiveHeader
    readonly keySlots: readonly Readonly<Record<string, unknown>>[]
    readonly headerDigest: Buffer
    readonly continuation: AsyncIterable<Buffer>
  }>
  readonly writeArchiveContainer: (options: {
    readonly writable: Writable
    readonly header: ArchiveHeader
    readonly keySlots: readonly Readonly<Record<string, unknown>>[]
    readonly missionArchiveKey: Buffer
    readonly entries: readonly ArchiveEntryInput[] | AsyncIterable<ArchiveEntryInput>
    readonly frameSize?: number
    readonly onProgress?: (progress: {
      readonly processedBytes: number
      readonly frameCount: number
    }) => void
  }) => Promise<{
    readonly ciphertextSha256: string
    readonly sizeBytes: number
    readonly frameCount: bigint
    readonly headerDigest: string
  }>
  readonly readArchiveContainer: (options: {
    readonly readable: AsyncIterable<Buffer> | Readable
    readonly missionArchiveKey: Buffer
    readonly onEntryStart?: (entry: {
      readonly index: number
      readonly name: string
      readonly size: bigint
    }) => void | Promise<void>
    readonly onEntryChunk?: (
      entry: { readonly index: number; readonly name: string; readonly size: bigint },
      chunk: Buffer,
    ) => void | Promise<void>
    readonly onEntryEnd?: (entry: {
      readonly index: number
      readonly name: string
      readonly size: bigint
    }) => void | Promise<void>
  }) => Promise<{
    readonly header: ArchiveHeader
    readonly keySlots: readonly Readonly<Record<string, unknown>>[]
    readonly ciphertextSha256: string
    readonly sizeBytes: number
    readonly frameCount: bigint
    readonly headerDigest: string
    readonly entryCount: number
  }>
}

interface ArchiveCryptoModule {
  readonly encryptFrame: (options: {
    readonly missionArchiveKey: Buffer
    readonly noncePrefix: Buffer
    readonly frameIndex: bigint
    readonly final: boolean
    readonly plaintext: Buffer
    readonly headerDigest: Buffer
  }) => { readonly ciphertext: Buffer; readonly authTag: Buffer }
}

const container = require('../../electron/archive-container.cjs') as ArchiveContainerModule
const { encryptFrame } = require('../../electron/archive-crypto.cjs') as ArchiveCryptoModule

const TEST_KEY = Buffer.alloc(32, 0x5a)
const TEST_SCRYPT_PROFILE = {
  version: 1,
  N: 131_072,
  r: 8,
  p: 1,
  keyLength: 32,
  saltBytes: 32,
  maxmem: 268_435_456,
} as const
const TEST_SLOTS = [
  {
    slotId: 'passphrase-main',
    slotType: 'passphrase',
    slotVersion: 1,
    kdf: 'scrypt',
    profile: TEST_SCRYPT_PROFILE,
    salt: Buffer.alloc(32, 0x11).toString('base64'),
    nonce: Buffer.alloc(12, 0x12).toString('base64'),
    ciphertext: Buffer.alloc(32, 0x13).toString('base64'),
    authTag: Buffer.alloc(16, 0x14).toString('base64'),
  },
  {
    slotId: 'recovery-main',
    slotType: 'recovery',
    slotVersion: 1,
    kdf: 'scrypt',
    profile: TEST_SCRYPT_PROFILE,
    salt: Buffer.alloc(32, 0x21).toString('base64'),
    nonce: Buffer.alloc(12, 0x22).toString('base64'),
    ciphertext: Buffer.alloc(32, 0x23).toString('base64'),
    authTag: Buffer.alloc(16, 0x24).toString('base64'),
  },
] as const
const FRAME_RECORD_HEADER_BYTES = 13
const GCM_TAG_BYTES = 16
const TRAILER_BYTES = 17
const ENTRY_MAGIC = Buffer.from('SARENTRY', 'ascii')

/** Creates a valid, deliberately small test header. */
function makeHeader(overrides: Partial<ArchiveHeader> = {}): ArchiveHeader {
  return {
    container_version: 2,
    cipher: 'aes-256-gcm',
    framing: 'sararch2-framed-v1',
    frame_size: 31,
    nonce_prefix: Buffer.from([0x10, 0x20, 0x30, 0x40]).toString('base64'),
    mission_id: 'mission-alpha',
    request_event_rowid: 41,
    request_event_id: '33333333-3333-4333-8333-333333333333',
    creation_operation_id: '11111111-1111-4111-8111-111111111111',
    protected_finalization_epoch: null,
    created_at: '2026-08-29T12:34:56.000Z',
    schema_version: 13,
    inventory_version: 1,
    previous_archive_sha256: null,
    key_slot_count: TEST_SLOTS.length,
    ...overrides,
  }
}

/** Collects a streamed container while exercising Writable backpressure. */
class SlowCollector extends Writable {
  readonly chunks: Buffer[] = []

  constructor() {
    super({ highWaterMark: 1 })
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk))
    setImmediate(callback)
  }

  /** Returns the test-only assembled byte sequence. */
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

/** Writes an archive to a bounded test collector. */
async function writeArchive(
  entries: readonly ArchiveEntryInput[] = [
    { name: 'manifest.json', size: 2, source: Buffer.from('{}') },
    {
      name: 'mission.json',
      size: Buffer.byteLength('{"id":"mission"}', 'utf8'),
      source: Buffer.from('{"id":"mission"}'),
    },
  ],
  header: ArchiveHeader = makeHeader(),
): Promise<{
  readonly bytes: Buffer
  readonly result: Awaited<ReturnType<ArchiveContainerModule['writeArchiveContainer']>>
}> {
  const writable = new SlowCollector()
  const result = await container.writeArchiveContainer({
    writable,
    header,
    keySlots: TEST_SLOTS,
    missionArchiveKey: TEST_KEY,
    entries,
  })
  return { bytes: writable.toBuffer(), result }
}

/** Splits bytes into an awkward repeating fragment pattern. */
async function* fragment(bytes: Buffer): AsyncIterable<Buffer> {
  const widths = [1, 2, 7, 3, 19, 5]
  let offset = 0
  let widthIndex = 0
  while (offset < bytes.length) {
    const width = widths[widthIndex % widths.length]!
    yield bytes.subarray(offset, Math.min(offset + width, bytes.length))
    offset += width
    widthIndex += 1
  }
}

interface FrameLocation {
  readonly start: number
  readonly end: number
  readonly index: bigint
  readonly final: boolean
  readonly plaintextLength: number
}

/** Locates frame records in a valid test container without decrypting them. */
function locateFrames(bytes: Buffer): {
  readonly payloadStart: number
  readonly frames: readonly FrameLocation[]
  readonly trailerStart: number
} {
  let cursor = container.SARARCH2_MAGIC.length
  const headerLength = bytes.readUInt32BE(cursor)
  cursor += 4 + headerLength
  const slotsLength = bytes.readUInt32BE(cursor)
  cursor += 4 + slotsLength
  const payloadStart = cursor
  const frames: FrameLocation[] = []

  while (cursor < bytes.length - TRAILER_BYTES) {
    const plaintextLength = bytes.readUInt32BE(cursor + 9)
    const final = bytes[cursor + 8] === 1
    const end = cursor + FRAME_RECORD_HEADER_BYTES + plaintextLength + GCM_TAG_BYTES
    frames.push({
      start: cursor,
      end,
      index: bytes.readBigUInt64BE(cursor),
      final,
      plaintextLength,
    })
    cursor = end
    if (final) {
      break
    }
  }
  return { payloadStart, frames, trailerStart: cursor }
}

/** Replaces the canonical plaintext header while preserving the rest of the archive. */
function replaceSameLengthHeader(bytes: Buffer, header: ArchiveHeader): Buffer {
  const changed = Buffer.from(bytes)
  const offset = container.SARARCH2_MAGIC.length
  const originalLength = changed.readUInt32BE(offset)
  const encoded = Buffer.from(container.canonicalJson(header), 'utf8')
  expect(encoded.length).toBe(originalLength)
  encoded.copy(changed, offset + 4)
  return changed
}

/** Encodes the fixed preamble for fail-closed negotiation tests. */
function encodePreamble(
  header: ArchiveHeader,
  slots: readonly Readonly<Record<string, unknown>>[] = TEST_SLOTS,
): Buffer {
  const headerBytes = Buffer.from(container.canonicalJson(header), 'utf8')
  const slotBytes = Buffer.from(container.canonicalJson(slots), 'utf8')
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32BE(headerBytes.length)
  const slotsLength = Buffer.alloc(4)
  slotsLength.writeUInt32BE(slotBytes.length)
  return Buffer.concat([
    container.SARARCH2_MAGIC,
    headerLength,
    headerBytes,
    slotsLength,
    slotBytes,
  ])
}

/** Encodes a uint64 big-endian value without a lossy Number conversion. */
function uint64(value: bigint): Buffer {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64BE(value)
  return bytes
}

describe('SARARCH2 canonical codecs', () => {
  it('serializes nested JSON with recursively sorted keys and no incidental whitespace', () => {
    expect(
      container.canonicalJson({ z: 1, a: { y: true, b: null }, list: [{ q: 2, a: 1 }] }),
    ).toBe('{"a":{"b":null,"y":true},"list":[{"a":1,"q":2}],"z":1}')
  })

  it.each([
    { invalid: Number.NaN, label: 'non-finite number' },
    { invalid: { missing: undefined }, label: 'undefined property' },
    { invalid: 1n, label: 'BigInt JSON value' },
    { invalid: new Date('2026-08-29T00:00:00.000Z'), label: 'non-plain object' },
  ])('rejects a $label rather than changing its meaning', ({ invalid }) => {
    expect(() => container.canonicalJson(invalid)).toThrow(container.ArchiveFormatError)
  })

  it('exposes the locked magic, version and an 8 MiB production frame default', () => {
    expect(container.SARARCH2_MAGIC).toEqual(Buffer.from('SARARCH2', 'ascii'))
    expect(container.SARARCH2_TRAILER_MAGIC).toEqual(Buffer.from('SARTRLR2', 'ascii'))
    expect(container.SARARCH2_CONTAINER_VERSION).toBe(2)
    expect(container.DEFAULT_ARCHIVE_FRAME_SIZE).toBe(8 * 1024 * 1024)
  })
})

describe('SARARCH2 streamed writer and reader', () => {
  it('round-trips fragmented sources and input while preserving entry order and backpressure', async () => {
    const manifest = Buffer.from('{"entries":[]}', 'utf8')
    const mission = Buffer.from('{"id":"mission-alpha"}', 'utf8')
    const sqlite = Buffer.from('sqlite-page-data/'.repeat(23), 'utf8')
    const { bytes, result: written } = await writeArchive([
      { name: 'manifest.json', size: manifest.length, source: fragment(manifest) },
      { name: 'mission.json', size: mission.length, source: Readable.from(fragment(mission)) },
      { name: 'mission-store.sqlite', size: BigInt(sqlite.length), source: fragment(sqlite) },
      { name: 'attachments/empty.bin', size: 0, source: Buffer.alloc(0) },
    ])

    const observed = new Map<string, Buffer[]>()
    const lifecycle: string[] = []
    const read = await container.readArchiveContainer({
      readable: fragment(bytes),
      missionArchiveKey: TEST_KEY,
      onEntryStart: async (entry) => {
        await Promise.resolve()
        lifecycle.push(`start:${entry.index}:${entry.name}:${entry.size}`)
        observed.set(entry.name, [])
      },
      onEntryChunk: async (entry, chunk) => {
        await Promise.resolve()
        observed.get(entry.name)!.push(Buffer.from(chunk))
      },
      onEntryEnd: (entry) => lifecycle.push(`end:${entry.index}:${entry.name}`),
    })

    expect(Buffer.concat(observed.get('manifest.json')!)).toEqual(manifest)
    expect(Buffer.concat(observed.get('mission.json')!)).toEqual(mission)
    expect(Buffer.concat(observed.get('mission-store.sqlite')!)).toEqual(sqlite)
    expect(Buffer.concat(observed.get('attachments/empty.bin')!)).toEqual(Buffer.alloc(0))
    expect(lifecycle).toEqual([
      `start:0:manifest.json:${manifest.length}`,
      'end:0:manifest.json',
      `start:1:mission.json:${mission.length}`,
      'end:1:mission.json',
      `start:2:mission-store.sqlite:${sqlite.length}`,
      'end:2:mission-store.sqlite',
      'start:3:attachments/empty.bin:0',
      'end:3:attachments/empty.bin',
    ])
    expect(written.ciphertextSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(read.ciphertextSha256).toBe(written.ciphertextSha256)
    expect(read.sizeBytes).toBe(bytes.length)
    expect(written.sizeBytes).toBe(bytes.length)
    expect(read.frameCount).toBe(written.frameCount)
    expect(read.entryCount).toBe(4)
    expect(read.headerDigest).toBe(written.headerDigest)
  })

  it('reports monotonic encrypted-frame work without changing output bytes or digests', async () => {
    const entries = [
      { name: 'manifest.json', size: 120, source: Buffer.alloc(120, 0x41) },
      { name: 'mission.json', size: 120, source: Buffer.alloc(120, 0x42) },
    ] as const
    const baseline = await writeArchive(entries)
    const writable = new SlowCollector()
    const progress: Array<{ readonly processedBytes: number; readonly frameCount: number }> = []
    const observed = await container.writeArchiveContainer({
      writable,
      header: makeHeader(),
      keySlots: TEST_SLOTS,
      missionArchiveKey: TEST_KEY,
      entries,
      onProgress: (value) => progress.push(value),
    })

    expect(writable.toBuffer()).toEqual(baseline.bytes)
    expect(observed).toEqual(baseline.result)
    expect(progress.length).toBeGreaterThan(2)
    expect(progress.at(-1)).toMatchObject({
      frameCount: Number(observed.frameCount),
    })
    expect(progress.every((value, index) => index === 0 || (
      value.processedBytes > progress[index - 1]!.processedBytes
      && value.frameCount === progress[index - 1]!.frameCount + 1
    ))).toBe(true)
  })

  it('fails the streamed write safely when its internal progress observer throws', async () => {
    const writable = new SlowCollector()
    await expect(container.writeArchiveContainer({
      writable,
      header: makeHeader(),
      keySlots: TEST_SLOTS,
      missionArchiveKey: TEST_KEY,
      entries: [
        { name: 'manifest.json', size: 120, source: Buffer.alloc(120, 0x41) },
      ],
      onProgress: () => { throw new Error('progress observer failed') },
    })).rejects.toThrow(/progress observer failed/iu)
    expect(writable.destroyed).toBe(true)
  })

  it('reads a bounded canonical preamble without decrypting or emitting payload', async () => {
    const { bytes } = await writeArchive()
    const preamble = await container.readArchivePreamble(fragment(bytes))

    expect(preamble.header).toEqual(makeHeader())
    expect(preamble.keySlots).toEqual(TEST_SLOTS)
    expect(preamble.headerDigest).toEqual(
      createHash('sha256').update(container.canonicalJson(makeHeader()), 'utf8').digest(),
    )
    expect(preamble.continuation[Symbol.asyncIterator]).toBeTypeOf('function')
  })

  it.each([
    {
      label: 'duplicate slot id',
      slots: [
        { slotId: 'same', slotType: 'passphrase' },
        { slotId: 'same', slotType: 'recovery' },
      ],
    },
    {
      label: 'duplicate slot type',
      slots: [
        { slotId: 'first', slotType: 'passphrase' },
        { slotId: 'second', slotType: 'passphrase' },
      ],
    },
    {
      label: 'unbounded slot id',
      slots: [
        { slotId: 'x'.repeat(129), slotType: 'passphrase' },
        { slotId: 'recovery', slotType: 'recovery' },
      ],
    },
    {
      label: 'unknown slot type',
      slots: [
        { slotId: 'passphrase', slotType: 'future-slot' },
        { slotId: 'recovery', slotType: 'recovery' },
      ],
    },
  ])('rejects $label in the bounded key-slot preamble', async ({ slots }) => {
    await expect(
      container.readArchivePreamble(Readable.from(encodePreamble(makeHeader(), slots))),
    ).rejects.toThrow(container.ArchiveFormatError)
  })

  it('rejects malformed or extended unused slots instead of validating only the chosen slot', async () => {
    const unknownFieldSlots = [
      TEST_SLOTS[0],
      { ...TEST_SLOTS[1], futureKdfControl: 'weaken' },
    ]
    const weakenedProfileSlots = [
      TEST_SLOTS[0],
      { ...TEST_SLOTS[1], profile: { ...TEST_SCRYPT_PROFILE, N: 65_536 } },
    ]

    await expect(
      container.readArchivePreamble(Readable.from(
        encodePreamble(makeHeader(), unknownFieldSlots),
      )),
    ).rejects.toThrow(container.ArchiveFormatError)
    await expect(
      container.readArchivePreamble(Readable.from(
        encodePreamble(makeHeader(), weakenedProfileSlots),
      )),
    ).rejects.toThrow(container.ArchiveFormatError)
  })

  it.each([
    { label: 'zero slots', slots: [] },
    { label: 'passphrase-only slots', slots: [TEST_SLOTS[0]] },
    { label: 'recovery-only slots', slots: [TEST_SLOTS[1]] },
    {
      label: 'passphrase and machine slots without recovery',
      slots: [
        TEST_SLOTS[0],
        { ...TEST_SLOTS[1], slotId: 'machine-main', slotType: 'machine' },
      ],
    },
  ])('rejects $label because both non-machine recovery paths are mandatory', async ({ slots }) => {
    await expect(container.readArchivePreamble(Readable.from(
      encodePreamble(makeHeader({ key_slot_count: slots.length }), slots),
    ))).rejects.toThrow(container.ArchiveFormatError)
  })

  it('requires manifest.json to be the first encrypted entry', async () => {
    await expect(
      writeArchive([{ name: 'mission.json', size: 2, source: Buffer.from('{}') }]),
    ).rejects.toThrow(/manifest\.json/i)
  })
})

describe('SARARCH2 fail-closed framing', () => {
  it('rejects a same-length authenticated-header mutation', async () => {
    const { bytes } = await writeArchive()
    const changed = replaceSameLengthHeader(bytes, makeHeader({ mission_id: 'mission-bravo' }))
    await expect(
      container.readArchiveContainer({ readable: Readable.from(changed), missionArchiveKey: TEST_KEY }),
    ).rejects.toThrow(/auth|decrypt/i)
  })

  it.each(['ciphertext', 'tag'] as const)('rejects a mutated data-frame %s', async (part) => {
    const { bytes } = await writeArchive()
    const changed = Buffer.from(bytes)
    const frame = locateFrames(changed).frames.find((candidate) => !candidate.final)!
    const offset = part === 'ciphertext' ? frame.start + FRAME_RECORD_HEADER_BYTES : frame.end - 1
    changed[offset] = changed[offset]! ^ 0x01

    await expect(
      container.readArchiveContainer({ readable: fragment(changed), missionArchiveKey: TEST_KEY }),
    ).rejects.toThrow(/auth|decrypt/i)
  })

  it('rejects trailer mutation and bytes after the trailer', async () => {
    const { bytes } = await writeArchive()
    const changedTrailer = Buffer.from(bytes)
    const { trailerStart } = locateFrames(changedTrailer)
    changedTrailer[trailerStart] = changedTrailer[trailerStart]! ^ 0x01

    await expect(
      container.readArchiveContainer({ readable: fragment(changedTrailer), missionArchiveKey: TEST_KEY }),
    ).rejects.toThrow(container.ArchiveFormatError)
    await expect(
      container.readArchiveContainer({
        readable: Readable.from(Buffer.concat([bytes, Buffer.from([0x00])])),
        missionArchiveKey: TEST_KEY,
      }),
    ).rejects.toThrow(/after.*trailer|end.of.file/i)
  })

  it('classifies truncation at preamble, frame, tag, final-frame and trailer boundaries', async () => {
    const { bytes } = await writeArchive()
    const layout = locateFrames(bytes)
    const first = layout.frames[0]!
    const final = layout.frames.at(-1)!
    const cutPoints = [
      3,
      container.SARARCH2_MAGIC.length + 2,
      layout.payloadStart + 5,
      first.end - 2,
      final.start,
      final.end - 1,
      bytes.length - 1,
    ]

    for (const cutPoint of cutPoints) {
      await expect(
        container.readArchiveContainer({
          readable: fragment(bytes.subarray(0, cutPoint)),
          missionArchiveKey: TEST_KEY,
        }),
      ).rejects.toThrow(container.ArchiveTruncationError)
    }
  })

  it.each(['reordered', 'duplicated'] as const)('rejects %s frame records', async (attack) => {
    const { bytes } = await writeArchive([
      { name: 'manifest.json', size: 80, source: Buffer.alloc(80, 0x41) },
      { name: 'mission.json', size: 80, source: Buffer.alloc(80, 0x42) },
    ])
    const { payloadStart, frames, trailerStart } = locateFrames(bytes)
    expect(frames.length).toBeGreaterThan(3)
    const first = bytes.subarray(frames[0]!.start, frames[0]!.end)
    const second = bytes.subarray(frames[1]!.start, frames[1]!.end)
    const remainder = bytes.subarray(frames[2]!.start, trailerStart)
    const attackedFrames =
      attack === 'reordered'
        ? Buffer.concat([second, first, remainder])
        : Buffer.concat([first, first, second, remainder])
    const attacked = Buffer.concat([
      bytes.subarray(0, payloadStart),
      attackedFrames,
      bytes.subarray(trailerStart),
    ])

    await expect(
      container.readArchiveContainer({ readable: fragment(attacked), missionArchiveKey: TEST_KEY }),
    ).rejects.toThrow(/frame.*index|sequence/i)
  })

  it('rejects a same-index frame spliced from another authenticated header', async () => {
    const entries = [
      { name: 'manifest.json', size: 40, source: Buffer.alloc(40, 0x4d) },
      { name: 'mission.json', size: 40, source: Buffer.alloc(40, 0x51) },
    ] as const
    const firstArchive = await writeArchive(entries, makeHeader({ mission_id: 'mission-alpha' }))
    const secondArchive = await writeArchive(entries, makeHeader({ mission_id: 'mission-bravo' }))
    const firstLayout = locateFrames(firstArchive.bytes)
    const secondLayout = locateFrames(secondArchive.bytes)
    const firstFrame = firstLayout.frames[0]!
    const splicedFrame = secondLayout.frames[0]!
    expect(splicedFrame.end - splicedFrame.start).toBe(firstFrame.end - firstFrame.start)
    const attacked = Buffer.from(firstArchive.bytes)
    secondArchive.bytes.copy(attacked, firstFrame.start, splicedFrame.start, splicedFrame.end)

    await expect(
      container.readArchiveContainer({ readable: fragment(attacked), missionArchiveKey: TEST_KEY }),
    ).rejects.toThrow(/auth|decrypt/i)
  })

  it('authenticates final semantics and refuses a non-finalized prefix', async () => {
    const { bytes } = await writeArchive()
    const changed = Buffer.from(bytes)
    const final = locateFrames(changed).frames.at(-1)!
    expect(final.final).toBe(true)
    changed[final.start + 8] = 0

    await expect(
      container.readArchiveContainer({ readable: fragment(changed), missionArchiveKey: TEST_KEY }),
    ).rejects.toThrow(/auth|decrypt|final/i)
  })
})

describe('SARARCH2 logical-entry safety', () => {
  it.each([
    '../secret.txt',
    '/absolute.txt',
    'attachments/../../secret.txt',
    'attachments\\windows.txt',
    'attachments//double.txt',
    './mission.json',
    'C:/drive.txt',
  ])('rejects the non-canonical or unsafe entry name %s', async (name) => {
    await expect(
      writeArchive([
        { name: 'manifest.json', size: 2, source: Buffer.from('{}') },
        { name, size: 1, source: Buffer.from('x') },
      ]),
    ).rejects.toThrow(/entry name/i)
  })

  it('rejects duplicate encrypted entry names', async () => {
    await expect(
      writeArchive([
        { name: 'manifest.json', size: 2, source: Buffer.from('{}') },
        { name: 'mission.json', size: 2, source: Buffer.from('{}') },
        { name: 'mission.json', size: 2, source: Buffer.from('{}') },
      ]),
    ).rejects.toThrow(/duplicate.*entry/i)
  })

  it.each([
    { declared: 4, actual: Buffer.from('abc'), label: 'short' },
    { declared: 2, actual: Buffer.from('abc'), label: 'long' },
  ])('rejects a $label source relative to its declared uint64 length', async ({ declared, actual }) => {
    await expect(
      writeArchive([
        { name: 'manifest.json', size: 2, source: Buffer.from('{}') },
        { name: 'mission.json', size: declared, source: actual },
      ]),
    ).rejects.toThrow(/declared.*length|length.*declared/i)
  })
})

describe('SARARCH2 version and uint64 negotiation', () => {
  it.each([
    { field: 'container_version', override: { container_version: 3 } },
    { field: 'cipher', override: { cipher: 'aes-256-gcm-future' } },
    { field: 'framing', override: { framing: 'sararch2-framed-v2' } },
  ])('fails closed on unsupported $field', async ({ override }) => {
    await expect(
      container.readArchivePreamble(Readable.from(encodePreamble(makeHeader(override)))),
    ).rejects.toThrow(container.ArchiveFormatError)
  })

  it('decodes a full uint64 entry length without Number precision loss', async () => {
    const enormousLength = 0x0020_0000_0000_0001n
    const header = makeHeader({ frame_size: 512 })
    const headerJson = Buffer.from(container.canonicalJson(header), 'utf8')
    const headerDigest = createHash('sha256').update(headerJson).digest()
    const entryJson = Buffer.from(container.canonicalJson({ index: 0, name: 'manifest.json' }), 'utf8')
    const entryJsonLength = Buffer.alloc(4)
    entryJsonLength.writeUInt32BE(entryJson.length)
    const logicalHeader = Buffer.concat([
      ENTRY_MAGIC,
      entryJsonLength,
      entryJson,
      uint64(enormousLength),
    ])
    const data = encryptFrame({
      missionArchiveKey: TEST_KEY,
      noncePrefix: Buffer.from(header.nonce_prefix, 'base64'),
      frameIndex: 0n,
      final: false,
      plaintext: logicalHeader,
      headerDigest,
    })
    const final = encryptFrame({
      missionArchiveKey: TEST_KEY,
      noncePrefix: Buffer.from(header.nonce_prefix, 'base64'),
      frameIndex: 1n,
      final: true,
      plaintext: Buffer.alloc(0),
      headerDigest,
    })
    const encodeFrame = (
      index: bigint,
      isFinal: boolean,
      plaintextLength: number,
      encrypted: { readonly ciphertext: Buffer; readonly authTag: Buffer },
    ): Buffer => {
      const recordHeader = Buffer.alloc(FRAME_RECORD_HEADER_BYTES)
      recordHeader.writeBigUInt64BE(index)
      recordHeader[8] = isFinal ? 1 : 0
      recordHeader.writeUInt32BE(plaintextLength, 9)
      return Buffer.concat([recordHeader, encrypted.ciphertext, encrypted.authTag])
    }
    const trailer = Buffer.concat([container.SARARCH2_TRAILER_MAGIC, uint64(2n), Buffer.from([1])])
    const archive = Buffer.concat([
      encodePreamble(header),
      encodeFrame(0n, false, logicalHeader.length, data),
      encodeFrame(1n, true, 0, final),
      trailer,
    ])

    await expect(
      container.readArchiveContainer({ readable: fragment(archive), missionArchiveKey: TEST_KEY }),
    ).rejects.toThrow(enormousLength.toString())
  })

  it('decodes a full uint64 trailer count without Number precision loss', async () => {
    const { bytes } = await writeArchive()
    const changed = Buffer.from(bytes)
    const impossibleCount = 0x0020_0000_0000_0001n
    const { trailerStart } = locateFrames(changed)
    changed.writeBigUInt64BE(impossibleCount, trailerStart + container.SARARCH2_TRAILER_MAGIC.length)

    await expect(
      container.readArchiveContainer({ readable: fragment(changed), missionArchiveKey: TEST_KEY }),
    ).rejects.toThrow(impossibleCount.toString())
  })
})
