import path from 'node:path'

const SHA1 = /^[a-f0-9]{40}$/u
const REPO_RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:[\\/])(?!\.\.?\/(?:$|\.\.\/))[A-Za-z0-9._/-]+$/u
const RUNNERS = new Set(['vitest', 'playwright'])
const PROOF_MODES = new Set(['source', 'browser'])
const VITEST_STATUSES = new Set(['passed', 'failed', 'skipped', 'pending', 'todo', 'disabled'])
const PLAYWRIGHT_RESULT_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'])
const VITEST_ROOT_KEYS = Object.freeze([
  'numFailedTests', 'numFailedTestSuites', 'numPassedTests', 'numPassedTestSuites',
  'numPendingTests', 'numPendingTestSuites', 'numTodoTests', 'numTotalTests',
  'numTotalTestSuites', 'snapshot', 'startTime', 'success', 'testResults',
])
const VITEST_SUITE_KEYS = Object.freeze([
  'assertionResults', 'endTime', 'message', 'name', 'startTime', 'status',
])
const VITEST_ASSERTION_KEYS = Object.freeze([
  'ancestorTitles', 'failureMessages', 'fullName', 'meta', 'status', 'tags', 'title',
])
const VITEST_ASSERTION_OPTIONAL_KEYS = Object.freeze(['duration', 'location'])
const VITEST_SNAPSHOT_KEYS = Object.freeze([
  'added', 'didUpdate', 'failure', 'filesAdded', 'filesRemoved', 'filesRemovedList',
  'filesUnmatched', 'filesUpdated', 'matched', 'total', 'unchecked',
  'uncheckedKeysByFile', 'unmatched', 'updated',
])
const PLAYWRIGHT_ROOT_KEYS = Object.freeze(['config', 'errors', 'stats', 'suites'])
const PLAYWRIGHT_STATS_KEYS = Object.freeze([
  'duration', 'expected', 'flaky', 'skipped', 'startTime', 'unexpected',
])
const PLAYWRIGHT_SUITE_REQUIRED_KEYS = Object.freeze(['column', 'file', 'line', 'specs', 'title'])
const PLAYWRIGHT_SPEC_KEYS = Object.freeze([
  'column', 'file', 'id', 'line', 'ok', 'tags', 'tests', 'title',
])
const PLAYWRIGHT_TEST_KEYS = Object.freeze([
  'annotations', 'expectedStatus', 'projectId', 'projectName', 'results', 'status', 'timeout',
])
const PLAYWRIGHT_RESULT_KEYS = Object.freeze([
  'annotations', 'attachments', 'duration', 'errors', 'parallelIndex', 'retry', 'startTime',
  'status', 'stderr', 'stdout', 'workerIndex',
])
const PLAYWRIGHT_RESULT_OPTIONAL_KEYS = Object.freeze(['error', 'errorLocation', 'steps'])

/**
 * Validate one exact Vitest JSON or Playwright JSON test report.
 *
 * Expected file paths are repository-relative POSIX paths. Vitest's absolute
 * suite names are normalized against the current repository root; Playwright
 * paths are resolved from the reporter's absolute `config.rootDir`. Test IDs
 * are `${file}::${ancestor > ... > test}`. The returned receipt is source or
 * browser proof only and never package, install, deployment, or release proof.
 *
 * The runner JSON does not carry a source SHA. `expected.sourceSha` is therefore
 * retained as controller-supplied binding context, with that limitation exposed
 * in the returned `sourceBinding` field rather than presented as reporter proof.
 *
 * @param {unknown} report Vitest or Playwright JSON reporter output
 * @param {unknown} expected exact controller-owned report binding
 * @returns {object} immutable fail-closed receipt result
 */
export function validateTestSuiteReceipt(report, expected) {
  const failures = []
  const binding = readExpectedBinding(expected, failures)
  const observed = {
    files: [],
    testIds: [],
    tests: [],
    errors: [],
    vitestSuiteKeys: new Set(),
    vitestSuiteStatuses: new Map(),
  }
  if (binding === null) {
    return makeResult({ binding: expected, observed, failures })
  }

  try {
    if (binding.runner === 'vitest') {
      parseVitestReport(report, binding, observed, failures)
    } else if (binding.runner === 'playwright') {
      parsePlaywrightReport(report, binding, observed, failures)
    } else {
      failures.push('Expected test-suite runner is unsupported.')
    }
  } catch (error) {
    failures.push(`Test-suite report could not be validated: ${error instanceof Error ? error.message : 'unknown parser error'}.`)
  }
  compareExpectedInventory(binding, observed, failures)
  return makeResult({ binding, observed, failures })
}

/** Read the strict expected runner, path, test, source and proof binding. */
function readExpectedBinding(expected, failures) {
  const keys = ['files', 'proofMode', 'runner', 'sourceSha', 'testIds']
  if (!hasExactKeys(expected, keys)) {
    failures.push('Expected test-suite binding has missing or unsupported fields.')
    return null
  }
  if (!RUNNERS.has(expected.runner)) failures.push('Expected test-suite runner is unsupported.')
  if (!PROOF_MODES.has(expected.proofMode)) failures.push('Expected test-suite proof mode is unsupported.')
  if (expected.runner === 'vitest' && expected.proofMode !== 'source') {
    failures.push('Vitest evidence must use source proof mode.')
  }
  if (expected.runner === 'playwright' && expected.proofMode !== 'browser') {
    failures.push('Playwright evidence must use browser proof mode.')
  }
  if (!SHA1.test(expected.sourceSha)) failures.push('Expected source SHA is invalid.')
  validateExpectedInventory(expected.files, expected.testIds, failures)
  return expected
}

/** Validate non-empty, unique repository-relative file and test inventories. */
function validateExpectedInventory(files, testIds, failures) {
  if (!Array.isArray(files) || files.length < 1
      || files.some((file) => typeof file !== 'string' || !REPO_RELATIVE_PATH.test(file)
        || path.posix.normalize(file) !== file)
      || new Set(files).size !== files.length) {
    failures.push('Expected test-suite file inventory must be non-empty, unique, and repository-relative.')
  }
  if (!Array.isArray(testIds) || testIds.length < 1
      || testIds.some((testId) => typeof testId !== 'string' || !isTestId(testId))
      || new Set(testIds).size !== testIds.length) {
    failures.push('Expected test-suite test inventory must be non-empty and uniquely identified.')
  }
  if (Array.isArray(files) && Array.isArray(testIds)
      && testIds.some((testId) => !files.includes(testId.split('::', 1)[0]))) {
    failures.push('Expected test IDs reference a file outside the expected file inventory.')
  }
}

/** Parse and independently validate the current Vitest JSON reporter shape. */
function parseVitestReport(report, binding, observed, failures) {
  if (!hasAllowedKeys(report, VITEST_ROOT_KEYS, ['coverageMap'])) {
    failures.push('Vitest JSON report has missing or unsupported root fields.')
    return
  }
  if (!isRecord(report.snapshot) || !hasExactKeys(report.snapshot, VITEST_SNAPSHOT_KEYS)) {
    failures.push('Vitest snapshot summary is missing or has unsupported fields.')
  } else {
    validateVitestSnapshot(report.snapshot, failures)
  }
  validateVitestRootScalars(report, failures)
  if (!Array.isArray(report.testResults) || report.testResults.length < 1) {
    failures.push('Vitest report contains zero test suites.')
    return
  }
  for (const suite of report.testResults) parseVitestSuite(suite, observed, failures)
  validateVitestAggregates(report, observed, failures)
}

/** Parse one Vitest file result and retain every assertion and error. */
function parseVitestSuite(suite, observed, failures) {
  if (!hasExactKeys(suite, VITEST_SUITE_KEYS)) {
    failures.push('Vitest file result has missing or unsupported fields.')
    return
  }
  if (typeof suite.name !== 'string' || !path.isAbsolute(suite.name)) {
    failures.push('Vitest file result name must be an absolute path.')
    return
  }
  const file = repoPathFromAbsolute(suite.name, failures, 'Vitest file')
  if (file !== null) {
    observed.files.push(file)
    markVitestSuite(observed, `${file}::file`)
  }
  if (!Number.isFinite(suite.startTime) || !Number.isFinite(suite.endTime)
      || suite.startTime < 0 || suite.endTime < suite.startTime) {
    failures.push(`Vitest file ${file ?? 'unknown'} has invalid timing.`)
  }
  if (typeof suite.status !== 'string' || typeof suite.message !== 'string') {
    failures.push(`Vitest file ${file ?? 'unknown'} has invalid status or message fields.`)
  }
  if (!Array.isArray(suite.assertionResults) || suite.assertionResults.length < 1) {
    failures.push(`Vitest file ${file ?? 'unknown'} contains no assertions.`)
    return
  }
  if (suite.status !== 'passed' || suite.message !== '') {
    failures.push(`Vitest file ${file ?? 'unknown'} did not finish cleanly.`)
  }
  for (const assertion of suite.assertionResults) {
    parseVitestAssertion(assertion, file, observed, failures)
  }
}

/** Parse one Vitest assertion, including raw reporter full name and failures. */
function parseVitestAssertion(assertion, file, observed, failures) {
  if (!hasAllowedKeys(assertion, VITEST_ASSERTION_KEYS, VITEST_ASSERTION_OPTIONAL_KEYS)) {
    failures.push('Vitest assertion result has missing or unsupported fields.')
    return
  }
  const ancestorsValid = Array.isArray(assertion.ancestorTitles)
    && assertion.ancestorTitles.every((title) => typeof title === 'string' && title.length > 0)
  const titleValid = typeof assertion.title === 'string' && assertion.title.length > 0
  const fullNameValid = typeof assertion.fullName === 'string' && assertion.fullName.length > 0
  if (!ancestorsValid || !titleValid || !fullNameValid || file === null) {
    failures.push('Vitest assertion identity is incomplete.')
    return
  }
  const canonicalName = [...assertion.ancestorTitles, assertion.title].join(' > ')
  const reporterName = [...assertion.ancestorTitles, assertion.title].join(' ')
  if (assertion.fullName !== reporterName) {
    failures.push(`Vitest assertion fullName does not match its ancestor/title fields: ${canonicalName}.`)
  }
  const id = `${file}::${canonicalName}`
  const status = assertion.status
  const suiteKeys = [`${file}::file`]
  for (let index = 0; index < assertion.ancestorTitles.length; index += 1) {
    suiteKeys.push(`${file}::${assertion.ancestorTitles.slice(0, index + 1).join('\u0000')}`)
  }
  for (const suiteKey of suiteKeys) {
    markVitestSuite(observed, suiteKey)
    const suiteStatus = observed.vitestSuiteStatuses.get(suiteKey)
    if (statusIsFailure(assertion.status)) suiteStatus.failed = true
    if (statusIsPending(assertion.status)) suiteStatus.pending = true
  }
  const errors = normalizeStringErrors(assertion.failureMessages, failures, 'Vitest assertion failure messages')
  if (!VITEST_STATUSES.has(status)) failures.push(`Vitest assertion ${id} has an unsupported status.`)
  if (!isRecord(assertion.meta)) failures.push(`Vitest assertion ${id} metadata is invalid.`)
  if (isRecord(assertion.meta) && assertion.meta.retry !== undefined
      && (!Number.isSafeInteger(assertion.meta.retry) || assertion.meta.retry < 0
        || assertion.meta.retry !== 0)) {
    failures.push(`Vitest assertion ${id} reports an invalid retry.`)
  }
  if (!Array.isArray(assertion.tags) || assertion.tags.some((tag) => typeof tag !== 'string')) {
    failures.push(`Vitest assertion ${id} tags are invalid.`)
  }
  if (assertion.duration !== undefined
      && (!Number.isFinite(assertion.duration) || assertion.duration < 0)) {
    failures.push(`Vitest assertion ${id} duration is invalid.`)
  }
  if (status !== 'passed' || errors.length > 0) failures.push(`Vitest assertion ${id} did not pass cleanly.`)
  if (observed.testIds.includes(id)) failures.push(`Vitest assertion ${id} is duplicated.`)
  observed.testIds.push(id)
  observed.tests.push({
    id,
    file,
    fullName: canonicalName,
    reportFullName: assertion.fullName,
    status,
    errors,
    duration: typeof assertion.duration === 'number' ? assertion.duration : null,
  })
  observed.errors.push(...errors)
}

/** Validate Vitest aggregate counts against every parsed assertion result. */
function validateVitestAggregates(report, observed, failures) {
  const statuses = observed.tests.map((test) => test.status)
  const total = statuses.length
  const passed = statuses.filter((status) => status === 'passed').length
  const failed = statuses.filter((status) => status === 'failed').length
  const pending = statuses.filter((status) => ['skipped', 'pending', 'disabled'].includes(status)).length
  const todo = statuses.filter((status) => status === 'todo').length
  const suiteStatuses = [...observed.vitestSuiteStatuses.values()]
  const failedSuites = suiteStatuses.filter((suite) => suite.failed).length
  const pendingSuites = suiteStatuses.filter((suite) => !suite.failed && suite.pending).length
  const expected = {
    numTotalTestSuites: observed.vitestSuiteKeys.size,
    numPassedTestSuites: observed.vitestSuiteKeys.size - failedSuites - pendingSuites,
    numFailedTestSuites: failedSuites,
    numPendingTestSuites: pendingSuites,
    numTotalTests: total,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    numTodoTests: todo,
  }
  for (const [field, value] of Object.entries(expected)) {
    if (report[field] !== value) failures.push(`Vitest aggregate ${field} does not match parsed assertions.`)
  }
  if (report.success !== true || total < 1 || passed !== total || failed !== 0 || pending !== 0 || todo !== 0) {
    failures.push('Vitest report is not a complete, non-empty green run.')
  }
}

/** Validate the scalar and snapshot parts of a Vitest aggregate report. */
function validateVitestRootScalars(report, failures) {
  for (const field of [
    'numFailedTests', 'numFailedTestSuites', 'numPassedTests', 'numPassedTestSuites',
    'numPendingTests', 'numPendingTestSuites', 'numTodoTests', 'numTotalTests',
    'numTotalTestSuites',
  ]) {
    if (!Number.isSafeInteger(report[field]) || report[field] < 0) {
      failures.push(`Vitest aggregate ${field} is invalid.`)
    }
  }
  if (!Number.isFinite(report.startTime) || report.startTime < 0) failures.push('Vitest startTime is invalid.')
  if (typeof report.success !== 'boolean') failures.push('Vitest success flag is invalid.')
}

/** Validate the exact scalar and list types in Vitest's snapshot summary. */
function validateVitestSnapshot(snapshot, failures) {
  for (const field of [
    'added', 'filesAdded', 'filesRemoved', 'filesUnmatched', 'filesUpdated',
    'matched', 'total', 'unchecked', 'unmatched', 'updated',
  ]) {
    if (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0) {
      failures.push(`Vitest snapshot ${field} is invalid.`)
    }
  }
  if (snapshot.failure !== false || snapshot.didUpdate !== false) {
    failures.push('Vitest snapshot summary reports a failure or update.')
  }
  if (!Array.isArray(snapshot.filesRemovedList) || !Array.isArray(snapshot.uncheckedKeysByFile)) {
    failures.push('Vitest snapshot summary lists are invalid.')
  }
}

/** Register one Vitest module or describe suite for aggregate accounting. */
function markVitestSuite(observed, suiteKey) {
  observed.vitestSuiteKeys.add(suiteKey)
  if (!observed.vitestSuiteStatuses.has(suiteKey)) {
    observed.vitestSuiteStatuses.set(suiteKey, { failed: false, pending: false })
  }
}

/** Return whether a Vitest assertion status represents a failure. */
function statusIsFailure(status) {
  return status === 'failed'
}

/** Return whether a Vitest assertion status represents pending or todo work. */
function statusIsPending(status) {
  return ['skipped', 'pending', 'todo', 'disabled'].includes(status)
}

/** Parse and independently validate the current Playwright JSON reporter shape. */
function parsePlaywrightReport(report, binding, observed, failures) {
  if (!hasExactKeys(report, PLAYWRIGHT_ROOT_KEYS)) {
    failures.push('Playwright JSON report has missing or unsupported root fields.')
    return
  }
  if (!isRecord(report.config) || typeof report.config.rootDir !== 'string'
      || !path.isAbsolute(report.config.rootDir)) {
    failures.push('Playwright report does not carry an absolute config rootDir.')
    return
  }
  if (!Array.isArray(report.errors)) failures.push('Playwright report root errors are invalid.')
  else if (report.errors.length > 0) {
    observed.errors.push(...report.errors)
    failures.push('Playwright report contains root errors.')
  }
  if (!hasExactKeys(report.stats, PLAYWRIGHT_STATS_KEYS)) {
    failures.push('Playwright stats have missing or unsupported fields.')
  } else {
    validatePlaywrightStats(report.stats, failures)
  }
  if (!Array.isArray(report.suites) || report.suites.length < 1) {
    failures.push('Playwright report contains zero suites.')
    return
  }
  for (const suite of report.suites) {
    parsePlaywrightSuite(suite, report.config.rootDir, [], observed, failures)
  }
  if (isRecord(report.stats) && report.stats.expected !== observed.tests.length) {
    failures.push('Playwright expected count does not match parsed test results.')
  }
  if (observed.tests.length < 1) failures.push('Playwright report contains zero executed tests.')
}

/** Validate Playwright aggregate status counters and duration identity. */
function validatePlaywrightStats(stats, failures) {
  if (typeof stats.startTime !== 'string' || !Number.isFinite(Date.parse(stats.startTime))) {
    failures.push('Playwright stats startTime is invalid.')
  }
  if (!Number.isFinite(stats.duration) || stats.duration < 0) failures.push('Playwright stats duration is invalid.')
  for (const field of ['expected', 'skipped', 'unexpected', 'flaky']) {
    if (!Number.isSafeInteger(stats[field]) || stats[field] < 0) failures.push(`Playwright stats ${field} is invalid.`)
  }
  if (stats.skipped !== 0 || stats.unexpected !== 0 || stats.flaky !== 0) {
    failures.push('Playwright report contains skipped, unexpected, or flaky tests.')
  }
}

/** Recursively parse one Playwright file/suite and its nested specs. */
function parsePlaywrightSuite(suite, rootDir, ancestors, observed, failures) {
  if (!hasAllowedKeys(suite, PLAYWRIGHT_SUITE_REQUIRED_KEYS, ['suites'])) {
    failures.push('Playwright suite has missing or unsupported fields.')
    return
  }
  if (typeof suite.file !== 'string' || !REPO_RELATIVE_PATH.test(suite.file)) {
    failures.push('Playwright suite file is not a safe report-relative path.')
    return
  }
  if (typeof suite.title !== 'string' || suite.title.length < 1
      || !Number.isSafeInteger(suite.line) || suite.line < 0
      || !Number.isSafeInteger(suite.column) || suite.column < 0) {
    failures.push('Playwright suite location or title is invalid.')
    return
  }
  const file = repoPathFromPlaywright(rootDir, suite.file, failures)
  if (file === null) return
  if (!observed.files.includes(file)) observed.files.push(file)
  if (!Array.isArray(suite.specs) || (suite.suites !== undefined && !Array.isArray(suite.suites))) {
    failures.push(`Playwright suite ${file} has invalid specs or suites.`)
    return
  }
  const childSuites = suite.suites ?? []
  const nestedAncestors = ancestors.length === 0 && suite.title === path.posix.basename(suite.file)
    ? ancestors
    : [...ancestors, suite.title]
  for (const spec of suite.specs) parsePlaywrightSpec(spec, file, nestedAncestors, rootDir, observed, failures)
  for (const child of childSuites) parsePlaywrightSuite(child, rootDir, nestedAncestors, observed, failures)
}

/** Parse one Playwright spec and every project test record under it. */
function parsePlaywrightSpec(spec, suiteFile, ancestors, rootDir, observed, failures) {
  if (!hasExactKeys(spec, PLAYWRIGHT_SPEC_KEYS)) {
    failures.push('Playwright spec has missing or unsupported fields.')
    return
  }
  if (typeof spec.title !== 'string' || spec.title.length < 1 || !Array.isArray(spec.tests)
      || typeof spec.id !== 'string' || spec.id.length < 1
      || typeof spec.ok !== 'boolean'
      || !Array.isArray(spec.tags) || spec.tags.some((tag) => typeof tag !== 'string')
      || !Number.isSafeInteger(spec.line) || spec.line < 0
      || !Number.isSafeInteger(spec.column) || spec.column < 0) {
    failures.push('Playwright spec identity or tests are invalid.')
    return
  }
  if (spec.ok !== true) failures.push(`Playwright spec ${spec.title} did not pass cleanly.`)
  if (typeof spec.file !== 'string' || repoPathFromPlaywright(rootDir, spec.file, failures) !== suiteFile) {
    failures.push('Playwright spec file does not match its enclosing suite.')
  }
  const fullName = [...ancestors, spec.title].join(' > ')
  for (const test of spec.tests) parsePlaywrightTest(test, suiteFile, fullName, observed, failures)
}

/** Parse one Playwright project test and retain all attempts and error records. */
function parsePlaywrightTest(test, file, fullName, observed, failures) {
  if (!hasExactKeys(test, PLAYWRIGHT_TEST_KEYS)) {
    failures.push('Playwright test has missing or unsupported fields.')
    return
  }
  const id = `${file}::${fullName}`
  if (observed.testIds.includes(id)) failures.push(`Playwright test ${id} is duplicated.`)
  observed.testIds.push(id)
  if (!Array.isArray(test.annotations)
      || typeof test.expectedStatus !== 'string'
      || typeof test.projectId !== 'string' || test.projectId.length < 1
      || typeof test.projectName !== 'string' || test.projectName.length < 1
      || !Number.isSafeInteger(test.timeout) || test.timeout < 1) {
    failures.push(`Playwright test ${id} identity or execution settings are invalid.`)
  }
  if (!Array.isArray(test.results) || test.results.length < 1) {
    failures.push(`Playwright test ${id} has no executed attempt.`)
  }
  const attempts = Array.isArray(test.results)
    ? test.results.map((attempt) => parsePlaywrightAttempt(attempt, id, observed, failures))
    : []
  const errors = attempts.flatMap((attempt) => attempt.errors)
  const status = test.status
  if (test.expectedStatus !== 'passed' || status !== 'expected') {
    failures.push(`Playwright test ${id} did not have an expected passing status.`)
  }
  if (attempts.length !== 1 || attempts.some((attempt) => attempt.retry !== 0
      || attempt.status !== 'passed' || attempt.errors.length > 0)) {
    failures.push(`Playwright test ${id} has a retry, failure, or unexpected attempt.`)
  }
  observed.tests.push({
    id,
    file,
    fullName,
    status,
    expectedStatus: test.expectedStatus,
    attempts,
    errors,
  })
  observed.errors.push(...errors)
}

/** Parse one Playwright attempt without discarding structured errors. */
function parsePlaywrightAttempt(attempt, id, observed, failures) {
  if (!hasAllowedKeys(attempt, PLAYWRIGHT_RESULT_KEYS, PLAYWRIGHT_RESULT_OPTIONAL_KEYS)) {
    failures.push(`Playwright test ${id} attempt has missing or unsupported fields.`)
    return { retry: null, status: null, errors: [] }
  }
  const errors = Array.isArray(attempt.errors) ? [...attempt.errors] : []
  if (!Array.isArray(attempt.errors)) failures.push(`Playwright test ${id} attempt errors are invalid.`)
  if (!Number.isSafeInteger(attempt.retry) || attempt.retry < 0) failures.push(`Playwright test ${id} retry is invalid.`)
  if (!PLAYWRIGHT_RESULT_STATUSES.has(attempt.status)) failures.push(`Playwright test ${id} attempt status is invalid.`)
  if (!Number.isSafeInteger(attempt.workerIndex) || attempt.workerIndex < 0
      || !Number.isSafeInteger(attempt.parallelIndex) || attempt.parallelIndex < 0
      || !Number.isFinite(attempt.duration) || attempt.duration < 0
      || typeof attempt.startTime !== 'string' || !Number.isFinite(Date.parse(attempt.startTime))
      || !Array.isArray(attempt.stdout) || !Array.isArray(attempt.stderr)
      || !Array.isArray(attempt.annotations) || !Array.isArray(attempt.attachments)) {
    failures.push(`Playwright test ${id} attempt execution fields are invalid.`)
  }
  if (attempt.error !== undefined && attempt.error !== null) errors.push(attempt.error)
  return {
    workerIndex: attempt.workerIndex,
    parallelIndex: attempt.parallelIndex,
    status: attempt.status,
    duration: attempt.duration,
    retry: attempt.retry,
    startTime: attempt.startTime,
    annotations: attempt.annotations,
    attachments: attempt.attachments,
    stdout: attempt.stdout,
    stderr: attempt.stderr,
    errors,
    ...(attempt.error !== undefined ? { error: attempt.error } : {}),
    ...(attempt.errorLocation !== undefined ? { errorLocation: attempt.errorLocation } : {}),
    ...(attempt.steps !== undefined ? { steps: attempt.steps } : {}),
  }
}

/** Compare the parsed report inventory with the exact controller plan. */
function compareExpectedInventory(binding, observed, failures) {
  const files = sortedUnique(observed.files)
  const testIds = sortedUnique(observed.testIds)
  const expectedFiles = Array.isArray(binding.files) ? [...binding.files].sort() : []
  const expectedTestIds = Array.isArray(binding.testIds) ? [...binding.testIds].sort() : []
  if (!sameArray(files, expectedFiles)) failures.push('Observed test file inventory differs from the expected inventory.')
  if (!sameArray(testIds, expectedTestIds)) failures.push('Observed test ID inventory differs from the expected inventory.')
}

/** Normalize an absolute Vitest file path into a safe repository-relative path. */
function repoPathFromAbsolute(value, failures, label) {
  const relative = path.relative(process.cwd(), value)
  if (!isRepoRelativePath(relative)) {
    failures.push(`${label} is outside the current repository root.`)
    return null
  }
  return toPosix(relative)
}

/** Normalize a Playwright report-relative path against its absolute rootDir. */
function repoPathFromPlaywright(rootDir, value, failures) {
  const absolute = path.resolve(rootDir, value)
  return repoPathFromAbsolute(absolute, failures, 'Playwright file')
}

/** Build one immutable result retaining observed tests and structured errors. */
function makeResult({ binding, observed, failures }) {
  const uniqueFailures = [...new Set(failures)]
  const runner = binding?.runner ?? null
  const proofMode = binding?.proofMode ?? null
  return Object.freeze({
    runner,
    proofMode,
    sourceSha: binding?.sourceSha ?? null,
    sourceBinding: binding === null
      ? null
      : 'controller-supplied; runner JSON has no source identity field',
    status: uniqueFailures.length === 0 ? 'PASS' : 'INVALID_EVIDENCE',
    valid: uniqueFailures.length === 0,
    passed: uniqueFailures.length === 0,
    releaseEligible: false,
    files: Object.freeze([...observed.files]),
    testIds: Object.freeze([...observed.testIds]),
    tests: Object.freeze(observed.tests.map((test) => Object.freeze({
      ...test,
      errors: Object.freeze([...test.errors]),
      ...(Array.isArray(test.attempts)
        ? { attempts: Object.freeze(test.attempts.map((attempt) => Object.freeze({
          ...attempt,
          errors: Object.freeze([...attempt.errors]),
        }))) }
        : {}),
    }))),
    errors: Object.freeze([...observed.errors]),
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Normalize a reporter's string error array and reject missing error detail. */
function normalizeStringErrors(value, failures, label) {
  if (!Array.isArray(value) || value.some((error) => typeof error !== 'string')) {
    failures.push(`${label} are invalid.`)
    return []
  }
  return [...value]
}

/** Return whether one value is a non-array object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Return whether a record has exactly the requested own keys. */
function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

/** Return whether a record has exactly required keys plus allowed optional keys. */
function hasAllowedKeys(value, required, optional) {
  if (!isRecord(value)) return false
  const allowed = new Set([...required, ...optional])
  const actual = Object.keys(value)
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && actual.every((key) => allowed.has(key))
}

/** Return whether a canonical test ID has a safe file prefix and non-empty name. */
function isTestId(value) {
  const separator = value.indexOf('::')
  return separator > 0 && separator < value.length - 2
    && REPO_RELATIVE_PATH.test(value.slice(0, separator))
    && value.slice(separator + 2).trim().length > 0
}

/** Return whether a path is inside the current repository using POSIX syntax. */
function isRepoRelativePath(value) {
  return typeof value === 'string' && value.length > 0
    && !path.isAbsolute(value)
    && !value.split(path.sep).includes('..')
    && path.posix.normalize(toPosix(value)) === toPosix(value)
    && REPO_RELATIVE_PATH.test(toPosix(value))
}

/** Convert platform separators to the canonical POSIX report path form. */
function toPosix(value) {
  return value.split(path.sep).join('/')
}

/** Return sorted unique strings without mutating observed evidence. */
function sortedUnique(values) {
  return [...new Set(values)].sort()
}

/** Compare two already-normalized arrays exactly. */
function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
