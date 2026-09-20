/**
 * Reviewed source/browser regression selections. These are named lower-tier
 * variants, never substitutes for the package, scale, live or human variants.
 * Selection is fixed in code; runtime configuration cannot add commands or
 * narrow the tests. The controller freezes exact selected files/test identities.
 */
const SOURCE_PATTERNS = Object.freeze({
  C00: /^(?:linux-package-|appimage-)/u,
  C01: /^(?:electron-(?:startup|boot|mission-store-startup|newer-schema)|mission-runtime-startup)/u,
  C02: /^(?:mission-(?:lifecycle|finaliz|recovery)|electron-(?:mission-lifecycle|mission-finaliz|mission-recovery)|finish-mission)/u,
  C03: /(?:outing|participant|breadcrumb-scope)/u,
  C04: /(?:current-position|current-transport|hidden-current|foreground-priority)/u,
  C05: /(?:tracking-ingest|breadcrumb-(?:canonical|ingest|source|conflict)|fix-time|traccar-client)/u,
  C06: /^stationary-attention/u,
  C07: /(?:breadcrumb-(?:dot|page|query|read|filter)|exact-breadcrumb|mission-track)/u,
  C08: /coverage/u,
  C09: /gpx/u,
  C10: /(?:replay|replay-map)/u,
  C11: /(?:search-pass|search-area|search-operations|mission-evidence)/u,
  C12: /(?:marker|attachment|casualty|hazard)/u,
  C13: /(?:coordinate|bearing|measurement|declination|irish-grid|drawing-math)/u,
  C14: /(?:sync-.*overlay|layer-|map-overlay|map-feature|map-style|hit-test|helicopter|weather)/u,
  C15: /(?:official-map|offline-map)/u,
  C16: /(?:settings|credentials|secret|runtime-bootstrap)/u,
  C17: /(?:diagnostic|support-report|warning)/u,
  C18: /(?:mission-store|backup|wal|storage-diagnostics)/u,
  C19: /(?:migration|integrity|retention|legacy-object|legacy-store)/u,
  C20: /(?:archive-(?:worker|create|inventory|digest|snapshot|stream|plaintext)|mission-archive-worker|breadcrumb-pr6-qualification)/u,
  C21: /(?:archive-(?:auth|cipher|crypt|custody|secret|key|frame|verify-semantic|format|replacement)|mission-archive-format)/u,
  C22: /(?:archive-(?:review|restore|cleanup|correction|replay|supplement|legacy))/u,
  C23: /(?:preload|ipc|message-policy|capability|sender)/u,
  C24: /(?:responsiveness|heartbeat|main-thread|foreground-priority)/u,
  C25: /(?:tracking-soak|seed-mission-store|exact-breadcrumb-dots)/u,
  C26: /(?:linux-package|appimage|single-instance|duplicate-launch)/u,
  C27: /(?:electron-release|beta-release|release-publish|release-provenance|repository-control)/u,
  C28: /(?:mission-runtime|mission-session|mission-orchestration)/u,
})

const BROWSER_FILES = Object.freeze({
  C01: ['theme-startup.spec.ts'],
  C02: ['mission.spec.ts', 'mission-review.spec.ts'],
  C03: ['outings.spec.ts', 'participants.spec.ts', 'repair-train-d-participants.spec.ts'],
  C04: ['parity-visibility.spec.ts', 'war06-mission-scope.spec.ts'],
  C05: ['tracking-ingest-health.spec.ts'],
  C06: ['stationary-attention.spec.ts'],
  C07: ['layer-panel.spec.ts', 'parity-visibility.spec.ts'],
  C08: ['coverage.spec.ts'],
  C09: ['gpx-import.spec.ts'],
  C10: ['mission-review.spec.ts', 'repair-train-d-review.spec.ts'],
  C11: ['mission-evidence-search-passes.spec.ts'],
  C12: ['marker.spec.ts'],
  C13: ['coordinate-converter.spec.ts', 'drawing-tools.spec.ts', 'measurement.spec.ts'],
  C14: ['map.spec.ts', 'layer-panel.spec.ts', 'hit-test-priority.spec.ts', 'focus-mode.spec.ts', 'helicopter-panel.spec.ts', 'weather.spec.ts'],
  C15: ['official-map-qualification.spec.ts', 'official-map-raster-freshness.spec.ts'],
  C16: ['settings.spec.ts'],
  C17: ['diagnostics.spec.ts'],
  C19: ['legacy-roster-recovery.spec.ts'],
  C22: ['archive-review-operator-flow.spec.ts'],
  C23: ['harness-no-tauri-leak.spec.ts'],
  C28: ['full-mission-flow.spec.ts'],
})

const STRICT_RESPONSIVENESS_FILES = Object.freeze([
  'breadcrumb-accumulator', 'breadcrumb-pr6-qualification-script', 'electron-archive-family-resource-lane',
  'electron-archive-plaintext-sweep-integration', 'electron-archive-registry', 'electron-cleanup-live-write-contention',
  'electron-coverage-ledger', 'electron-mission-evidence-versioning', 'electron-mission-review-read-query-runner',
  'electron-search-operations-page', 'electron-startup-write-responsiveness', 'ingest-anomaly-outbox',
  'main-event-loop-probe', 'stationary-attention-projection', 'release-responsiveness',
].map((name) => `tests/unit/${name}.test.ts`))

/** Resolve a fixed selection from the exact checkout inventory; empty selections fail closed. */
export function selectContractSuite(contractId, proofMode, repositoryFiles) {
  if (!Array.isArray(repositoryFiles) || repositoryFiles.some((filename) => typeof filename !== 'string')) throw new Error('Repository file inventory is required.')
  let files
  if (proofMode === 'source' && SOURCE_PATTERNS[contractId]) {
    files = contractId === 'C24' ? [...STRICT_RESPONSIVENESS_FILES] : repositoryFiles.filter((filename) => /^tests\/unit\/[^/]+\.test\.tsx?$/u.test(filename)
      && SOURCE_PATTERNS[contractId].test(filename.slice('tests/unit/'.length)))
    if (files.some((filename) => !repositoryFiles.includes(filename))) throw new Error('A reviewed source contract test file is missing.')
  } else if (proofMode === 'browser' && BROWSER_FILES[contractId]) {
    files = BROWSER_FILES[contractId].map((name) => `tests/e2e/${name}`)
    if (files.some((filename) => !repositoryFiles.includes(filename))) throw new Error('A reviewed browser contract test file is missing.')
  } else throw new Error('Contract has no reviewed source/browser suite at this proof tier.')
  if (files.length === 0 || new Set(files).size !== files.length) throw new Error('Contract suite has no tests or duplicate files.')
  return Object.freeze({ contractId, proofMode, runner: proofMode === 'source' ? 'vitest' : 'playwright',
    files: Object.freeze([...files].sort()), scope: 'reviewed regression tests only; no package, scale, live or human substitution' })
}

/** Enumerate fixed lower-tier variants for the candidate compiler. */
export function contractSuiteVariants() {
  return Object.freeze(Object.keys(SOURCE_PATTERNS).flatMap((contractId) => [
    { contractId, proofMode: 'source' }, ...(BROWSER_FILES[contractId] ? [{ contractId, proofMode: 'browser' }] : []),
  ]))
}
