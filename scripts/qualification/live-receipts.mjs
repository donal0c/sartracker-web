import { isDeepStrictEqual } from 'node:util'
import { assertExactFixEvidenceChain, buildAllowlistedLiveExactReport } from '../../build/breadcrumb-live-exact-proof-lib.js'

/** Validate one count/HMAC observation without retaining private identities, coordinates or the ephemeral key. */
function validateDigest(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'count,hmacSha256'
      || !Number.isSafeInteger(value.count) || value.count < 8000
      || !/^[a-f0-9]{64}$/u.test(value.hmacSha256)) throw new Error('Live digest observation is not the bounded privacy-safe schema.')
}

/** Recompute the retained source/SQLite/page/GeoJSON and rendered identity comparisons independently. */
export function validateLiveExactReceipt(report, expected) {
  if (report?.schemaVersion !== 2 || report.artifact?.sha256 !== expected.artifactSha256
      || report.artifact?.version !== expected.version || !/^[a-f0-9]{64}$/u.test(expected.artifactSha256)) throw new Error('Live evidence schema or exact candidate identity differs.')
  const inputs = report.oracleInputs
  if (!inputs || Object.keys(inputs).sort().join(',') !== 'fixStages,renderedIdentityTime,sourceIdentityTime'
      || !inputs.fixStages || Object.keys(inputs.fixStages).sort().join(',') !== 'exactGeoJson,exactPages,provider,sqlite') throw new Error('Live independent stage facts are missing.')
  for (const observation of [...Object.values(inputs.fixStages), inputs.sourceIdentityTime, inputs.renderedIdentityTime]) validateDigest(observation)
  const fixEvidence = assertExactFixEvidenceChain(inputs.fixStages)
  if (!isDeepStrictEqual(inputs.sourceIdentityTime, inputs.renderedIdentityTime)
      || inputs.sourceIdentityTime.count !== fixEvidence.count) throw new Error('Rendered identity and source time evidence differ.')
  const rebuilt = buildAllowlistedLiveExactReport({ artifactSha256: expected.artifactSha256, expectedVersion: expected.version,
    fixEvidence, renderedIdentityTimeEvidence: { ...inputs.renderedIdentityTime, matched: true },
    renderedCoordinateDeviation: report.reconciliation.renderedCoordinateDeviation,
    pageCount: report.workload.pageCount, maximumPageCount: report.workload.maximumPageCount,
    returnedToLatest: report.reconciliation.returnedToLatest,
    baselineBreadcrumbPointCount: report.reconciliation.baselineBreadcrumbPointCount,
    lookbackHours: report.workload.lookbackHours, exactPageLimit: report.workload.exactPageLimit,
    providerGetOnly: report.safety.providerGetOnly, sqliteIntegrityOk: report.safety.sqliteIntegrityOk,
    screenshotSha256: report.visual.dotsScreenshotSha256,
    sourceFetchMs: report.timingsMs.sourceFetch, sqliteReadMs: report.timingsMs.sqliteRead,
    exactPageMs: report.timingsMs.exactPages, geoJsonMs: report.timingsMs.exactGeoJson,
    renderedMapMs: report.timingsMs.renderedMap, renderedAudit: report.reconciliation.mapLibreRenderedAudit,
  })
  const retained = { ...report, schemaVersion: 1 }
  delete retained.oracleInputs
  if (!isDeepStrictEqual(retained, rebuilt)) throw new Error('Live report facts differ from the independently reconstructed allowlisted receipt.')
  return { status: 'PASS', proofMode: 'packaged-live-get-only', releaseEligible: false,
    scope: 'one independently selected 48-hour real-provider exact breadcrumb chain; no synthetic 100-device or soak substitution' }
}
