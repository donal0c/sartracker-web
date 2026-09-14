const { deflateSync } = require('node:zlib')

const TILE_SIZE = 256
const BACKGROUND = [0xe9, 0xe7, 0xe0, 0xff]
const HATCH = [0xbc, 0xb7, 0xaa, 0xff]
const CRC_TABLE = createCrcTable()

/** Builds the deterministic opaque PNG used to show an offline coverage gap. */
function createNoCoverageTilePng() {
  const rowLength = TILE_SIZE * 4
  const scanlines = Buffer.alloc((rowLength + 1) * TILE_SIZE)
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const rowOffset = y * (rowLength + 1)
    scanlines[rowOffset] = 0
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const pixel = (x + y) % 32 < 2 ? HATCH : BACKGROUND
      const pixelOffset = rowOffset + 1 + x * 4
      scanlines.set(pixel, pixelOffset)
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createPngChunk('IHDR', createIhdr()),
    createPngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    createPngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Creates the fixed RGBA 256px PNG header. */
function createIhdr() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(TILE_SIZE, 0)
  header.writeUInt32BE(TILE_SIZE, 4)
  header[8] = 8
  header[9] = 6
  return header
}

/** Encodes one PNG chunk with its standard CRC. */
function createPngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return chunk
}

/** Builds the CRC lookup table used for PNG chunks. */
function createCrcTable() {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

/** Calculates the standard PNG CRC over a chunk type and payload. */
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

const NO_COVERAGE_TILE_BYTES = createNoCoverageTilePng()
const NO_COVERAGE_TILE_BASE64 = NO_COVERAGE_TILE_BYTES.toString('base64')

/** Creates the proxy response shape without exposing mutable shared bytes. */
function createNoCoverageTileResponse() {
  return {
    contentType: 'image/png',
    bytesBase64: NO_COVERAGE_TILE_BASE64,
  }
}

module.exports = {
  NO_COVERAGE_TILE_BASE64,
  NO_COVERAGE_TILE_BYTES,
  TILE_SIZE,
  createNoCoverageTilePng,
  createNoCoverageTileResponse,
}
