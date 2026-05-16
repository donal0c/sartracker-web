import type { Drawing } from '../../../infrastructure/mission-store/tauri-mission-store'
import type { DrawingDraft, DrawingMetadata, PersistedDrawing } from '../drawing-types'
import type { LonLat } from '../drawing-math'

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i

export type BuildDrawingInputArgs = {
  readonly missionId: string
  readonly displayOrder: number
  readonly draft: DrawingDraft
}

/**
 * Parses the stored geometry and metadata payloads for an editable drawing.
 */
export function parsePersistedDrawing(drawing: Drawing): PersistedDrawing {
  return {
    ...drawing,
    parsedGeometry: JSON.parse(drawing.geometry_json) as GeoJSON.Geometry,
    metadata:
      drawing.metadata_json === null ? null : (JSON.parse(drawing.metadata_json) as DrawingMetadata),
  }
}

/**
 * Validates that the drawing name is present before persistence.
 */
export function assertValidName(name: string): void {
  if (name.trim() === '') {
    throw new Error('Drawing name is required.')
  }
}

/**
 * Normalizes optional text fields to the persisted null-or-trimmed-string contract.
 */
export function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

/**
 * Normalizes optional numeric text fields to the persisted null-or-number contract.
 */
export function normalizeOptionalNumber(value: string): number | null {
  const normalized = value.trim()
  if (normalized === '') {
    return null
  }

  return Number(normalized)
}

/**
 * Parses a required positive numeric field for persistence.
 */
export function parseRequiredPositiveNumber(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`)
  }

  return parsed
}

/**
 * Parses a required non-negative bearing field for persistence.
 */
export function parseRequiredBearing(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be zero or greater.`)
  }

  return parsed
}

/**
 * Parses a required positive integer field for persistence.
 */
export function parseRequiredPositiveInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }

  return parsed
}

/**
 * Normalizes six-digit hex colours before storing operator-facing map styles.
 */
export function normalizeHexColor(value: string, label: string = 'Colour'): string {
  const normalized = value.trim().toUpperCase()
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a valid 6-digit hex value.`)
  }

  return normalized
}

/**
 * Returns a mutable GeoJSON coordinate tuple from a readonly lon/lat pair.
 */
export function toMutableCoordinate([lon, lat]: LonLat): [number, number] {
  return [lon, lat]
}

/**
 * Returns a validated lon/lat pair from a persisted coordinate array.
 */
export function toLonLat(coordinate: readonly number[]): LonLat {
  const [lon, lat] = coordinate
  if (typeof lon !== 'number' || typeof lat !== 'number') {
    throw new Error('Invalid drawing geometry coordinate.')
  }

  return [lon, lat]
}
