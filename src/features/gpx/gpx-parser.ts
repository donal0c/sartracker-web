export type GpxEvidenceTimingClass = 'fully_dated' | 'partially_dated' | 'undated'

export type ParsedGpxPoint = {
  readonly segmentIndex: number
  readonly pointIndex: number
  readonly trackName: string | null
  readonly lat: number
  readonly lon: number
  readonly elevation: number | null
  readonly timestamp: string | null
}

export type GpxEvidenceRejection = {
  readonly kind: 'point' | 'segment'
  readonly segmentIndex: number
  readonly pointIndex: number | null
  readonly reason: 'invalid_coordinates' | 'invalid_elevation' | 'invalid_timestamp' | 'insufficient_segment_points'
  readonly sourceValue: string | null
}

export type ParsedGpxFile = {
  readonly sourcePath: string
  readonly fileName: string
  readonly displayName: string
  readonly geometryJson: string
  readonly trackCount: number
  readonly pointCount: number
  readonly timingClass: GpxEvidenceTimingClass
  readonly points: readonly ParsedGpxPoint[]
  readonly rejections: readonly GpxEvidenceRejection[]
  readonly metadataJson: string
}

type ParseGpxFileInput = {
  readonly sourcePath: string
  readonly fileName: string
  readonly contents: string
}

type DigestGpxSourceInput = {
  readonly contents?: string
  readonly bytesBase64?: string
}

/**
 * Parses a GPX document without synthesising source times or silently dropping
 * rejected evidence. Point indexes always refer to the original source order.
 */
export function parseGpxFile(input: ParseGpxFileInput): ParsedGpxFile {
  const document = new DOMParser().parseFromString(input.contents, 'application/xml')
  const parserError = document.querySelector('parsererror')
  if (parserError !== null) {
    throw new Error(`GPX file could not be parsed: ${input.fileName}`)
  }

  const points: ParsedGpxPoint[] = []
  const rejections: GpxEvidenceRejection[] = []
  const segments: (readonly [number, number])[][] = []

  for (const [segmentIndex, segment] of [...document.querySelectorAll('trkseg')].entries()) {
    const trackName = readTrackName(segment)
    const geometryPoints: (readonly [number, number])[] = []

    for (const [pointIndex, point] of [...segment.querySelectorAll('trkpt')].entries()) {
      const latSource = point.getAttribute('lat')
      const lonSource = point.getAttribute('lon')
      const lat = Number(latSource)
      const lon = Number(lonSource)
      if (
        latSource === null || lonSource === null || !Number.isFinite(lat) || !Number.isFinite(lon)
        || lat < -90 || lat > 90 || lon < -180 || lon > 180
      ) {
        rejections.push({
          kind: 'point', segmentIndex, pointIndex, reason: 'invalid_coordinates',
          sourceValue: `lat=${latSource ?? ''};lon=${lonSource ?? ''}`,
        })
        continue
      }

      const elevationSource = point.querySelector('ele')?.textContent?.trim() ?? null
      const elevationValue = elevationSource === null ? null : Number(elevationSource)
      const elevation = elevationValue !== null && Number.isFinite(elevationValue) ? elevationValue : null
      if (elevationSource !== null && elevation === null) {
        rejections.push({ kind: 'point', segmentIndex, pointIndex, reason: 'invalid_elevation', sourceValue: elevationSource })
      }

      const timestampSource = point.querySelector('time')?.textContent?.trim() ?? null
      const timestampValue = timestampSource === null ? null : new Date(timestampSource)
      const timestamp = timestampValue !== null && Number.isFinite(timestampValue.getTime())
        ? timestampValue.toISOString()
        : null
      if (timestampSource !== null && timestamp === null) {
        rejections.push({ kind: 'point', segmentIndex, pointIndex, reason: 'invalid_timestamp', sourceValue: timestampSource })
      }

      points.push({ segmentIndex, pointIndex, trackName, lat, lon, elevation, timestamp })
      geometryPoints.push([lon, lat])
    }

    if (geometryPoints.length >= 2) {
      segments.push(geometryPoints)
    } else {
      rejections.push({
        kind: 'segment', segmentIndex, pointIndex: null, reason: 'insufficient_segment_points',
        sourceValue: String(geometryPoints.length),
      })
    }
  }

  if (segments.length === 0) {
    throw new Error('GPX file does not contain any track segments.')
  }

  const datedPointCount = points.filter((point) => point.timestamp !== null).length
  const timingClass: GpxEvidenceTimingClass = datedPointCount === 0
    ? 'undated'
    : datedPointCount === points.length ? 'fully_dated' : 'partially_dated'
  const displayName = stripFileExtension(input.fileName)

  return {
    sourcePath: input.sourcePath,
    fileName: input.fileName,
    displayName,
    geometryJson: JSON.stringify({ type: 'MultiLineString', coordinates: segments }),
    trackCount: segments.length,
    pointCount: points.length,
    timingClass,
    points,
    rejections,
    metadataJson: JSON.stringify({
      trackCount: segments.length, pointCount: points.length, rejectionCount: rejections.length,
      timingClass, fileName: input.fileName, sourcePath: input.sourcePath,
    }),
  }
}

/** Returns the SHA-256 digest of the exact supplied source bytes. */
export async function digestGpxSource(input: DigestGpxSourceInput): Promise<string> {
  if (input.contents === undefined && input.bytesBase64 === undefined) {
    throw new Error('GPX source bytes are required for evidence hashing.')
  }
  const bytes = input.bytesBase64 === undefined
    ? new TextEncoder().encode(input.contents)
    : Uint8Array.from(atob(input.bytesBase64), (character) => character.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function readTrackName(segment: Element): string | null {
  const value = segment.closest('trk')?.querySelector('name')?.textContent?.trim() ?? ''
  return value.length === 0 ? null : value
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
