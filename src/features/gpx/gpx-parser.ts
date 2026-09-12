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
  const root = document.documentElement
  const namespace = root.namespaceURI ?? ''
  if (document.doctype !== null) throw new Error('GPX document type is not supported.')
  if (root.localName !== 'gpx'
    || !['', 'http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1'].includes(namespace)) {
    throw new Error('GPX document root is not supported.')
  }

  const points: ParsedGpxPoint[] = []
  const rejections: GpxEvidenceRejection[] = []
  const segments: (readonly [number, number])[][] = []

  validateTrackStructure(root, namespace)

  const trackSegments = directChildren(root, 'trk').flatMap((track) => {
    readScalar(track, 'name')
    return directChildren(track, 'trkseg')
  })
  for (const [segmentIndex, segment] of trackSegments.entries()) {
    const trackName = readTrackName(segment)
    const geometryPoints: (readonly [number, number])[] = []

    for (const [pointIndex, point] of directChildren(segment, 'trkpt').entries()) {
      const elevationSource = readScalar(point, 'ele')
      const timestampSource = readScalar(point, 'time')
      const latSource = point.getAttribute('lat')
      const lonSource = point.getAttribute('lon')
      const lat = parseGpxDecimal(latSource)
      const lon = parseGpxDecimal(lonSource)
      if (
        lat === null || lon === null
        || lat < -90 || lat > 90 || lon < -180 || lon > 180
      ) {
        rejections.push({
          kind: 'point', segmentIndex, pointIndex, reason: 'invalid_coordinates',
          sourceValue: `lat=${latSource ?? ''};lon=${lonSource ?? ''}`,
        })
        continue
      }

      const elevation = parseGpxDecimal(elevationSource)
      if (elevationSource !== null && elevation === null) {
        rejections.push({ kind: 'point', segmentIndex, pointIndex, reason: 'invalid_elevation', sourceValue: elevationSource })
      }

      const timestamp = parseExplicitGpxTimestamp(timestampSource)
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

/** Refuses malformed track geometry as a whole source; extensions remain opaque vendor data. */
function validateTrackStructure(root: Element, namespace: string): void {
  const expectedParents: Readonly<Record<string, string>> = { trk: 'gpx', trkseg: 'trk', trkpt: 'trkseg' }
  const pending = [...root.children].reverse()
  while (pending.length > 0) {
    const element = pending.pop()!
    if (element.localName === 'extensions') continue
    const expectedParent = expectedParents[element.localName]
    if (expectedParent !== undefined) {
      if ((element.namespaceURI ?? '') !== namespace) {
        throw new Error(`GPX namespace_mismatch: ${element.localName}.`)
      }
      let ancestor = element.parentElement
      let expected: string | undefined = expectedParent
      while (expected !== undefined && ancestor !== root && ancestor?.localName === expected
        && (ancestor.namespaceURI ?? '') === namespace) {
        expected = expectedParents[expected]
        ancestor = ancestor.parentElement
      }
      if (ancestor !== root || expected !== 'gpx') {
        throw new Error(`GPX non_canonical_structure: ${element.localName}.`)
      }
    }
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      const child = element.children.item(index)
      if (child !== null) pending.push(child)
    }
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

/** Reads only the owning track's direct canonical name. */
function readTrackName(segment: Element): string | null {
  const value = segment.parentElement === null ? '' : readScalar(segment.parentElement, 'name') ?? ''
  return value.length === 0 ? null : value
}

/** Selects direct children in the parent's canonical GPX namespace. */
function directChildren(parent: Element, name: string): Element[] {
  return [...parent.children].filter((child) => child.localName === name && child.namespaceURI === parent.namespaceURI)
}

/** Rejects ambiguous scalars instead of flattening nested markup or choosing a duplicate. */
function readScalar(parent: Element, name: string): string | null {
  const children = directChildren(parent, name)
  if (children.length > 1 || (children[0]?.children.length ?? 0) > 0) {
    throw new Error(`GPX ${name} must be a single text value.`)
  }
  return children[0]?.textContent?.trim() ?? null
}

/** Removes the final filename extension for presentation only. */
function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
import {
  parseExplicitGpxTimestamp,
  parseGpxDecimal,
} from '../../../shared/gpx-source-scalars.mjs'
