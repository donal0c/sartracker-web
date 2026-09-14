import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  decodeOfficialMapTile,
  normalizeOfficialMapTileFormat,
} = require('../../electron/official-map-tile-decoder.cjs') as {
  readonly decodeOfficialMapTile: (
    bytes: Uint8Array,
    format: string,
    nativeImage: NativeImageApi,
  ) => boolean
  readonly normalizeOfficialMapTileFormat: (format: unknown) => string | null
}
const { NO_COVERAGE_TILE_BASE64 } = require('../../electron/official-map-no-coverage.cjs') as {
  readonly NO_COVERAGE_TILE_BASE64: string
}

type NativeImageApi = {
  readonly createFromBuffer: (bytes: Buffer) => NativeImage
}

type NativeImage = {
  readonly getSize: () => { readonly width: number; readonly height: number }
  readonly isEmpty?: () => boolean
  readonly toBitmap: () => Buffer
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const VALID_PNG = Buffer.from(NO_COVERAGE_TILE_BASE64, 'base64')
const JPEG_TILE = createJpegTile(256)
const WEBP_TILE = createWebpVp8xTile(256)

describe('Electron official map tile decoder', () => {
  it('normalizes only the supported raster encodings', () => {
    expect(normalizeOfficialMapTileFormat('PNG')).toBe('png')
    expect(normalizeOfficialMapTileFormat('image/jpeg')).toBe('jpeg')
    expect(normalizeOfficialMapTileFormat('jpg')).toBe('jpeg')
    expect(normalizeOfficialMapTileFormat('image/webp')).toBe('webp')
    expect(normalizeOfficialMapTileFormat('gif')).toBeNull()
    expect(normalizeOfficialMapTileFormat('')).toBeNull()
  })

  it.each([
    ['png', PNG_SIGNATURE],
    ['jpeg', JPEG_TILE],
    ['webp', WEBP_TILE],
  ] as const)('accepts an opaque %s tile only at the native boundary', (format, signature) => {
    const nativeImage = createNativeImageApi({ width: 256, height: 256 })
    expect(decodeOfficialMapTile(format === 'png' ? VALID_PNG : signature, format, nativeImage)).toBe(true)
  })

  it('accepts the larger supported square tile size', () => {
    const nativeImage = createNativeImageApi({ width: 512, height: 512 })
    expect(decodeOfficialMapTile(VALID_PNG, 'png', nativeImage)).toBe(true)
  })

  it('accepts a valid indexed palette PNG', () => {
    const indexedPng = createIndexedPng()
    const nativeImage = createNativeImageApi({ width: 256, height: 256 })
    expect(decodeOfficialMapTile(indexedPng, 'png', nativeImage)).toBe(true)
  })

  it.each([
    ['missing PLTE', createIndexedPng({ includePalette: false })],
    ['mis-sized PLTE', createIndexedPng({ palette: Buffer.from([0xff, 0x00, 0x00, 0x00]) })],
    ['PLTE after IDAT', createIndexedPng({ paletteAfterIdat: true })],
    ['too many palette entries', createIndexedPng({ palette: Buffer.alloc(3 * 257) })],
    ['too many entries for bit depth', createIndexedPng({ bitDepth: 1, palette: Buffer.alloc(3 * 3) })],
  ] as const)('rejects an invalid indexed palette PNG: %s', (_label, indexedPng) => {
    let nativeCalls = 0
    const nativeImage: NativeImageApi = {
      createFromBuffer: () => {
        nativeCalls += 1
        return createNativeImageApi({ width: 256, height: 256 }).createFromBuffer(Buffer.alloc(1))
      },
    }
    expect(decodeOfficialMapTile(indexedPng, 'png', nativeImage)).toBe(false)
    expect(nativeCalls).toBe(0)
  })

  it('rejects the legacy hatch before nativeImage because its PNG stream is corrupt', () => {
    const nativeImage = createNativeImageApi({ width: 256, height: 256 })
    expect(
      decodeOfficialMapTile(
        createLegacyCorruptPng(VALID_PNG),
        'png',
        nativeImage,
      ),
    ).toBe(false)
  })

  it('rejects unsupported PNG dimensions before nativeImage allocation', () => {
    let nativeCalls = 0
    const nativeImage: NativeImageApi = {
      createFromBuffer: () => {
        nativeCalls += 1
        return createNativeImageApi({ width: 256, height: 256 }).createFromBuffer(Buffer.alloc(1))
      },
    }
    const oversizedDimensions = Buffer.from(VALID_PNG)
    oversizedDimensions.writeUInt32BE(1024, 16)
    oversizedDimensions.writeUInt32BE(1024, 20)
    rewritePngCrc(oversizedDimensions, 8)

    expect(decodeOfficialMapTile(oversizedDimensions, 'png', nativeImage)).toBe(false)
    expect(nativeCalls).toBe(0)
  })

  it('rejects a compressed PNG bomb before nativeImage allocation', () => {
    let nativeCalls = 0
    const nativeImage: NativeImageApi = {
      createFromBuffer: () => {
        nativeCalls += 1
        return createNativeImageApi({ width: 256, height: 256 }).createFromBuffer(Buffer.alloc(1))
      },
    }
    const compressedBomb = replacePngIdat(VALID_PNG, deflateSync(Buffer.alloc(3_000_000)))

    expect(decodeOfficialMapTile(compressedBomb, 'png', nativeImage)).toBe(false)
    expect(nativeCalls).toBe(0)
  })

  it('bounds JPEG and WebP dimensions before nativeImage allocation', () => {
    let nativeCalls = 0
    const nativeImage: NativeImageApi = {
      createFromBuffer: () => {
        nativeCalls += 1
        return createNativeImageApi({ width: 256, height: 256 }).createFromBuffer(Buffer.alloc(1))
      },
    }

    expect(decodeOfficialMapTile(createJpegTile(4096), 'jpeg', nativeImage)).toBe(false)
    expect(decodeOfficialMapTile(createWebpVp8xTile(4096), 'webp', nativeImage)).toBe(false)
    expect(nativeCalls).toBe(0)
  })

  it('rejects WebP bytes whose RIFF length does not cover the whole payload', () => {
    let nativeCalls = 0
    const nativeImage: NativeImageApi = {
      createFromBuffer: () => {
        nativeCalls += 1
        return createNativeImageApi({ width: 256, height: 256 }).createFromBuffer(Buffer.alloc(1))
      },
    }
    const trailingBytes = Buffer.concat([WEBP_TILE, Buffer.from([0x00])])
    expect(decodeOfficialMapTile(trailingBytes, 'webp', nativeImage)).toBe(false)
    expect(nativeCalls).toBe(0)
  })

  it.each([
    ['non-square', { width: 256, height: 512 }, 255],
    ['unsupported dimensions', { width: 128, height: 128 }, 255],
    ['fully transparent', { width: 256, height: 256 }, 0],
  ] as const)('rejects %s tiles', (_label, size, alpha) => {
    const nativeImage = createNativeImageApi(size, alpha)
    expect(decodeOfficialMapTile(VALID_PNG, 'png', nativeImage)).toBe(false)
  })

  it('rejects a payload whose bytes do not match the declared format', () => {
    const nativeImage = createNativeImageApi({ width: 256, height: 256 })
    expect(decodeOfficialMapTile(JPEG_TILE, 'png', nativeImage)).toBe(false)
    expect(decodeOfficialMapTile(PNG_SIGNATURE, 'jpeg', nativeImage)).toBe(false)
    expect(decodeOfficialMapTile(WEBP_TILE, 'webp', nativeImage)).toBe(true)
  })

  it('fails closed for unsupported formats, malformed input, and native decode errors', () => {
    const nativeImage = createNativeImageApi({ width: 256, height: 256 })
    expect(decodeOfficialMapTile(Buffer.alloc(0), 'png', nativeImage)).toBe(false)
    expect(decodeOfficialMapTile(PNG_SIGNATURE, 'gif', nativeImage)).toBe(false)
    expect(
      decodeOfficialMapTile(VALID_PNG, 'png', {
        createFromBuffer: () => {
          throw new Error('native decode failed')
        },
      }),
    ).toBe(false)
  })
})

function createNativeImageApi(
  size: { readonly width: number; readonly height: number },
  alpha = 255,
): NativeImageApi {
  return {
    createFromBuffer: () => ({
      getSize: () => size,
      isEmpty: () => false,
      toBitmap: () => {
        const bitmap = Buffer.alloc(size.width * size.height * 4)
        for (let offset = 3; offset < bitmap.length; offset += 4) bitmap[offset] = alpha
        return bitmap
      },
    }),
  }
}

/** Corrupts the generated tile's IDAT CRC to model the retired hatch payload. */
function createLegacyCorruptPng(bytes: Uint8Array): Buffer {
  const corrupt = Buffer.from(bytes)
  const idatLength = corrupt.readUInt32BE(33)
  const idatCrcOffset = 33 + 8 + idatLength
  corrupt[idatCrcOffset] ^= 0x01
  return corrupt
}

/** Builds a bounded indexed-color PNG with configurable palette structure. */
function createIndexedPng(options: {
  readonly includePalette?: boolean
  readonly palette?: Buffer
  readonly paletteAfterIdat?: boolean
  readonly bitDepth?: 1 | 2 | 4 | 8
} = {}): Buffer {
  const width = 256
  const height = 256
  const bitDepth = options.bitDepth ?? 8
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = bitDepth
  header[9] = 3
  const scanlines = Buffer.alloc((Math.ceil((width * bitDepth) / 8) + 1) * height)
  const idat = createPngChunk('IDAT', deflateSync(scanlines))
  const palette = createPngChunk('PLTE', options.palette ?? Buffer.from([0xff, 0x00, 0x00]))
  const chunks = [
    createPngChunk('IHDR', header),
    ...(options.includePalette === false || options.paletteAfterIdat ? [] : [palette]),
    idat,
    ...(options.paletteAfterIdat ? [palette] : []),
    createPngChunk('IEND', Buffer.alloc(0)),
  ]
  return Buffer.concat([PNG_SIGNATURE, ...chunks])
}

/** Encodes one PNG chunk with its standard CRC. */
function createPngChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, 'ascii')
  Buffer.from(data).copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)
  return chunk
}

/** Replaces only the IDAT payload while retaining a valid PNG envelope and CRCs. */
function replacePngIdat(bytes: Uint8Array, payload: Uint8Array): Buffer {
  const source = Buffer.from(bytes)
  const chunkOffset = 33
  const sourceLength = source.readUInt32BE(chunkOffset)
  const chunk = Buffer.alloc(12 + payload.length)
  chunk.writeUInt32BE(payload.length, 0)
  chunk.write('IDAT', 4, 'ascii')
  Buffer.from(payload).copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + payload.length)), 8 + payload.length)
  const sourceEnd = chunkOffset + 12 + sourceLength
  return Buffer.concat([source.subarray(0, chunkOffset), chunk, source.subarray(sourceEnd)])
}

/** Recomputes one PNG chunk CRC after changing its data. */
function rewritePngCrc(bytes: Buffer, chunkOffset: number): void {
  const length = bytes.readUInt32BE(chunkOffset)
  bytes.writeUInt32BE(crc32(bytes.subarray(chunkOffset + 4, chunkOffset + 8 + length)), chunkOffset + 8 + length)
}

/** Calculates the standard PNG CRC for focused decoder fixtures. */
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

/** Returns a deterministic JPEG frame header with the requested square dimensions. */
function createJpegTile(size: number): Buffer {
  const bytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    0x00, 0x00, 0x00, 0x00, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
  bytes.writeUInt16BE(size, 7)
  bytes.writeUInt16BE(size, 9)
  return bytes
}

/** Returns a bounded VP8X WebP envelope with the requested square dimensions. */
function createWebpVp8xTile(size: number): Buffer {
  const payload = Buffer.alloc(10)
  payload.writeUIntLE(size - 1, 4, 3)
  payload.writeUIntLE(size - 1, 7, 3)
  const bytes = Buffer.alloc(12 + 8 + payload.length)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(8 + payload.length + 4, 4)
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8X', 12, 'ascii')
  bytes.writeUInt32LE(payload.length, 16)
  payload.copy(bytes, 20)
  return bytes
}
