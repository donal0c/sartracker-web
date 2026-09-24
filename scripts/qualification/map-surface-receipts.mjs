import { canonicalJson } from './control-plane.mjs'

const SOURCE_IDS = Object.freeze(['mission-markers', 'mission-drawings'])

/** Validate the independent C14 map/store identity and operator-surface receipt. */
export function validateMapSurface(report) {
  if (report?.schema !== 'sartracker-map-surface-v1' || report.contractId !== 'C14') {
    throw new Error('Map surface receipt schema or contract identity is invalid.')
  }
  if (report.developmentTestHarness === true) {
    throw new Error('Development harness map evidence cannot qualify the packaged contract.')
  }
  if (!report.cleanup?.applicationClosed || !report.cleanup?.profileRemoved) {
    throw new Error('Map surface disposable profile cleanup was not proven.')
  }
  return validateMapSurfaceFacts(report)
}

/** Validate only the pure C14 map/store and operator-surface facts. */
export function validateMapSurfaceFacts(report) {
  if (report?.schema !== 'sartracker-map-surface-v1' || report.contractId !== 'C14') {
    throw new Error('Map surface receipt schema or contract identity is invalid.')
  }
  const persistedBefore = projectPersisted(report.persisted?.before)
  const persistedAfter = projectPersisted(report.persisted?.after)
  if (persistedBefore.missionId === '' || persistedBefore.markers.length === 0 || persistedBefore.drawings.length === 0) {
    throw new Error('Map surface persisted fixture is incomplete.')
  }
  if (canonicalJson(persistedBefore) !== canonicalJson(persistedAfter)) {
    throw new Error('Map visibility or basemap interaction changed persisted evidence.')
  }
  if (report.persisted.before.digest !== report.persisted.after.digest) {
    throw new Error('Before/after persistence digest changed.')
  }

  const before = projectMapSnapshot(report.map?.before)
  const after = projectMapSnapshot(report.map?.after)
  for (const snapshot of [before, after]) {
    for (const sourceId of SOURCE_IDS) {
      const sources = snapshot.sources.filter((source) => source.id === sourceId)
      if (sources.length !== 1 || sources[0].type !== 'geojson') {
        throw new Error(`MapLibre source ${sourceId} is missing or duplicated.`)
      }
    }
  }
  assertRenderedIdentity(before, persistedBefore)
  assertRenderedIdentity(after, persistedAfter)
  if (before.basemapId === after.basemapId) {
    throw new Error('Basemap switch did not produce two distinct map identities.')
  }
  for (const sourceId of SOURCE_IDS) {
    const beforeSource = before.sources.find((source) => source.id === sourceId)
    const afterSource = after.sources.find((source) => source.id === sourceId)
    if (canonicalJson(beforeSource?.features) !== canonicalJson(afterSource?.features)) {
      throw new Error(`Basemap switch changed rendered ${sourceId} features.`)
    }
  }
  if (!before.overlayLayerIds.some((id) => id.startsWith('mission-markers-'))
      || !after.overlayLayerIds.some((id) => id.startsWith('mission-markers-'))
      || !before.overlayLayerIds.some((id) => id.startsWith('mission-drawings-'))
      || !after.overlayLayerIds.some((id) => id.startsWith('mission-drawings-'))) {
    throw new Error('Map overlay layers were not retained across the basemap switch.')
  }

  assertVisibilityReceipt(report.visibility?.marker, 'marker')
  assertVisibilityReceipt(report.visibility?.drawing, 'drawing')
  if (report.focus?.before !== false || report.focus?.activeObserved !== true
      || report.focus?.coordinateMirrorVisible !== true || report.focus?.restored !== true) {
    throw new Error('Focus mode did not expose and restore the operator coordinate surface.')
  }

  const failure = report.overlayFailure
  if (failure?.attempted !== true || failure.throwHookHit !== true
      || failure.warningRegistrationId !== 'markers'
      || typeof failure.warningText !== 'string' || !/markers\s+overlay/iu.test(failure.warningText)
      || /tile|basemap|map.*degraded/iu.test(failure.warningText)
      || failure.operatorWarningVisible !== true || failure.recoveryObserved !== true
      || failure.warningClearedAfterRecovery !== true || failure.consoleOnly === true) {
    throw new Error('Persistent marker-overlay warning was missing, console-only, failed to clear after synchronization recovery, or recovery was not proven.')
  }
  return Object.freeze({
    status: 'PASS',
    releaseEligible: false,
    scope: 'packaged map, layer, basemap, focus and overlay recovery surface; DON-264 remains independently release-blocking until observed green',
  })
}

function projectPersisted(value) {
  if (value === null || typeof value !== 'object') {
    throw new Error('Map surface persisted snapshot is missing.')
  }
  const markers = Array.isArray(value.markers) ? value.markers.map((marker) => ({
    id: requiredText(marker?.id, 'marker id'),
    type: requiredText(marker?.type, 'marker type'),
    name: requiredText(marker?.name, 'marker name'),
    lat: finiteCoordinate(marker?.lat, -90, 90, 'marker latitude'),
    lon: finiteCoordinate(marker?.lon, -180, 180, 'marker longitude'),
  })).sort(compareIdentity) : []
  const drawings = Array.isArray(value.drawings) ? value.drawings.map((drawing) => ({
    id: requiredText(drawing?.id, 'drawing id'),
    type: requiredText(drawing?.type, 'drawing type'),
    name: requiredText(drawing?.name, 'drawing name'),
    geometry: projectGeometry(drawing?.geometry),
  })).sort(compareIdentity) : []
  return {
    missionId: requiredText(value.missionId, 'mission id'),
    markers,
    drawings,
  }
}

function projectMapSnapshot(value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.sources)) {
    throw new Error('MapLibre snapshot is missing.')
  }
  return {
    basemapId: requiredText(value.basemapId, 'basemap id'),
    sources: value.sources.map((source) => ({
      id: requiredText(source?.id, 'source id'),
      type: requiredText(source?.type, 'source type'),
      features: Array.isArray(source?.features) ? source.features.map(projectFeature).sort(compareFeature) : [],
    })).sort(compareIdentity),
    overlayLayerIds: Array.isArray(value.overlayLayerIds)
      ? value.overlayLayerIds.map((id) => requiredText(id, 'overlay layer id')).sort()
      : [],
  }
}

function projectFeature(feature) {
  if (feature === null || typeof feature !== 'object') throw new Error('Rendered map feature is invalid.')
  const properties = feature.properties
  if (properties === null || typeof properties !== 'object') throw new Error('Rendered map feature properties are missing.')
  return {
    geometry: projectGeometry(feature.geometry),
    properties: {
      markerId: optionalText(properties.markerId),
      markerType: optionalText(properties.markerType),
      drawingId: optionalText(properties.drawingId),
      drawingType: optionalText(properties.drawingType),
      featureKind: optionalText(properties.featureKind),
      name: optionalText(properties.name),
    },
  }
}

/** Require exact persisted membership, including the line's optional bound label. */
function assertRenderedIdentity(snapshot, persisted) {
  const markerFeatures = snapshot.sources.find((candidate) => candidate.id === 'mission-markers').features
  const drawingFeatures = snapshot.sources.find((candidate) => candidate.id === 'mission-drawings').features
  const markerIds = new Set(persisted.markers.map((marker) => marker.id))
  const drawingIds = new Set(persisted.drawings.map((drawing) => drawing.id))
  if (markerIds.size !== persisted.markers.length || drawingIds.size !== persisted.drawings.length
      || markerFeatures.length !== persisted.markers.length
      || markerFeatures.some((feature) => !markerIds.has(feature.properties.markerId))
      || drawingFeatures.some((feature) => !drawingIds.has(feature.properties.drawingId)
        || !['geometry', 'label'].includes(feature.properties.featureKind))) {
    throw new Error('Rendered map membership contains duplicate or unbound identities.')
  }
  for (const marker of persisted.markers) {
    const features = markerFeatures.filter((candidate) => candidate.properties.markerId === marker.id)
    const feature = features[0]
    if (features.length !== 1 || feature.properties.markerType !== marker.type || feature.properties.name !== marker.name
        || canonicalJson(feature.geometry) !== canonicalJson({ type: 'Point', coordinates: [marker.lon, marker.lat] })) {
      throw new Error(`Rendered marker ${marker.id} differs from persisted identity or coordinates.`)
    }
  }
  for (const drawing of persisted.drawings) {
    const features = drawingFeatures.filter((candidate) => candidate.properties.drawingId === drawing.id)
    const geometries = features.filter((candidate) => candidate.properties.featureKind === 'geometry')
    const labels = features.filter((candidate) => candidate.properties.featureKind === 'label')
    const feature = geometries[0]
    if (geometries.length !== 1 || labels.length > 1
        || features.some((candidate) => candidate.properties.drawingType !== drawing.type)
        || canonicalJson(feature.geometry) !== canonicalJson(drawing.geometry)) {
      throw new Error(`Rendered drawing ${drawing.id} differs from persisted geometry.`)
    }
    // The reviewed C14 producer creates a line. Its label belongs to the middle
    // vertex; supplemental labels must not conceal foreign geometry or duplicates.
    if (labels.length === 1 && (drawing.geometry.type !== 'LineString'
        || canonicalJson(labels[0].geometry) !== canonicalJson({ type: 'Point',
          coordinates: drawing.geometry.coordinates[Math.floor(drawing.geometry.coordinates.length / 2)] }))) {
      throw new Error(`Rendered drawing ${drawing.id} label differs from its persisted line.`)
    }
  }
}

function assertVisibilityReceipt(value, label) {
  if (value === null || typeof value !== 'object' || typeof value.id !== 'string'
      || value.hiddenObserved !== true || value.restored !== true || value.sourceRetained !== true) {
    throw new Error(`${label} visibility changed the source or was not restored.`)
  }
}

function projectGeometry(value) {
  if (value === null || typeof value !== 'object' || typeof value.type !== 'string') {
    throw new Error('Map geometry is missing.')
  }
  if (!Array.isArray(value.coordinates)) throw new Error('Map geometry coordinates are missing.')
  return { type: value.type, coordinates: value.coordinates }
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new Error(`Invalid ${label}.`)
  return value
}

function optionalText(value) {
  return typeof value === 'string' ? value : null
}

function finiteCoordinate(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`)
  return value
}

function compareIdentity(a, b) { return a.id.localeCompare(b.id) }
function compareFeature(a, b) { return (a.properties.markerId ?? a.properties.drawingId ?? '').localeCompare(b.properties.markerId ?? b.properties.drawingId ?? '') }
