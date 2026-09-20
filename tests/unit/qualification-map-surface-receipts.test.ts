import { describe, expect, it } from 'vitest'

import { validateMapSurface, validateMapSurfaceFacts } from '../../scripts/qualification/map-surface-receipts.mjs'

function validReport() {
  const marker = {
    id: 'marker-c14-1',
    type: 'ipp_lkp',
    name: 'C14 marker',
    lat: 52.1,
    lon: -9.4,
  }
  const geometry = {
    type: 'LineString',
    coordinates: [[-9.45, 52.08], [-9.35, 52.12]],
  }
  const drawing = {
    id: 'drawing-c14-1',
    type: 'line',
    name: 'C14 line',
    geometry,
  }
  const source = {
    missionMarkers: {
      id: 'mission-markers',
      type: 'geojson',
      features: [{
        geometry: { type: 'Point', coordinates: [marker.lon, marker.lat] },
        properties: { markerId: marker.id, markerType: marker.type, name: marker.name },
      }],
    },
    missionDrawings: {
      id: 'mission-drawings',
      type: 'geojson',
      features: [{
        geometry,
        properties: { drawingId: drawing.id, drawingType: drawing.type, featureKind: 'geometry' },
      }],
    },
  }
  return {
    schema: 'sartracker-map-surface-v1',
    contractId: 'C14',
    developmentTestHarness: false,
    persisted: {
      before: { missionId: 'mission-c14', markers: [marker], drawings: [drawing], digest: 'same' },
      after: { missionId: 'mission-c14', markers: [marker], drawings: [drawing], digest: 'same' },
    },
    map: {
      before: {
        basemapId: 'openstreetmap',
        sources: [source.missionMarkers, source.missionDrawings],
        overlayLayerIds: ['mission-markers-symbol-ipp_lkp', 'mission-drawings-line'],
      },
      after: {
        basemapId: 'esri_topo',
        sources: structuredClone([source.missionMarkers, source.missionDrawings]),
        overlayLayerIds: ['mission-markers-symbol-ipp_lkp', 'mission-drawings-line'],
      },
    },
    visibility: {
      marker: { id: marker.id, hiddenObserved: true, restored: true, sourceRetained: true },
      drawing: { id: drawing.id, hiddenObserved: true, restored: true, sourceRetained: true },
    },
    focus: { before: false, activeObserved: true, coordinateMirrorVisible: true, restored: true },
    overlayFailure: {
      attempted: true,
      throwHookHit: true,
      warningText: 'Mission overlay synchronization failed; retrying.',
      operatorWarningVisible: true,
      recoveryObserved: true,
      consoleOnly: false,
    },
    cleanup: { applicationClosed: true, profileRemoved: true },
  }
}

describe('C14 map surface receipts', () => {
  it('accepts a source-to-map identity receipt with reversible visibility and recovery', () => {
    expect(validateMapSurface(validReport())).toMatchObject({ status: 'PASS', releaseEligible: false })
  })

  it('rejects persisted or rendered geometry drift', () => {
    const report = validReport()
    report.map.after.sources[1].features[0].geometry = {
      type: 'LineString',
      coordinates: [[-9.45, 52.08], [-9.3, 52.12]],
    }
    expect(() => validateMapSurface(report)).toThrow(/geometry|rendered/i)
  })

  it.each(['foreign-marker', 'duplicate-marker', 'unbound-marker', 'foreign-drawing', 'duplicate-drawing', 'unbound-drawing', 'duplicate-source'])('rejects extra rendered membership: %s', (kind) => {
    const report = structuredClone(validReport())
    for (const snapshot of [report.map.before, report.map.after]) {
      if (kind === 'duplicate-source') {
        snapshot.sources.push(structuredClone(snapshot.sources[0]))
        continue
      }
      const source = snapshot.sources[kind.endsWith('marker') ? 0 : 1]
      const extra = structuredClone(source.features[0])
      if (kind.startsWith('foreign')) {
        extra.properties = { ...extra.properties, markerId: 'foreign', drawingId: 'foreign' }
      } else if (kind.startsWith('unbound')) {
        extra.properties = { ...extra.properties, markerId: '', drawingId: '' }
      }
      source.features.push(extra)
    }
    expect(() => validateMapSurface(report)).toThrow(/rendered|source|membership|duplicate/iu)
  })

  it('accepts one bound line label but rejects duplicate or foreign labels', () => {
    const report = structuredClone(validReport())
    for (const snapshot of [report.map.before, report.map.after]) {
      const source = snapshot.sources[1]
      source.features.push({ geometry: { type: 'Point', coordinates: [-9.35, 52.12] },
        properties: { drawingId: 'drawing-c14-1', drawingType: 'line', featureKind: 'label' } })
    }
    expect(validateMapSurface(report).status).toBe('PASS')
    for (const kind of ['duplicate', 'foreign']) {
      const changed = structuredClone(report)
      for (const snapshot of [changed.map.before, changed.map.after]) {
        const label = structuredClone(snapshot.sources[1].features[1])
        if (kind === 'foreign') label.properties = { ...label.properties, drawingId: 'foreign' }
        snapshot.sources[1].features.push(label)
      }
      expect(() => validateMapSurface(changed)).toThrow(/rendered|membership|duplicate/iu)
    }
  })

  it('rejects a console-only persistent overlay failure', () => {
    const report = validReport()
    report.overlayFailure.operatorWarningVisible = false
    report.overlayFailure.consoleOnly = true
    expect(() => validateMapSurface(report)).toThrow(/operator warning|console-only/i)
  })

  it('rejects a generic basemap warning as overlay recovery evidence', () => {
    const report = validReport()
    report.overlayFailure.warningText = 'OpenTopoMap degraded: Some tiles failed to load'
    expect(() => validateMapSurfaceFacts(report)).toThrow(/overlay|warning/i)
  })

  it('rejects a visibility toggle that changes the source or is not restored', () => {
    const report = validReport()
    report.visibility.marker.sourceRetained = false
    expect(() => validateMapSurface(report)).toThrow(/source|visibility/i)
  })

  it('rejects development harness evidence for the candidate package contract', () => {
    const report = validReport()
    report.developmentTestHarness = true
    expect(() => validateMapSurface(report)).toThrow(/development/i)
  })

  it('allows the development harness to run the same pure map facts oracle', () => {
    const report = validReport()
    report.developmentTestHarness = true
    expect(validateMapSurfaceFacts(report)).toMatchObject({ status: 'PASS', releaseEligible: false })
  })
})
