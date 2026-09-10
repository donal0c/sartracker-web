/**
 * Derive the ELF64 little-endian x64 type-2 AppImage filesystem boundary without
 * executing its runtime. Require SquashFS exactly after the ELF section extent;
 * reject unfamiliar/truncated layouts instead of searching for arbitrary magic.
 */
export function appImageSquashfsOffset(bytes) {
  if (bytes.length < 64 || !bytes.subarray(0, 7).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]))
    || !bytes.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 2])) || bytes.readUInt16LE(18) !== 62) {
    throw new Error('Expected an ELF64 little-endian x64 type-2 AppImage.')
  }
  /** Convert bounded file offsets without unsafe integer truncation. */
  function bounded(value) {
    if (value < 0n || value > BigInt(bytes.length - 4)) throw new Error('AppImage ELF offset is out of bounds.')
    return Number(value)
  }
  const table = bounded(bytes.readBigUInt64LE(40))
  const size = bytes.readUInt16LE(58)
  const count = bytes.readUInt16LE(60)
  if (size !== 64 || count === 0 || table < 64) throw new Error('Unrecognized AppImage ELF section table.')
  let end = bounded(BigInt(table) + BigInt(size) * BigInt(count))
  for (let index = 0; index < count; index += 1) {
    const section = table + index * size
    const type = bytes.readUInt32LE(section + 4)
    if (type === 0 || type === 8) continue // NULL and NOBITS carry no file data.
    end = Math.max(end, bounded(bytes.readBigUInt64LE(section + 24) + bytes.readBigUInt64LE(section + 32)))
  }
  if (bytes.subarray(end, end + 4).toString() !== 'hsqs') throw new Error('SquashFS is absent at the AppImage ELF boundary.')
  return end
}
