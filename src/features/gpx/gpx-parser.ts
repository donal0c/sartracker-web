export type ParsedGpxFile = {
  readonly sourcePath: string
  readonly fileName: string
  readonly displayName: string
  readonly geometryJson: string
  readonly trackCount: number
  readonly pointCount: number
  readonly metadataJson: string
}

type ParseGpxFileInput = {
  readonly sourcePath: string
  readonly fileName: string
  readonly contents: string
}

/**
 * Parses a GPX document into a consolidated mission-safe multi-line geometry.
 */
export function parseGpxFile(input: ParseGpxFileInput): ParsedGpxFile {
  const document = new DOMParser().parseFromString(input.contents, 'application/xml')
  const parserError = document.querySelector('parsererror')
  if (parserError !== null) {
    throw new Error(`GPX file could not be parsed: ${input.fileName}`)
  }

  const segments = [...document.querySelectorAll('trkseg')]
    .map((segment) =>
      [...segment.querySelectorAll('trkpt')]
        .map((point) => {
          const lat = Number(point.getAttribute('lat'))
          const lon = Number(point.getAttribute('lon'))
          return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] as const : null
        })
        .filter((point): point is readonly [number, number] => point !== null),
    )
    .filter((segment) => segment.length >= 2)

  if (segments.length === 0) {
    throw new Error('GPX file does not contain any track segments.')
  }

  const displayName = stripFileExtension(input.fileName)
  const pointCount = segments.reduce((count, segment) => count + segment.length, 0)

  return {
    sourcePath: input.sourcePath,
    fileName: input.fileName,
    displayName,
    geometryJson: JSON.stringify({
      type: 'MultiLineString',
      coordinates: segments,
    }),
    trackCount: segments.length,
    pointCount,
    metadataJson: JSON.stringify({
      trackCount: segments.length,
      pointCount,
      fileName: input.fileName,
      sourcePath: input.sourcePath,
    }),
  }
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
