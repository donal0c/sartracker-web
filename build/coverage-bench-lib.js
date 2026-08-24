import { createHash } from 'node:crypto'

export const COVERAGE_BENCH_SCHEMA_VERSION = 1

const CANDIDATES = new Set(['A', 'B', 'C'])
const FIXTURES = new Map([
  ['bcp-960k', 960_000],
  ['bcp-2m', 2_000_000],
])
const GIB = 1024 ** 3

export const COVERAGE_BENCH_BUDGETS = Object.freeze({
  firstUsefulMs: 5_000,
  complete960kMs: 30_000,
  filterToggleMs: 500,
  rendererFrameP95Ms: 33,
  mainStallTargetMs: 150,
  mainStallHardMs: 200,
  settled960kBytes: 1.5 * GIB,
  peak2mBytes: 2.5 * GIB,
})

/**
 * Creates a stable JSON representation suitable for evidence checksums.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableCoverageBenchJson(value) {
  return JSON.stringify(sortJsonValue(value))
}

/**
 * Returns the SHA-256 checksum used to bind a run manifest or evidence file.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function checksumCoverageBenchValue(value) {
  return createHash('sha256').update(stableCoverageBenchJson(value)).digest('hex')
}

/**
 * Builds and validates a benchmark run manifest.
 *
 * @param {Record<string, unknown>} input
 * @returns {Record<string, any>}
 */
export function buildCoverageBenchManifest(input) {
  const manifest = {
    schemaVersion: COVERAGE_BENCH_SCHEMA_VERSION,
    ...structuredClone(input),
  }
  validateCoverageBenchManifest(manifest)
  return manifest
}

/**
 * Validates that a manifest contains every fact required to reproduce and judge a G2 run.
 *
 * @param {unknown} input
 * @returns {Record<string, any>}
 */
export function validateCoverageBenchManifest(input) {
  const manifest = requireObject(input, 'manifest')
  requireEqual(manifest.schemaVersion, COVERAGE_BENCH_SCHEMA_VERSION, 'schemaVersion')
  requireGitSha(manifest.appSha, 'appSha')
  requireOneOf(manifest.candidate, CANDIDATES, 'candidate')

  const fixture = requireObject(manifest.fixture, 'fixture')
  requireOneOf(fixture.preset, new Set(FIXTURES.keys()), 'fixture.preset')
  requireSha(fixture.digest, 'fixture.digest')
  requirePositiveInteger(fixture.generatorVersion, 'fixture.generatorVersion')
  requireEqual(fixture.positionCount, FIXTURES.get(fixture.preset), 'fixture.positionCount')

  const machine = requireObject(manifest.machine, 'machine')
  for (const key of ['hostname', 'platform', 'arch', 'kernel', 'cpu', 'gpu']) {
    requireNonEmptyString(machine[key], `machine.${key}`)
  }
  if (machine.platform !== 'linux' || machine.arch !== 'x64') {
    throw new Error('machine must be the reference linux x64 host.')
  }
  if (String(machine.sessionType).toLowerCase() !== 'x11') {
    throw new Error('machine.sessionType must identify the reference x11 session.')
  }

  const run = requireObject(manifest.run, 'run')
  requirePositiveInteger(run.repetition, 'run.repetition')
  requireOneOf(run.thermalState, new Set(['cold', 'warm']), 'run.thermalState')
  requireIsoDate(run.startedAt, 'run.startedAt')
  requireIsoDate(run.completedAt, 'run.completedAt')
  if (Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
    throw new Error('run.completedAt must not precede run.startedAt.')
  }
  if (!Array.isArray(run.flags) || !run.flags.every((flag) => typeof flag === 'string')) {
    throw new Error('run.flags must be an array of strings.')
  }
  if (!run.flags.includes('--ozone-platform=x11')) {
    throw new Error('run.flags must include --ozone-platform=x11.')
  }
  const expectedThermalState = run.repetition === 1 ? 'cold' : 'warm'
  if (run.thermalState !== expectedThermalState) {
    throw new Error(`run repetition ${run.repetition} must be ${expectedThermalState}.`)
  }

  validateNumericFields(manifest.timings, 'timings', [
    'firstUsefulMs',
    'completeMs',
    'filterToggleMs',
    'filterDeviceMs',
    'filterGroupMs',
    'filterOutingMs',
    'appendRerenderMs',
  ])
  validateNumericFields(manifest.phases, 'phases', [
    'queryMs',
    'segmentationMs',
    'encodeServeMs',
    'sourceUpdateMs',
    'renderSettleMs',
  ])

  const responsiveness = requireObject(manifest.responsiveness, 'responsiveness')
  validateSampleArray(responsiveness.mainGapMs, 'responsiveness.mainGapMs')
  validateSampleArray(responsiveness.rendererFrameMs, 'responsiveness.rendererFrameMs')
  if (responsiveness.mainGapMs.length === 0) {
    throw new Error('responsiveness.mainGapMs must contain at least one sample.')
  }
  if (responsiveness.rendererFrameMs.length === 0) {
    throw new Error('responsiveness.rendererFrameMs must contain at least one sample.')
  }

  validateNumericFields(manifest.memory, 'memory', [
    'rendererRssPeakBytes',
    'rendererRssSettledBytes',
  ])
  if (manifest.memory.rendererRssSettledBytes > manifest.memory.rendererRssPeakBytes) {
    throw new Error('memory.rendererRssSettledBytes cannot exceed rendererRssPeakBytes.')
  }

  const correctness = requireObject(manifest.correctness, 'correctness')
  for (const key of [
    'currentFixWithinPollCycle',
    'killResumeHonest',
    'renderedAttestationExact',
    'exactDotsEqual',
    'staleTileGuarded',
    'unrelatedRevisionStable',
  ]) {
    if (typeof correctness[key] !== 'boolean') {
      throw new Error(`correctness.${key} must be boolean.`)
    }
  }
  const attestation = requireObject(manifest.attestation, 'attestation')
  requireNonEmptyString(attestation.seed, 'attestation.seed')
  if (!Array.isArray(attestation.panes) || attestation.panes.length === 0) {
    throw new Error('attestation.panes must contain sampled pane evidence.')
  }
  for (const [index, paneInput] of attestation.panes.entries()) {
    const panePath = `attestation.panes[${index}]`
    const pane = requireObject(paneInput, panePath)
    requireNonNegativeInteger(pane.index, `${panePath}.index`)
    validateNumericFields(pane, panePath, ['zoom'])
    if (!Array.isArray(pane.bounds) || pane.bounds.length !== 4 ||
      pane.bounds.some((value) => !Number.isFinite(value))) {
      throw new Error(`${panePath}.bounds must contain four finite coordinates.`)
    }
    requireNonNegativeInteger(pane.expectedSegmentCount, `${panePath}.expectedSegmentCount`)
    requireNonNegativeInteger(pane.renderedSegmentCount, `${panePath}.renderedSegmentCount`)
    requireSha(pane.expectedDigest, `${panePath}.expectedDigest`)
    requireSha(pane.renderedDigest, `${panePath}.renderedDigest`)
    if (pane.exact !== true ||
      pane.expectedSegmentCount !== pane.renderedSegmentCount ||
      pane.expectedDigest !== pane.renderedDigest) {
      throw new Error(`${panePath} must contain an exact rendered/worker match.`)
    }
  }
  if (!attestation.panes.some((pane) => pane.expectedSegmentCount > 0)) {
    throw new Error('attestation.panes must include at least one non-empty sampled pane.')
  }
  return manifest
}

/**
 * Summarizes finite non-negative measurement samples without interpolation.
 *
 * @param {readonly number[]} samples
 * @returns {{count:number,min:number,median:number,p95:number,max:number}}
 */
export function summarizeCoverageBenchSamples(samples) {
  const values = (Array.isArray(samples) ? samples : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right)
  if (values.length === 0) {
    return { count: 0, min: 0, median: 0, p95: 0, max: 0 }
  }
  return {
    count: values.length,
    min: values[0],
    median: nearestRank(values, 0.5),
    p95: nearestRank(values, 0.95),
    max: values.at(-1),
  }
}

/**
 * Evaluates one run against the ratification-pending G2 engineering budgets.
 *
 * @param {unknown} input
 * @param {typeof COVERAGE_BENCH_BUDGETS} [budgets]
 * @returns {Record<string, any>}
 */
export function evaluateCoverageBenchRun(input, budgets = COVERAGE_BENCH_BUDGETS) {
  const manifest = validateCoverageBenchManifest(input)
  const main = summarizeCoverageBenchSamples(manifest.responsiveness.mainGapMs)
  const renderer = summarizeCoverageBenchSamples(manifest.responsiveness.rendererFrameMs)
  const is960k = manifest.fixture.preset === 'bcp-960k'
  const is2m = manifest.fixture.preset === 'bcp-2m'
  const correctnessFailures = Object.entries(manifest.correctness)
    .filter(([, value]) => value !== true)
    .map(([key]) => key)

  const gates = {
    firstUseful: gate(manifest.timings.firstUsefulMs, budgets.firstUsefulMs, 'ms'),
    complete960k: is960k
      ? gate(manifest.timings.completeMs, budgets.complete960kMs, 'ms')
      : null,
    filterToggle: gate(manifest.timings.filterToggleMs, budgets.filterToggleMs, 'ms'),
    mainStall: gate(main.max, budgets.mainStallHardMs, 'ms'),
    memory: is960k
      ? gate(manifest.memory.rendererRssSettledBytes, budgets.settled960kBytes, 'bytes')
      : is2m
        ? gate(manifest.memory.rendererRssPeakBytes, budgets.peak2mBytes, 'bytes')
        : null,
    correctness: {
      pass: correctnessFailures.length === 0,
      failures: correctnessFailures,
    },
  }
  const targets = {
    rendererFrameP95: gate(renderer.p95, budgets.rendererFrameP95Ms, 'ms'),
    mainStallTarget: gate(main.max, budgets.mainStallTargetMs, 'ms'),
  }
  const rejections = Object.entries(gates)
    .filter(([, result]) => result && result.pass === false)
    .map(([id, result]) => ({ id, ...result }))
  return {
    decision: rejections.length === 0 ? 'pass' : 'reject',
    gates,
    targets,
    rejections,
    statistics: { mainGapMs: main, rendererFrameMs: renderer },
  }
}

/**
 * Aggregates manifests by candidate and fixture while preserving the cold/warm distinction.
 *
 * @param {readonly unknown[]} inputs
 * @param {typeof COVERAGE_BENCH_BUDGETS} [budgets]
 * @returns {{schemaVersion:number,groups:Array<Record<string, any>>}}
 */
export function aggregateCoverageBenchRuns(inputs, budgets = COVERAGE_BENCH_BUDGETS) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('At least one coverage benchmark manifest is required.')
  }
  const manifests = inputs.map(validateCoverageBenchManifest)
  const grouped = new Map()
  for (const manifest of manifests) {
    const key = `${manifest.candidate}:${manifest.fixture.preset}`
    const bucket = grouped.get(key) ?? []
    bucket.push(manifest)
    grouped.set(key, bucket)
  }

  const groups = [...grouped.values()]
    .map((runs) => aggregateGroup(runs, budgets))
    .sort((left, right) =>
      `${left.candidate}:${left.fixture}`.localeCompare(`${right.candidate}:${right.fixture}`),
    )
  return { schemaVersion: COVERAGE_BENCH_SCHEMA_VERSION, groups }
}

/**
 * Renders the measured decision table committed in the G2 memo.
 *
 * @param {{groups:Array<Record<string, any>>}} aggregate
 * @returns {string}
 */
export function renderCoverageBenchVerdictTable(aggregate) {
  const rows = [
    '| Candidate | Fixture | Verdict | First useful worst warm ms | Complete worst warm ms | Filter worst warm ms | Main max worst warm ms | Renderer p95 worst warm ms | Settled / peak GiB | query / segment / encode / source / settle median ms |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const group of aggregate.groups ?? []) {
    const warm = group.worstWarm
    rows.push(
      `| ${group.candidate} | ${group.fixture} | ${group.decision.toUpperCase()} | ${format(warm?.firstUsefulMs)} | ${format(warm?.completeMs)} | ${format(warm?.filterToggleMs)} | ${format(warm?.mainMaxMs)} | ${format(warm?.rendererP95Ms)} | ${formatGiB(warm?.settledBytes)} / ${formatGiB(warm?.peakBytes)} | ${[
        group.phaseMs.query.median,
        group.phaseMs.segmentation.median,
        group.phaseMs.encodeServe.median,
        group.phaseMs.sourceUpdate.median,
        group.phaseMs.renderSettle.median,
      ].map(format).join(' / ')} |`,
    )
  }
  return rows.join('\n')
}

/** @param {Array<Record<string, any>>} runs @param {typeof COVERAGE_BENCH_BUDGETS} budgets */
function aggregateGroup(runs, budgets) {
  const warm = runs.filter((run) => run.run.thermalState === 'warm')
  const judged = warm.length > 0 ? warm : runs
  const verdicts = judged.map((run) => ({ run, verdict: evaluateCoverageBenchRun(run, budgets) }))
  const rejected = verdicts.filter(({ verdict }) => verdict.decision === 'reject')
  return {
    candidate: runs[0].candidate,
    fixture: runs[0].fixture.preset,
    coldRunCount: runs.filter((run) => run.run.thermalState === 'cold').length,
    warmRunCount: warm.length,
    decision: rejected.length === 0 ? 'pass' : 'reject',
    rejections: [...new Set(rejected.flatMap(({ verdict }) => verdict.rejections.map(({ id }) => id)))],
    worstWarm: {
      firstUsefulMs: maxOf(judged, (run) => run.timings.firstUsefulMs),
      completeMs: maxOf(judged, (run) => run.timings.completeMs),
      filterToggleMs: maxOf(judged, (run) => run.timings.filterToggleMs),
      appendRerenderMs: maxOf(judged, (run) => run.timings.appendRerenderMs),
      mainMaxMs: maxOf(judged, (run) => summarizeCoverageBenchSamples(run.responsiveness.mainGapMs).max),
      rendererP95Ms: maxOf(judged, (run) => summarizeCoverageBenchSamples(run.responsiveness.rendererFrameMs).p95),
      settledBytes: maxOf(judged, (run) => run.memory.rendererRssSettledBytes),
      peakBytes: maxOf(judged, (run) => run.memory.rendererRssPeakBytes),
    },
    phaseMs: {
      query: summarizeCoverageBenchSamples(runs.map((run) => run.phases.queryMs)),
      segmentation: summarizeCoverageBenchSamples(runs.map((run) => run.phases.segmentationMs)),
      encodeServe: summarizeCoverageBenchSamples(runs.map((run) => run.phases.encodeServeMs)),
      sourceUpdate: summarizeCoverageBenchSamples(runs.map((run) => run.phases.sourceUpdateMs)),
      renderSettle: summarizeCoverageBenchSamples(runs.map((run) => run.phases.renderSettleMs)),
    },
    manifests: runs.map((run) => ({
      repetition: run.run.repetition,
      thermalState: run.run.thermalState,
      checksum: checksumCoverageBenchValue(run),
    })),
  }
}

/** @param {Array<Record<string, any>>} rows @param {(row:Record<string, any>)=>number} select */
function maxOf(rows, select) {
  return Math.max(...rows.map(select))
}

/** @param {number} actual @param {number} maximum @param {string} unit */
function gate(actual, maximum, unit) {
  return { pass: actual <= maximum, actual, maximum, unit }
}

/** @param {readonly number[]} sorted @param {number} ratio */
function nearestRank(sorted, ratio) {
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  return sorted[index]
}

/** @param {unknown} value */
function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJsonValue(child)]),
  )
}

/** @param {unknown} value @param {string} path */
function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`)
  }
  return value
}

/** @param {unknown} value @param {unknown} expected @param {string} path */
function requireEqual(value, expected, path) {
  if (value !== expected) throw new Error(`${path} must equal ${String(expected)}.`)
}

/** @param {unknown} value @param {Set<unknown>} allowed @param {string} path */
function requireOneOf(value, allowed, path) {
  if (!allowed.has(value)) throw new Error(`${path} has an unsupported value.`)
}

/** @param {unknown} value @param {string} path */
function requireNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string.`)
  }
}

/** @param {unknown} value @param {string} path */
function requireSha(value, path) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${path} must be a SHA-256 hex digest.`)
  }
}

/** @param {unknown} value @param {string} path */
function requireGitSha(value, path) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error(`${path} must be a full 40-character Git SHA.`)
  }
}

/** @param {unknown} value @param {string} path */
function requirePositiveInteger(value, path) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer.`)
}

/** @param {unknown} value @param {string} path */
function requireNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${path} must be a non-negative integer.`)
}

/** @param {unknown} value @param {string} path */
function requireIsoDate(value, path) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path} must be an ISO timestamp.`)
  }
}

/** @param {unknown} input @param {string} path @param {readonly string[]} fields */
function validateNumericFields(input, path, fields) {
  const value = requireObject(input, path)
  for (const field of fields) {
    if (!Number.isFinite(value[field]) || value[field] < 0) {
      throw new Error(`${path}.${field} must be a finite non-negative number.`)
    }
  }
}

/** @param {unknown} input @param {string} path */
function validateSampleArray(input, path) {
  if (!Array.isArray(input) || input.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${path} must contain finite non-negative numbers.`)
  }
}

/** @param {unknown} value */
function format(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : '—'
}

/** @param {unknown} value */
function formatGiB(value) {
  return Number.isFinite(value) ? (value / GIB).toFixed(2) : '—'
}
