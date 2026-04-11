import type { SeedPoint } from './types.js'

/**
 * Parses the Glenagenty-format CSV into normalized seed points.
 * The CSV has a preamble section (report metadata) followed by a
 * header row starting with "Valid" and then data rows.
 */
export function parseSeedCsv(csvContent: string): SeedPoint[] {
  const lines = csvContent.split('\n').map((line) => line.trim())

  const headerIndex = lines.findIndex(
    (line) => line.startsWith('Valid,') || line.startsWith('Valid\t'),
  )
  if (headerIndex === -1) {
    throw new Error('CSV header row not found (expected "Valid,Time,...")')
  }

  const dataLines = lines.slice(headerIndex + 1).filter((line) => line.length > 0)
  if (dataLines.length === 0) {
    throw new Error('No data rows found in CSV')
  }

  const points: Array<{
    timestamp: number
    latitude: number
    longitude: number
    altitude: number
    speed: number
    batteryLevel: number
    distance: number
    motion: boolean
  }> = []

  for (const line of dataLines) {
    const cols = splitCsvLine(line)
    if (cols.length < 8) continue

    const valid = cols[0].toUpperCase()
    if (valid !== 'TRUE') continue

    const timestamp = Date.parse(cols[1].replace(' ', 'T') + 'Z')
    if (Number.isNaN(timestamp)) continue

    const latitude = parseFloat(cols[2])
    const longitude = parseFloat(cols[3])
    const altitude = parseAltitude(cols[4])
    const speed = parseSpeed(cols[5])
    const attrs = parseAttributes(cols[7])

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue

    points.push({
      timestamp,
      latitude,
      longitude,
      altitude,
      speed,
      batteryLevel: attrs.batteryLevel ?? 95,
      distance: attrs.distance ?? 0,
      motion: attrs.motion ?? speed > 0.3,
    })
  }

  if (points.length === 0) {
    throw new Error('No valid data points parsed from CSV')
  }

  const firstTimestamp = points[0].timestamp

  return points.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: point.altitude,
    speed: point.speed,
    relativeMs: point.timestamp - firstTimestamp,
    batteryLevel: point.batteryLevel,
    distance: point.distance,
    motion: point.motion,
  }))
}

/** Parse "193 m" → 193 */
function parseAltitude(raw: string): number {
  const value = parseFloat(raw.replace(/\s*m\s*$/i, ''))
  return Number.isFinite(value) ? value : 0
}

/** Parse "0.4 kn" → 0.4 */
function parseSpeed(raw: string): number {
  const value = parseFloat(raw.replace(/\s*kn\s*$/i, ''))
  return Number.isFinite(value) ? value : 0
}

/** Parse "batteryLevel=98.0  distance=25.07  totalDistance=607086.36  motion=true" */
function parseAttributes(raw: string): {
  batteryLevel?: number
  distance?: number
  totalDistance?: number
  motion?: boolean
} {
  const result: Record<string, string> = {}
  const pairs = raw.split(/\s{2,}/)

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex > 0) {
      const key = pair.slice(0, eqIndex).trim()
      const value = pair.slice(eqIndex + 1).trim()
      result[key] = value
    }
  }

  return {
    batteryLevel: result['batteryLevel'] ? parseFloat(result['batteryLevel']) : undefined,
    distance: result['distance'] ? parseFloat(result['distance']) : undefined,
    totalDistance: result['totalDistance'] ? parseFloat(result['totalDistance']) : undefined,
    motion: result['motion'] ? result['motion'] === 'true' : undefined,
  }
}

/**
 * Split a CSV line, handling quoted fields.
 * The Glenagenty CSV uses double-quote wrapping for the Address column.
 */
function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  result.push(current)
  return result
}
