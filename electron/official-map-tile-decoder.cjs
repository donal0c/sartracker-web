const { inflateSync } = require('node:zlib')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const WEBP_RIFF_SIGNATURE = Buffer.from('RIFF', 'ascii')
const WEBP_FORMAT_SIGNATURE = Buffer.from('WEBP', 'ascii')
const TILE_SIZES = new Set([256, 512])
const MAX_TILE_BYTES = 4 * 1024 * 1024
const ADAM7_PASSES = Object.freeze([
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
  [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
])

const FORMAT_ALIASES = new Map([
  ['png', 'png'],
  ['image/png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['image/jpg', 'jpeg'],
  ['image/jpeg', 'jpeg'],
  ['webp', 'webp'],
  ['image/webp', 'webp'],
])

const PNG_BITS_PER_PIXEL = new Map([
  [0, new Map([[1, 1], [2, 2], [4, 4], [8, 8], [16, 16]])],
  [2, new Map([[8, 24], [16, 48]])],
  [3, new Map([[1, 1], [2, 2], [4, 4], [8, 8]])],
  [4, new Map([[8, 16], [16, 32]])],
  [6, new Map([[8, 32], [16, 64]])],
])

const CRC_TABLE = createCrcTable()

/**
 * Decodes one official map raster tile with Electron's native image decoder.
 *
 * The format signature and strict PNG structure are checked before Electron is
 * called so content-type metadata cannot turn malformed bytes into a usable
 * package. A tile is usable only when it decodes to a supported square size
 * and contains at least one visible pixel.
 */
function decodeOfficialMapTile(bytes, format, nativeImage = resolveElectronNativeImage()) {
  const buffer = toBuffer(bytes)
  const normalizedFormat = normalizeOfficialMapTileFormat(format)
  if (buffer === null || normalizedFormat === null || !matchesImageSignature(buffer, normalizedFormat)) {
    return false
  }
  if (normalizedFormat === 'png' && !hasStrictPngStructure(buffer)) {
    return false
  }
  if (normalizedFormat === 'jpeg' && !hasSupportedJpegDimensions(buffer)) {
    return false
  }
  if (normalizedFormat === 'webp' && !hasSupportedWebpDimensions(buffer)) {
    return false
  }
  if (nativeImage === null || typeof nativeImage.createFromBuffer !== 'function') {
    return false
  }

  try {
    const image = nativeImage.createFromBuffer(buffer)
    if (image === null || image === undefined) {
      return false
    }
    if (typeof image.isEmpty === 'function' && image.isEmpty()) {
      return false
    }
    const size = image.getSize()
    if (!isSupportedTileSize(size)) {
      return false
    }
    const bitmap = image.toBitmap()
    return hasVisiblePixel(bitmap, size)
  } catch {
    return false
  }
}

/** Normalizes the persisted MBTiles format or MIME type to the decoder policy. */
function normalizeOfficialMapTileFormat(format) {
  if (typeof format !== 'string') {
    return null
  }
  return FORMAT_ALIASES.get(format.trim().toLowerCase()) ?? null
}

/** Resolves Electron's nativeImage lazily so pure Node tests do not load Electron. */
function resolveElectronNativeImage() {
  try {
    const electron = require('electron')
    return electron?.nativeImage ?? null
  } catch {
    return null
  }
}

/** Converts supported byte input without allowing malformed values through. */
function toBuffer(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    return null
  }
  try {
    const buffer = Buffer.from(bytes)
    return buffer.length > 0 && buffer.length <= MAX_TILE_BYTES ? buffer : null
  } catch {
    return null
  }
}

/** Checks that encoded bytes identify the same format as the package metadata. */
function matchesImageSignature(bytes, format) {
  if (format === 'png') {
    return bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  }
  if (format === 'jpeg') {
    return bytes.length >= JPEG_SIGNATURE.length && bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  }
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, WEBP_RIFF_SIGNATURE.length).equals(WEBP_RIFF_SIGNATURE) &&
    bytes.subarray(8, 12).equals(WEBP_FORMAT_SIGNATURE)
  )
}

/** Checks the native image dimensions against the supported tile-size policy. */
function isSupportedTileSize(size) {
  return (
    size !== null &&
    typeof size === 'object' &&
    TILE_SIZES.has(size.width) &&
    size.width === size.height
  )
}

/** Rejects bitmap buffers whose alpha channel contains no visible pixel. */
function hasVisiblePixel(bitmap, size) {
  if (!(Buffer.isBuffer(bitmap) || bitmap instanceof Uint8Array)) {
    return false
  }
  const expectedLength = size.width * size.height * 4
  if (bitmap.length < expectedLength) {
    return false
  }
  for (let offset = 3; offset < expectedLength; offset += 4) {
    if (bitmap[offset] !== 0) {
      return true
    }
  }
  return false
}

/** Parses PNG chunks, CRCs, and the scanline stream before native decoding. */
function hasStrictPngStructure(bytes) {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false
  }

  let offset = PNG_SIGNATURE.length
  let header = null
  let idatSeen = false
  let endSeen = false
  let palette = null
  let transparencySeen = false
  const idatChunks = []

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) {
      return false
    }
    const chunkLength = bytes.readUInt32BE(offset)
    if (chunkLength > bytes.length - offset - 12) {
      return false
    }
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + chunkLength
    const crcOffset = dataEnd
    const chunkData = bytes.subarray(dataStart, dataEnd)
    if (!isPngChunkType(type) || crc32(Buffer.concat([Buffer.from(type, 'ascii'), chunkData])) !== bytes.readUInt32BE(crcOffset)) {
      return false
    }

    if (type === 'IHDR') {
      if (header !== null || chunkLength !== 13 || idatSeen || endSeen) {
        return false
      }
      header = readPngHeader(chunkData)
      if (header === null) {
        return false
      }
    } else if (type === 'IDAT') {
      if (header === null || endSeen) {
        return false
      }
      idatSeen = true
      idatChunks.push(chunkData)
    } else if (type === 'PLTE') {
      if (
        header === null
        || idatSeen
        || endSeen
        || transparencySeen
        || palette !== null
        || chunkLength === 0
        || chunkLength % 3 !== 0
        || chunkLength > 3 * 256
        || (header.colorType === 3 && chunkLength / 3 > 2 ** header.bitDepth)
        || header.colorType === 0
        || header.colorType === 4
      ) {
        return false
      }
      palette = chunkData
    } else if (type === 'tRNS') {
      if (
        header === null
        || idatSeen
        || endSeen
        || transparencySeen
        || !isValidPngTransparencyChunk(chunkLength, header, palette)
      ) {
        return false
      }
      transparencySeen = true
    } else if (type === 'IEND') {
      if (header === null || !idatSeen || chunkLength !== 0 || endSeen || crcOffset + 4 !== bytes.length) {
        return false
      }
      endSeen = true
    } else if (header === null || endSeen || isCriticalPngChunk(type)) {
      return false
    }

    offset = crcOffset + 4
  }

  if (
    header === null
    || !idatSeen
    || !endSeen
    || offset !== bytes.length
    || (header.colorType === 3 && palette === null)
  ) {
    return false
  }
  try {
    const expectedLength = expectedPngScanlineLength(header)
    if (expectedLength === null) {
      return false
    }
    const scanlines = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedLength })
    return scanlines.length === expectedLength && hasValidPngFilters(scanlines, header)
  } catch {
    return false
  }
}

/** Validates PNG transparency chunk size and palette dependency by color type. */
function isValidPngTransparencyChunk(length, header, palette) {
  if (header.colorType === 0 || header.colorType === 2) {
    return length === (header.colorType === 0 ? 2 : 6)
  }
  if (header.colorType === 3) {
    return palette !== null && length > 0 && length <= palette.length / 3
  }
  return false
}

/** Reads and validates the fixed PNG IHDR fields. */
function readPngHeader(data) {
  const width = data.readUInt32BE(0)
  const height = data.readUInt32BE(4)
  const bitDepth = data[8]
  const colorType = data[9]
  const compressionMethod = data[10]
  const filterMethod = data[11]
  const interlaceMethod = data[12]
  if (
    width === 0 ||
    height === 0 ||
    !PNG_BITS_PER_PIXEL.has(colorType) ||
    !PNG_BITS_PER_PIXEL.get(colorType).has(bitDepth) ||
    compressionMethod !== 0 ||
    filterMethod !== 0 ||
    (interlaceMethod !== 0 && interlaceMethod !== 1)
  ) {
    return null
  }
  if (!TILE_SIZES.has(width) || width !== height) {
    return null
  }
  return { width, height, bitDepth, colorType, interlaceMethod }
}

/** Calculates the exact decompressed scanline size for a PNG, including Adam7 passes. */
function expectedPngScanlineLength(header) {
  const bitsPerPixel = PNG_BITS_PER_PIXEL.get(header.colorType)?.get(header.bitDepth)
  if (bitsPerPixel === undefined) {
    return null
  }
  if (header.interlaceMethod === 0) {
    return (Math.ceil((header.width * bitsPerPixel) / 8) + 1) * header.height
  }
  let length = 0
  for (const [startX, startY, stepX, stepY] of ADAM7_PASSES) {
    const width = header.width <= startX ? 0 : Math.ceil((header.width - startX) / stepX)
    const height = header.height <= startY ? 0 : Math.ceil((header.height - startY) / stepY)
    if (width > 0 && height > 0) {
      length += (Math.ceil((width * bitsPerPixel) / 8) + 1) * height
    }
  }
  return length
}

/** Validates every PNG scanline filter byte without decoding untrusted pixels in JavaScript. */
function hasValidPngFilters(scanlines, header) {
  const bitsPerPixel = PNG_BITS_PER_PIXEL.get(header.colorType)?.get(header.bitDepth)
  if (bitsPerPixel === undefined) {
    return false
  }
  const assertRows = (start, width, height) => {
    const rowLength = Math.ceil((width * bitsPerPixel) / 8) + 1
    for (let row = 0; row < height; row += 1) {
      if (scanlines[start + row * rowLength] > 4) {
        return false
      }
    }
    return start + rowLength * height
  }
  if (header.interlaceMethod === 0) {
    return assertRows(0, header.width, header.height) === scanlines.length
  }
  let offset = 0
  for (const [startX, startY, stepX, stepY] of ADAM7_PASSES) {
    const width = header.width <= startX ? 0 : Math.ceil((header.width - startX) / stepX)
    const height = header.height <= startY ? 0 : Math.ceil((header.height - startY) / stepY)
    if (width > 0 && height > 0) {
      offset = assertRows(offset, width, height)
      if (offset === false) {
        return false
      }
    }
  }
  return offset === scanlines.length
}

/** Parses JPEG SOF dimensions before handing bytes to nativeImage. */
function hasSupportedJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return false
  }
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return false
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) {
      return false
    }
    if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) {
      continue
    }
    if (offset + 2 > bytes.length) {
      return false
    }
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || segmentLength > bytes.length - offset) {
      return false
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7 || offset + 7 > bytes.length) {
        return false
      }
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      return width === height && TILE_SIZES.has(width)
    }
    offset += segmentLength
  }
  return false
}

/** Identifies JPEG frame markers that carry width and height. */
function isJpegStartOfFrame(marker) {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
}

/** Parses VP8, VP8L, or VP8X dimensions before handing WebP bytes to nativeImage. */
function hasSupportedWebpDimensions(bytes) {
  if (
    bytes.length < 12 ||
    !bytes.subarray(0, 4).equals(WEBP_RIFF_SIGNATURE) ||
    !bytes.subarray(8, 12).equals(WEBP_FORMAT_SIGNATURE)
  ) {
    return false
  }
  const riffLength = bytes.readUInt32LE(4)
  if (riffLength !== bytes.length - 8) {
    return false
  }
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.toString('ascii', offset, offset + 4)
    const chunkLength = bytes.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkEnd > bytes.length || chunkEnd > 8 + riffLength) {
      return false
    }
    const payload = bytes.subarray(chunkStart, chunkEnd)
    if (chunkType === 'VP8 ' && payload.length >= 10 && payload[3] === 0x9d && payload[4] === 0x01 && payload[5] === 0x2a) {
      const width = payload.readUInt16LE(6) & 0x3fff
      const height = payload.readUInt16LE(8) & 0x3fff
      return width === height && TILE_SIZES.has(width)
    }
    if (chunkType === 'VP8L' && payload.length >= 5 && payload[0] === 0x2f) {
      const width = 1 + (payload[1] | ((payload[2] & 0x3f) << 8))
      const height = 1 + ((payload[2] >> 6) | (payload[3] << 2) | ((payload[4] & 0x0f) << 10))
      return width === height && TILE_SIZES.has(width)
    }
    if (chunkType === 'VP8X' && payload.length >= 10) {
      const width = 1 + (payload[4] | (payload[5] << 8) | (payload[6] << 16))
      const height = 1 + (payload[7] | (payload[8] << 8) | (payload[9] << 16))
      return width === height && TILE_SIZES.has(width)
    }
    offset = chunkEnd + (chunkLength & 1)
  }
  return false
}

/** Rejects malformed PNG chunk type names and reserved-bit violations. */
function isPngChunkType(type) {
  return /^[A-Za-z]{4}$/u.test(type) && type[2] === type[2].toUpperCase()
}

/** Identifies unknown critical PNG chunks so they cannot be silently ignored. */
function isCriticalPngChunk(type) {
  return type[0] === type[0].toUpperCase() && !['PLTE', 'tRNS'].includes(type)
}

/** Builds the CRC lookup table used by strict PNG chunk validation. */
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

module.exports = {
  decodeOfficialMapTile,
  normalizeOfficialMapTileFormat,
}
