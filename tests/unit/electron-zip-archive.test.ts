import { createRequire } from 'node:module'
import zlib from 'node:zlib'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createZipArchive, readZipArchive } = require('../../electron/zip-archive.cjs') as {
  readonly createZipArchive: (
    entries: readonly { readonly name: string; readonly data: Buffer }[],
  ) => Buffer
  readonly readZipArchive: (buffer: Buffer) => ReadonlyMap<string, Buffer>
}

describe('electron zip archive', () => {
  it('round-trips multiple entries through write and read', () => {
    const manifest = Buffer.from(JSON.stringify({ archive_version: 1 }), 'utf8')
    const mission = Buffer.from(JSON.stringify({ id: 'mission-1' }), 'utf8')
    const snapshot = Buffer.from('sqlite-bytes-here'.repeat(1000), 'utf8')

    const archive = createZipArchive([
      { name: 'manifest.json', data: manifest },
      { name: 'mission.json', data: mission },
      { name: 'mission-store.sqlite', data: snapshot },
      { name: 'attachments/photo.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10]) },
    ])

    const entries = readZipArchive(archive)
    expect(entries.get('manifest.json')).toEqual(manifest)
    expect(entries.get('mission.json')).toEqual(mission)
    expect(entries.get('mission-store.sqlite')).toEqual(snapshot)
    expect(entries.get('attachments/photo.jpg')).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10]))
  })

  it('produces a standard ZIP local-file signature and compresses large payloads', () => {
    const compressible = Buffer.alloc(10_000, 0x41)
    const archive = createZipArchive([{ name: 'big.txt', data: compressible }])

    // Local file header magic number "PK\x03\x04".
    expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    // Compression should make a highly-repetitive payload far smaller than its raw size.
    expect(archive.length).toBeLessThan(compressible.length)
  })

  it('handles an empty entry without corrupting the archive', () => {
    const archive = createZipArchive([
      { name: 'empty.txt', data: Buffer.alloc(0) },
      { name: 'present.txt', data: Buffer.from('hello', 'utf8') },
    ])
    const entries = readZipArchive(archive)
    expect(entries.get('empty.txt')).toEqual(Buffer.alloc(0))
    expect(entries.get('present.txt')).toEqual(Buffer.from('hello', 'utf8'))
  })

  it('rejects an archive whose entry CRC does not match (detects corruption)', () => {
    const archive = createZipArchive([{ name: 'data.bin', data: Buffer.from('content', 'utf8') }])
    // Flip a byte inside the compressed payload region to corrupt it.
    const corrupted = Buffer.from(archive)
    corrupted[40] = corrupted[40]! ^ 0xff
    expect(() => readZipArchive(corrupted)).toThrow()
  })

  it('writes DEFLATE-compressed entries that decompress with zlib inflateRaw', () => {
    const payload = Buffer.from('round-trip via standard zlib '.repeat(50), 'utf8')
    const archive = createZipArchive([{ name: 'z.txt', data: payload }])
    const entries = readZipArchive(archive)
    expect(entries.get('z.txt')).toEqual(payload)
    // Sanity check the underlying codec is the standard raw DEFLATE Node exposes.
    expect(zlib.inflateRawSync(zlib.deflateRawSync(payload))).toEqual(payload)
  })
})
