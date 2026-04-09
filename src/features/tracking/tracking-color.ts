/**
 * Creates a deterministic visible color for a tracked device id.
 */
export function createDeviceColor(deviceId: string): string {
  const seed = createStableHash(deviceId)
  const red = 50 + (seed & 0x7f)
  const green = 50 + ((seed >> 8) & 0x7f)
  const blue = 50 + ((seed >> 16) & 0x7f)

  return toHexColor(red, green, blue)
}

function createStableHash(value: string): number {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function toHexColor(red: number, green: number, blue: number): string {
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function toHex(channel: number): string {
  return channel.toString(16).padStart(2, '0').toUpperCase()
}
