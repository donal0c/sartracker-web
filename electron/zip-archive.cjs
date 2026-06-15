const zlib = require('node:zlib')

/**
 * Minimal, dependency-free ZIP reader/writer for Electron mission archives.
 *
 * The Rust reference backend builds finalize archives with the `zip` crate. Electron
 * has no archive dependency, and pulling in a native one would add another ABI surface
 * to the already-constrained better-sqlite3 / Electron build. This module produces and
 * verifies standard DEFLATE-compressed ZIP files using only Node's built-in `zlib`,
 * which keeps the archive format interoperable (any standard unzip tool, including the
 * Rust `zip` crate's reader, can open it) while adding zero install-time risk.
 *
 * Scope is deliberately narrow: store/deflate per entry, 32-bit sizes (mission archives
 * are well under 4 GB), UTF-8 entry names, no ZIP64, no encryption. Every entry's CRC-32
 * is written and re-verified on read so a corrupted snapshot is detected, not silently
 * trusted — matching the "fail loudly" invariant for safety-critical records.
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const COMPRESSION_STORE = 0
const COMPRESSION_DEFLATE = 8
const VERSION_NEEDED = 20

const CRC_TABLE = buildCrcTable()

function buildCrcTable() {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

/**
 * Computes the ZIP/PKZIP CRC-32 checksum of a buffer.
 */
function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Builds a ZIP archive buffer from the given named entries, in order. Each entry is
 * DEFLATE-compressed when that shrinks it, otherwise stored uncompressed.
 *
 * @param {ReadonlyArray<{ name: string, data: Buffer }>} entries
 * @returns {Buffer}
 */
function createZipArchive(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)
    const uncompressedSize = data.length

    const deflated = data.length === 0 ? Buffer.alloc(0) : zlib.deflateRawSync(data)
    const useDeflate = deflated.length < uncompressedSize
    const compressionMethod = useDeflate ? COMPRESSION_DEFLATE : COMPRESSION_STORE
    const payload = useDeflate ? deflated : data
    const compressedSize = payload.length

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0)
    localHeader.writeUInt16LE(VERSION_NEEDED, 4)
    localHeader.writeUInt16LE(0, 6) // general purpose flags
    localHeader.writeUInt16LE(compressionMethod, 8)
    localHeader.writeUInt16LE(0, 10) // mod time (deterministic 0 — no clock dependency)
    localHeader.writeUInt16LE(0, 12) // mod date
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressedSize, 18)
    localHeader.writeUInt32LE(uncompressedSize, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra field length

    localParts.push(localHeader, nameBytes, payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0)
    centralHeader.writeUInt16LE(VERSION_NEEDED, 4) // version made by
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6) // version needed
    centralHeader.writeUInt16LE(0, 8) // flags
    centralHeader.writeUInt16LE(compressionMethod, 10)
    centralHeader.writeUInt16LE(0, 12) // mod time
    centralHeader.writeUInt16LE(0, 14) // mod date
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressedSize, 20)
    centralHeader.writeUInt32LE(uncompressedSize, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra field length
    centralHeader.writeUInt16LE(0, 32) // comment length
    centralHeader.writeUInt16LE(0, 34) // disk number start
    centralHeader.writeUInt16LE(0, 36) // internal attributes
    centralHeader.writeUInt32LE(0, 38) // external attributes
    centralHeader.writeUInt32LE(offset, 42) // local header offset

    centralParts.push(centralHeader, nameBytes)

    offset += localHeader.length + nameBytes.length + payload.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const localSection = Buffer.concat(localParts)

  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
  endRecord.writeUInt16LE(0, 4) // disk number
  endRecord.writeUInt16LE(0, 6) // central directory disk
  endRecord.writeUInt16LE(entries.length, 8) // entries on this disk
  endRecord.writeUInt16LE(entries.length, 10) // total entries
  endRecord.writeUInt32LE(centralDirectory.length, 12)
  endRecord.writeUInt32LE(localSection.length, 16)
  endRecord.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([localSection, centralDirectory, endRecord])
}

/**
 * Reads a ZIP archive buffer produced by {@link createZipArchive}, verifying each
 * entry's CRC-32, and returns a map of entry name to decompressed bytes.
 *
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>}
 */
function readZipArchive(buffer) {
  const entries = new Map()
  let cursor = 0

  while (cursor + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(cursor)
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
      break
    }

    const compressionMethod = buffer.readUInt16LE(cursor + 8)
    const expectedCrc = buffer.readUInt32LE(cursor + 14)
    const compressedSize = buffer.readUInt32LE(cursor + 18)
    const nameLength = buffer.readUInt16LE(cursor + 26)
    const extraLength = buffer.readUInt16LE(cursor + 28)

    const nameStart = cursor + 30
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength)
    const dataStart = nameStart + nameLength + extraLength
    const payload = buffer.subarray(dataStart, dataStart + compressedSize)

    let data
    if (compressionMethod === COMPRESSION_STORE) {
      data = Buffer.from(payload)
    } else if (compressionMethod === COMPRESSION_DEFLATE) {
      data = zlib.inflateRawSync(payload)
    } else {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for entry ${name}.`)
    }

    if (crc32(data) !== expectedCrc) {
      throw new Error(`ZIP archive entry ${name} failed CRC-32 verification (archive is corrupt).`)
    }

    entries.set(name, data)
    cursor = dataStart + compressedSize
  }

  return entries
}

module.exports = {
  crc32,
  createZipArchive,
  readZipArchive,
}
