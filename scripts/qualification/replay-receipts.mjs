import { createHash } from 'node:crypto'

/** Recompute the two fixed large-geometry truths without trusting producer pass fields. */
export function validateReplayReceipt(report) {
  const failureReasons = []
  try {
    if (report?.schemaVersion !== 2) throw new Error('Replay raw oracle schema is missing.')
    const diagnostics = report.rendererDiagnostics
    if (!Array.isArray(diagnostics?.errors) || diagnostics.errors.length !== 0
        || !Array.isArray(diagnostics.unexpectedRequestFailures) || diagnostics.unexpectedRequestFailures.length !== 0
        || !Number.isSafeInteger(diagnostics.blockedNetworkRequestCount) || diagnostics.blockedNetworkRequestCount < 0) {
      throw new Error('Replay renderer diagnostics are missing or contain unexpected failures.')
    }
    const initial = expectedGeometry(0)
    const updated = expectedGeometry(0.002)
    if (report.source?.initialGeometry !== initial || report.source?.updatedGeometry !== updated) throw new Error('Replay source geometry differs from the fixed independent fixture.')
    const before = Date.parse(report.source.knownBeforeUpdate)
    const after = Date.parse(report.source.knownAfterUpdate)
    if (!Number.isFinite(before) || !Number.isFinite(after) || before >= after) throw new Error('Replay known-at-time boundaries are missing or reversed.')
    for (const [name, geometry] of [['liveOld', initial], ['archiveOld', initial], ['liveUpdated', updated], ['archiveUpdated', updated]]) {
      const lane = report[name]
      if (typeof lane?.serialized !== 'string' || lane.serialized.length > 1024 * 1024
          || !Number.isSafeInteger(lane.fragments) || lane.fragments < 2 || lane.fragments > 100
          || lane.serialized.length > lane.fragments * 16384
          || createHash('sha256').update(lane.serialized).digest('hex') !== lane.expectedHash
          || JSON.parse(lane.serialized).geometry_json !== geometry) throw new Error(`Replay ${name} raw continuation or geometry identity differs.`)
    }
    if (report.liveOld.serialized !== report.archiveOld.serialized
        || report.liveUpdated.serialized !== report.archiveUpdated.serialized) throw new Error('Replay changed across archive custody.')
    if (!Number.isFinite(report.maximumFrameGapMs) || report.maximumFrameGapMs < 0 || report.maximumFrameGapMs >= 200) throw new Error('Replay rendered frame gap breached the strict 200ms boundary.')
    if (!report.popupText?.includes('Large retained search area') || report.popupColor !== 'rgb(28, 25, 23)') throw new Error('Replay retained-object popup was not observed correctly.')
  } catch (error) { failureReasons.push(error.message) }
  return { status: failureReasons.length ? 'INVALID_EVIDENCE' : 'PASS', passed: failureReasons.length === 0,
    failureReasons, scope: 'packaged large-geometry continuation and known-at-time revision parity; separate scale and track variants remain mandatory' }
}

/** Fixed synthetic polygon; the second revision moves its centre east by 0.002 degrees. */
function expectedGeometry(offset) {
  const ring = Array.from({ length: 2000 }, (_, index) => [
    -9.7 + offset + Math.cos(index * Math.PI / 1000) * 0.01,
    52 + Math.sin(index * Math.PI / 1000) * 0.01,
  ])
  ring.push(ring[0])
  return JSON.stringify({ type: 'Polygon', coordinates: [ring] })
}
