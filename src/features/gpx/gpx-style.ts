const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

export const DEFAULT_GPX_TRACK_COLOR = '#F59E0B'

/**
 * Returns the operator-selected GPX colour from import metadata, falling back
 * to the standard amber GPX track colour for older imports.
 */
export function getGpxImportColor(metadataJson: string | null): string {
  const metadata = parseGpxMetadata(metadataJson)
  const color = metadata.color
  return typeof color === 'string' && HEX_COLOR_PATTERN.test(color)
    ? color.toUpperCase()
    : DEFAULT_GPX_TRACK_COLOR
}

/**
 * Merges a GPX colour update into the existing parser metadata without
 * disturbing track counts or other future metadata keys.
 */
export function writeGpxImportColorMetadata(metadataJson: string | null, color: string): string {
  const normalizedColor = normalizeGpxColor(color)
  return JSON.stringify({
    ...parseGpxMetadata(metadataJson),
    color: normalizedColor,
  })
}

function normalizeGpxColor(color: string): string {
  const trimmed = color.trim()
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  if (!HEX_COLOR_PATTERN.test(withHash)) {
    throw new Error('GPX track colour must be a 6-digit hex value.')
  }
  return withHash.toUpperCase()
}

function parseGpxMetadata(metadataJson: string | null): Record<string, unknown> {
  if (metadataJson === null || metadataJson.trim() === '') {
    return {}
  }

  try {
    const parsed = JSON.parse(metadataJson) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...parsed }
      : {}
  } catch {
    return {}
  }
}
