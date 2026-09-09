import { describe, expect, it } from 'vitest'
import { appImageSquashfsOffset } from '../../build/appimage-offset.js'

/** Construct only an ELF header/table and SquashFS magic, never executable code. */
function fixture() {
  const bytes = Buffer.alloc(256)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
  bytes.set([0x41, 0x49, 2], 8)
  bytes.writeUInt16LE(62, 18)
  bytes.writeBigUInt64LE(64n, 40)
  bytes.writeUInt16LE(64, 58)
  bytes.writeUInt16LE(1, 60)
  bytes.write('hsqs', 128)
  return bytes
}

describe('non-executing AppImage extraction [DON-146]', () => {
  it('derives the filesystem offset from bounded ELF sections', () => {
    expect(appImageSquashfsOffset(fixture())).toBe(128)
  })
  it('includes section data after the section table', () => {
    const bytes = fixture()
    bytes.writeUInt32LE(1, 68)
    bytes.writeBigUInt64LE(128n, 88)
    bytes.writeBigUInt64LE(32n, 96)
    bytes.write('hsqs', 160)
    expect(appImageSquashfsOffset(bytes)).toBe(160)
  })
  it('rejects every truncated section-table boundary before attempting field reads', () => {
    for (let length = 64; length < 132; length += 1) {
      expect(() => appImageSquashfsOffset(fixture().subarray(0, length))).toThrow('AppImage ELF offset is out of bounds.')
    }
  })
  it('refuses malformed, missing, wrong-format and out-of-bounds filesystems', () => {
    expect(() => appImageSquashfsOffset(Buffer.alloc(12))).toThrow()
    const missing = fixture(); missing.fill(0, 128)
    expect(() => appImageSquashfsOffset(missing)).toThrow(/SquashFS/)
    const oversized = fixture(); oversized.writeBigUInt64LE(2n ** 63n, 40)
    expect(() => appImageSquashfsOffset(oversized)).toThrow(/bounds/)
    const wrong = fixture(); wrong[4] = 1
    expect(() => appImageSquashfsOffset(wrong)).toThrow(/ELF/)
  })
})
