/** Maximum UTF-8 bytes permitted for a mission name across creation and cleanup. */
export const MAX_MISSION_NAME_BYTES = 1_024

/** Returns whether a mission name fits the bounded operator-facing contract. */
export function isMissionNameWithinBound(value: string): boolean {
  return typeof value === 'string'
    && value.trim() !== ''
    && value.length <= MAX_MISSION_NAME_BYTES
    && new TextEncoder().encode(value).byteLength <= MAX_MISSION_NAME_BYTES
    && !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
    })
}
