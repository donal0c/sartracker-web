/**
 * Segmented, OS-style map scale bar (DON-369).
 *
 * The total distance and drawn width come from `buildMapScaleReadout`, the
 * DON-339 oracle, unchanged. This module only divides that bar into equal
 * alternating blocks and places labelled ticks at 0, half and the full
 * distance, so the segmented bar is exactly as accurate as the plain one.
 */
import { buildMapScaleReadout } from './map-scale-readout'

/** Equal alternating black and white blocks drawn along the bar. */
export const MAP_SCALE_BAR_SEGMENT_COUNT = 4

const MIN_MAX_WIDTH_PX = 96
const MAX_MAX_WIDTH_PX = 200
/** Share of the map width the bar may take, so it shrinks beside a docked panel. */
const MAP_WIDTH_SHARE = 0.3

/** Approximate advance of one character of the 13 px bold monospace tick label. */
const LABEL_CHAR_WIDTH_PX = 8
/** Clear space kept between two neighbouring tick labels. */
const LABEL_GAP_PX = 4

export type MapScaleBarUnit = 'm' | 'km'

export type MapScaleBarSegment = {
  readonly offsetPx: number
  readonly widthPx: number
  /** True for a black block, false for a white one. */
  readonly filled: boolean
}

export type MapScaleBarTick = {
  readonly distanceM: number
  readonly offsetPx: number
  /** The number only; the bar shows its unit once, after the last tick. */
  readonly label: string
  /** False when the label would collide with a neighbour on a short bar. */
  readonly labelVisible: boolean
}

export type MapScaleBar = {
  readonly totalDistanceM: number
  /** The DON-339 readout label for the whole bar, for example "500 m". */
  readonly totalLabel: string
  readonly widthPx: number
  readonly unit: MapScaleBarUnit
  readonly segments: readonly MapScaleBarSegment[]
  readonly ticks: readonly MapScaleBarTick[]
}

export type BuildMapScaleBarInput = {
  readonly latitude: number
  readonly zoom: number
  readonly maxWidthPx: number
}

/**
 * Chooses how wide the bar may be for a map of the given width: about 30% of
 * the map, between 96 and 200 px, so it stays clear of the panels on a narrow map.
 * Returns null for a map with no measurable width: there is no safe guess.
 */
export function chooseMapScaleBarMaxWidth(mapWidthPx: number): number | null {
  if (!Number.isFinite(mapWidthPx) || mapWidthPx <= 0) {
    return null
  }

  return Math.max(MIN_MAX_WIDTH_PX, Math.min(MAX_MAX_WIDTH_PX, Math.round(mapWidthPx * MAP_WIDTH_SHARE)))
}

/**
 * Builds the segmented bar for the current camera, or null when the camera
 * cannot be measured (the bar is then not drawn rather than drawn wrong).
 */
export function buildMapScaleBar(input: BuildMapScaleBarInput): MapScaleBar | null {
  if (!isMeasurableCamera(input.latitude, input.zoom) || !Number.isFinite(input.maxWidthPx) || input.maxWidthPx <= 0) {
    return null
  }

  const readout = buildMapScaleReadout({
    latitude: input.latitude,
    zoom: input.zoom,
    targetWidthPx: input.maxWidthPx,
  })
  if (!(readout.distanceM > 0) || !(readout.widthPx > 0)) {
    return null
  }

  const unit: MapScaleBarUnit = readout.distanceM >= 1_000 ? 'km' : 'm'
  const segmentWidthPx = readout.widthPx / MAP_SCALE_BAR_SEGMENT_COUNT
  const segments = Array.from({ length: MAP_SCALE_BAR_SEGMENT_COUNT }, (_, index) => ({
    offsetPx: index * segmentWidthPx,
    widthPx: segmentWidthPx,
    filled: index % 2 === 0,
  }))

  const placeTick = (distanceM: number) => ({
    distanceM,
    offsetPx: (distanceM / readout.distanceM) * readout.widthPx,
    label: formatTickNumber(distanceM, unit),
  })
  const start = placeTick(0)
  const middle = placeTick(readout.distanceM / 2)
  const end = placeTick(readout.distanceM)
  const middleVisible =
    labelsClear(start.label, start.offsetPx, middle.label, middle.offsetPx) &&
    labelsClear(middle.label, middle.offsetPx, end.label, end.offsetPx)

  return {
    totalDistanceM: readout.distanceM,
    totalLabel: readout.label,
    widthPx: readout.widthPx,
    unit,
    segments,
    ticks: [
      { ...start, labelVisible: true },
      { ...middle, labelVisible: middleVisible },
      { ...end, labelVisible: true },
    ],
  }
}

/** Shown on the map, in place of the bar, whenever the scale cannot be measured. */
export const MAP_SCALE_UNAVAILABLE_MESSAGE = 'Map scale unavailable'

export type MapScaleState =
  | { readonly status: 'ready'; readonly bar: MapScaleBar }
  | { readonly status: 'unavailable'; readonly message: string; readonly reason: string }

export type DescribeMapScaleInput = {
  readonly latitude: number
  readonly zoom: number
  readonly mapWidthPx: number
  /** The live map's own zoom limits; a zoom outside them is not measured. */
  readonly minZoom: number
  readonly maxZoom: number
}

/**
 * What the map scale should show for the live map: the bar, or, when the camera
 * or map width cannot be measured, a visible "Map scale unavailable" with the reason.
 */
export function describeMapScale(input: DescribeMapScaleInput): MapScaleState {
  const maxWidthPx = chooseMapScaleBarMaxWidth(input.mapWidthPx)
  if (maxWidthPx === null) {
    return unavailable(`map width ${String(input.mapWidthPx)} px cannot be measured`)
  }
  if (!isMeasurableCamera(input.latitude, input.zoom)) {
    return unavailable(`camera latitude ${String(input.latitude)}, zoom ${String(input.zoom)} cannot be measured`)
  }
  if (!(input.zoom >= input.minZoom && input.zoom <= input.maxZoom)) {
    return unavailable(`zoom ${input.zoom} is outside the map's limits ${String(input.minZoom)}-${String(input.maxZoom)}`)
  }
  const bar = buildMapScaleBar({ latitude: input.latitude, zoom: input.zoom, maxWidthPx })
  return bar === null
    ? unavailable(`no scale distance fits ${maxWidthPx} px at zoom ${input.zoom}`)
    : { status: 'ready', bar }
}

/** Builds the unavailable state with its reason for the log. */
function unavailable(reason: string): MapScaleState {
  return { status: 'unavailable', message: MAP_SCALE_UNAVAILABLE_MESSAGE, reason }
}

/** Web Mercator, and so MapLibre, cannot show a latitude beyond this. */
const WEB_MERCATOR_MAX_LATITUDE = 85.051129

/**
 * True for a latitude the map can show and a real, non-negative zoom. The DON-339
 * readout would otherwise measure a NaN latitude at the equator, or clamp 90° to 85°.
 */
function isMeasurableCamera(latitude: number, zoom: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= WEB_MERCATOR_MAX_LATITUDE &&
    Number.isFinite(zoom) &&
    zoom >= 0
  )
}

/**
 * Formats a tick distance as a bare number in the bar's unit: "250", "2.5".
 */
function formatTickNumber(distanceM: number, unit: MapScaleBarUnit): string {
  const value = unit === 'km' ? distanceM / 1_000 : distanceM
  // Ticks are halves of 1, 2 or 5 times a power of ten, so three significant figures are exact.
  return String(Number(value.toPrecision(3)))
}

/**
 * True when two labels centred on their ticks leave a clear gap between them.
 */
function labelsClear(leftLabel: string, leftPx: number, rightLabel: string, rightPx: number): boolean {
  const leftEdge = leftPx + (leftLabel.length * LABEL_CHAR_WIDTH_PX) / 2
  const rightEdge = rightPx - (rightLabel.length * LABEL_CHAR_WIDTH_PX) / 2
  return rightEdge - leftEdge >= LABEL_GAP_PX
}
