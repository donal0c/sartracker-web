import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Point } from 'geojson'

import type { Drawing } from '../../infrastructure/mission-store/tauri-mission-store'
import { geodesicBearingEndpoint, type LonLat } from './drawing-math'
import { parsePersistedDrawing } from './drawing-builders'
import type { DrawingSketchState, DrawingTool } from './drawing-types'

type DrawingFeatureProperties = GeoJsonProperties & {
  readonly featureKind: 'geometry' | 'label' | 'vertex'
  readonly drawingId: string
  readonly drawingType: Drawing['type']
  readonly strokeColor: string
  readonly fillColor: string
  readonly labelColor: string
  readonly label: string | null
  readonly fontSize: number
  readonly rotation: number
  readonly width: number
  readonly selected: boolean
}

const DEFAULT_DRAWING_STYLE: Record<
  Drawing['type'],
  {
    readonly strokeColor: string
    readonly fillColor: string
    readonly labelColor: string
    readonly width: number
  }
> = {
  line: {
    strokeColor: '#38BDF8',
    fillColor: '#38BDF833',
    labelColor: '#E0F2FE',
    width: 3,
  },
  search_area: {
    strokeColor: '#F59E0B',
    fillColor: '#F59E0B33',
    labelColor: '#FEF3C7',
    width: 2,
  },
  range_ring: {
    strokeColor: '#22C55E',
    fillColor: '#22C55E10',
    labelColor: '#DCFCE7',
    width: 2,
  },
  bearing_line: {
    strokeColor: '#A78BFA',
    fillColor: '#A78BFA20',
    labelColor: '#E9D5FF',
    width: 2,
  },
  search_sector: {
    strokeColor: '#F97316',
    fillColor: '#F9731630',
    labelColor: '#FFEDD5',
    width: 2,
  },
  text_label: {
    strokeColor: '#E7E5E4',
    fillColor: '#E7E5E410',
    labelColor: '#FAFAF9',
    width: 1,
  },
}

export function createDrawingFeatureCollection(
  drawings: readonly Drawing[],
  selectedDrawingId: string | null,
): FeatureCollection<Geometry, DrawingFeatureProperties> {
  const features: Feature<Geometry, DrawingFeatureProperties>[] = []

  for (const drawing of drawings) {
    const parsed = parsePersistedDrawing(drawing)
    const baseStyle = DEFAULT_DRAWING_STYLE[drawing.type]
    const isSelected = drawing.id === selectedDrawingId
    const strokeColor = drawing.color ?? baseStyle.strokeColor
    const fillColor = drawing.color === null ? baseStyle.fillColor : `${drawing.color}22`
    const width = drawing.width ?? baseStyle.width
    const label = drawing.label ?? drawing.name
    const labelStyle =
      parsed.metadata?.kind === 'text_label'
        ? {
            fontSize: parsed.metadata.fontSize,
            rotation: parsed.metadata.rotation,
            color: parsed.metadata.color,
          }
        : {
            fontSize: 11,
            rotation: 0,
            color: baseStyle.labelColor,
          }

    if (parsed.type === 'range_ring' && parsed.parsedGeometry.type === 'MultiPolygon') {
      const metadata = parsed.metadata?.kind === 'range_ring' ? parsed.metadata : null
      parsed.parsedGeometry.coordinates.forEach((coordinates, index) => {
        const ringStroke = metadata?.colors[index] ?? strokeColor
        const ringLabel = metadata?.labels[index] ?? label
        features.push(
          createGeometryFeature({
            drawing,
            geometry: {
              type: 'Polygon',
              coordinates,
            },
            strokeColor: ringStroke,
            fillColor: `${ringStroke}12`,
            label,
            width,
            selected: isSelected,
          }),
        )

        if (metadata !== null) {
          const radiusM = metadata.radiiM[index]
          const labelText = metadata.labels[index] ?? ringLabel
          if (radiusM !== undefined) {
            features.push(
              createLabelFeature({
                drawing,
                coordinate: geodesicBearingEndpoint(
                  metadata.center[0],
                  metadata.center[1],
                  90,
                  radiusM,
                ),
                label: labelText,
                labelColor: ringStroke,
                fontSize: 11,
                rotation: 0,
                selected: isSelected,
              }),
            )
          }
        }
      })
      continue
    }

    features.push(
      createGeometryFeature({
        drawing,
        geometry: parsed.parsedGeometry,
        strokeColor,
        fillColor,
        label,
        width,
        selected: isSelected,
      }),
    )

    const labelCoordinate = resolveLabelCoordinate(parsed)
    if (labelCoordinate !== null) {
      features.push(
        createLabelFeature({
          drawing,
          coordinate: labelCoordinate,
          label,
          labelColor: labelStyle.color,
          fontSize: labelStyle.fontSize,
          rotation: labelStyle.rotation,
          selected: isSelected,
        }),
      )
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

export function createDrawingPreviewFeatureCollection(
  sketch: DrawingSketchState,
  activeTool: DrawingTool,
): FeatureCollection<Geometry, DrawingFeatureProperties> {
  if (sketch === null || sketch.points.length === 0) {
    return emptyFeatureCollection()
  }

  if (sketch.tool === 'line') {
    return {
      type: 'FeatureCollection',
      features: [
        createPreviewFeature(
          {
            type: 'LineString',
            coordinates: sketch.points.map(toMutableCoordinate),
          },
          'line',
        ),
        ...sketch.points.map((point, index) => createPreviewVertexFeature(point, sketch.tool, index)),
      ],
    }
  }

  if (sketch.tool === 'search_area') {
    const polygonCoordinates =
      sketch.points.length >= 3
        ? [closePreviewRing(sketch.points).map(toMutableCoordinate)]
        : undefined

    return {
      type: 'FeatureCollection',
      features: [
        ...(polygonCoordinates === undefined
          ? []
          : [createPreviewFeature({ type: 'Polygon', coordinates: polygonCoordinates }, 'search_area')]),
        createPreviewFeature(
          {
            type: 'LineString',
            coordinates: sketch.points.map(toMutableCoordinate),
          },
          'search_area',
        ),
        ...sketch.points.map((point, index) =>
          createPreviewVertexFeature(point, sketch.tool, index),
        ),
      ],
    }
  }

  return activeTool === 'select' ? emptyFeatureCollection() : emptyFeatureCollection()
}

function createGeometryFeature(args: {
  readonly drawing: Drawing
  readonly geometry: Geometry
  readonly strokeColor: string
  readonly fillColor: string
  readonly label: string | null
  readonly width: number
  readonly selected: boolean
}): Feature<Geometry, DrawingFeatureProperties> {
  return {
    type: 'Feature',
    geometry: args.geometry,
    properties: {
      featureKind: 'geometry',
      drawingId: args.drawing.id,
      drawingType: args.drawing.type,
      strokeColor: args.strokeColor,
      fillColor: args.fillColor,
      labelColor: DEFAULT_DRAWING_STYLE[args.drawing.type].labelColor,
      label: args.label,
      fontSize: 11,
      rotation: 0,
      width: args.width,
      selected: args.selected,
    },
  }
}

function createLabelFeature(args: {
  readonly drawing: Drawing
  readonly coordinate: LonLat
  readonly label: string | null
  readonly labelColor: string
  readonly fontSize: number
  readonly rotation: number
  readonly selected: boolean
}): Feature<Point, DrawingFeatureProperties> {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: toMutableCoordinate(args.coordinate),
    },
    properties: {
      featureKind: 'label',
      drawingId: args.drawing.id,
      drawingType: args.drawing.type,
      strokeColor: DEFAULT_DRAWING_STYLE[args.drawing.type].strokeColor,
      fillColor: DEFAULT_DRAWING_STYLE[args.drawing.type].fillColor,
      labelColor: args.labelColor,
      label: args.label,
      fontSize: args.fontSize,
      rotation: args.rotation,
      width: DEFAULT_DRAWING_STYLE[args.drawing.type].width,
      selected: args.selected,
    },
  }
}

function createPreviewFeature(
  geometry: Geometry,
  drawingType: Extract<Drawing['type'], 'line' | 'search_area'>,
): Feature<Geometry, DrawingFeatureProperties> {
  const style = DEFAULT_DRAWING_STYLE[drawingType]
  return {
    type: 'Feature',
    geometry,
    properties: {
      featureKind: 'geometry',
      drawingId: '__preview__',
      drawingType,
      strokeColor: style.strokeColor,
      fillColor: style.fillColor,
      labelColor: style.labelColor,
      label: null,
      fontSize: 11,
      rotation: 0,
      width: style.width,
      selected: false,
    },
  }
}

function createPreviewVertexFeature(
  coordinate: LonLat,
  drawingType: Extract<DrawingTool, 'line' | 'search_area'>,
  index: number,
): Feature<Point, DrawingFeatureProperties> {
  const normalizedType = drawingType === 'line' ? 'line' : 'search_area'
  const style = DEFAULT_DRAWING_STYLE[normalizedType]

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: toMutableCoordinate(coordinate),
    },
    properties: {
      featureKind: 'vertex',
      drawingId: `__preview_vertex_${index}`,
      drawingType: normalizedType,
      strokeColor: style.strokeColor,
      fillColor: style.fillColor,
      labelColor: style.labelColor,
      label: null,
      fontSize: 11,
      rotation: 0,
      width: style.width,
      selected: false,
    },
  }
}

function resolveLabelCoordinate(drawing: ReturnType<typeof parsePersistedDrawing>): LonLat | null {
  if (drawing.parsedGeometry.type === 'LineString') {
    const coordinates = drawing.parsedGeometry.coordinates.map((coordinate) => toLonLat(coordinate))
    return midpointForLine(coordinates)
  }

  if (drawing.parsedGeometry.type === 'Polygon') {
    const ring = (drawing.parsedGeometry.coordinates[0] ?? []).map((coordinate) => toLonLat(coordinate))
    return centroidOfRing(ring)
  }

  if (drawing.parsedGeometry.type === 'Point') {
    return toLonLat(drawing.parsedGeometry.coordinates)
  }

  return null
}

function midpointForLine(coordinates: readonly LonLat[]): LonLat | null {
  if (coordinates.length === 0) {
    return null
  }

  const middleIndex = Math.floor(coordinates.length / 2)
  return coordinates[middleIndex] ?? coordinates[0] ?? null
}

function centroidOfRing(coordinates: readonly LonLat[]): LonLat | null {
  if (coordinates.length === 0) {
    return null
  }

  const usable = coordinates.at(-1)?.[0] === coordinates[0]?.[0] &&
    coordinates.at(-1)?.[1] === coordinates[0]?.[1]
    ? coordinates.slice(0, -1)
    : coordinates

  if (usable.length === 0) {
    return null
  }

  const sums = usable.reduce(
    (accumulator, [lon, lat]) => ({
      lon: accumulator.lon + lon,
      lat: accumulator.lat + lat,
    }),
    { lon: 0, lat: 0 },
  )

  return [sums.lon / usable.length, sums.lat / usable.length]
}

function closePreviewRing(points: readonly LonLat[]): readonly LonLat[] {
  const first = points[0]
  if (first === undefined) {
    return points
  }

  const last = points.at(-1) ?? first
  if (last[0] === first[0] && last[1] === first[1]) {
    return points
  }

  return [...points, first]
}

function emptyFeatureCollection(): FeatureCollection<Geometry, DrawingFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function toMutableCoordinate([lon, lat]: LonLat): [number, number] {
  return [lon, lat]
}

function toLonLat(coordinate: readonly number[]): LonLat {
  const [lon, lat] = coordinate
  if (typeof lon !== 'number' || typeof lat !== 'number') {
    throw new Error('Invalid drawing coordinate.')
  }

  return [lon, lat]
}
