import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { contractSuiteVariants, selectContractSuite } from './contract-suite-catalog.mjs'
import { validateTestSuiteReceipt } from './test-suite-receipts.mjs'
import { runOwnedProcess } from './owned-process.mjs'
import { assertOwnedProcessCleanup } from './owned-process-custody.mjs'

const execFile = promisify(execFileCallback)
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHA1 = /^[a-f0-9]{40}$/u
const SAFE_REPOSITORY_PATH = /^(?!\/)(?![A-Za-z]:[\\/])[A-Za-z0-9._/-]+$/u
const MAX_BUFFER = 64 * 1024 * 1024
const COMMAND_TIMEOUT = 10 * 60 * 1000
const REVIEWED_VARIANTS = new Set(contractSuiteVariants().map(({ contractId, proofMode }) => `${contractId}:${proofMode}`))

/**
 * Compile a fixed source/browser contract selection into immutable test IDs.
 *
 * Discovery is performed by the reviewed runner itself. Runtime-supplied
 * commands are deliberately ignored; the catalog owns the selected files and
 * this module owns the runner command used to discover them.
 *
 * @param {object} binding contract and proof-mode selection
 * @param {string} sourceSha controller-bound source SHA-1
 * @returns {Promise<object>} frozen exact runner binding
 */
export async function compileSuiteBinding(binding, sourceSha) {
  validateBinding(binding)
  validateSourceSha(sourceSha)
  const repositoryFiles = await trackedRepositoryFiles(REPOSITORY_ROOT)
  const selection = selectContractSuite(binding.contractId, binding.proofMode, repositoryFiles)
  const discovered = selection.runner === 'vitest'
    ? await discoverVitest(selection.files, REPOSITORY_ROOT)
    : await discoverPlaywright(selection.files, REPOSITORY_ROOT)
  const expected = {
    runner: selection.runner,
    files: sortedUnique(discovered.files),
    testIds: sortedUnique(discovered.testIds),
    sourceSha,
    proofMode: selection.proofMode,
  }
  assertExactSelection(expected, selection.files)
  return freezeExpected(expected)
}

/**
 * Execute one reviewed source/browser variant with owned output paths.
 *
 * The runner receives no arbitrary command from the binding. Retries are
 * explicitly disabled and the retained JSON is independently validated before
 * a process exit can contribute to the result.
 *
 * @param {object} options execution options
 * @returns {Promise<object>} immutable execution receipt
 */
export async function executeSuiteVariant({ binding, expected, attemptDirectory, workDirectory }) {
  validateBinding(binding)
  validateExpected(expected)
  const immutableExpected = freezeExpected(expected)
  validateBindingAgainstExpected(binding, immutableExpected)
  const attemptRoot = await requireDirectory(attemptDirectory, 'attempt directory')
  const workRoot = await requireDirectory(workDirectory, 'work directory')
  const reportPath = path.join(attemptRoot, 'suite-report.json')
  const stdoutPath = path.join(attemptRoot, 'suite-stdout.log')
  const stderrPath = path.join(attemptRoot, 'suite-stderr.log')
  await assertNewOutput([reportPath, stdoutPath, stderrPath])

  if (immutableExpected.runner === 'playwright') {
    const configSource = `import base from ${JSON.stringify(pathToFileURL(path.join(REPOSITORY_ROOT, 'playwright.config.ts')).href)};\n`
      + `import { qualificationBrowserConfig } from ${JSON.stringify(pathToFileURL(path.join(REPOSITORY_ROOT, 'scripts/qualification/browser-suite-config.mjs')).href)};\n`
      + `export default qualificationBrowserConfig(base, ${JSON.stringify(REPOSITORY_ROOT)}, ${JSON.stringify(path.join(workRoot, 'browser-output'))});\n`
    await writeFile(path.join(workRoot, 'qualification.config.mjs'), configSource, { flag: 'wx', mode: 0o600 })
  }
  const command = runnerCommand(immutableExpected, REPOSITORY_ROOT, reportPath, workRoot)
  let stdout = ''
  let stderr = ''
  const execution = await runOwnedProcess({
    ...command,
    timeoutMs: COMMAND_TIMEOUT,
    maxOutputBytes: MAX_BUFFER,
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      PLAYWRIGHT_OUTPUT_DIR: path.join(workRoot, 'browser-output'),
      PLAYWRIGHT_HTML_OUTPUT_DIR: workRoot,
      VITEST_OUTPUT_DIR: workRoot,
    },
  })
  assertOwnedProcessCleanup(execution, `suite.${immutableExpected.proofMode}`)
  stdout = execution.stdout
  stderr = execution.stderr
  const { exitCode, processError } = execution
  await writeFile(stdoutPath, stdout, { encoding: 'utf8', flag: 'wx' })
  await writeFile(stderrPath, stderr, { encoding: 'utf8', flag: 'wx' })

  const report = await obtainReport({ runner: immutableExpected.runner, reportPath, stdout })
  const validation = validateTestSuiteReceipt(report, immutableExpected)
  const result = resultFromValidation({
    binding,
    expected: immutableExpected,
    validation,
    reportPath,
    stdoutPath,
    stderrPath,
    workDirectory: workRoot,
    exitCode,
    processError,
  })
  if (!await pathExists(reportPath)) await writeJsonExclusive(reportPath, report)
  const captures = immutableExpected.runner === 'playwright'
    ? await retainBrowserCaptures(validation.tests, workRoot, attemptRoot, result.status === 'PASS') : []
  return Object.freeze({ ...result, captures })
}

/**
 * Re-read retained runner JSON and compare it with the immutable plan.
 *
 * @param {object} receipt previously retained execution receipt
 * @param {object} binding contract and proof-mode selection
 * @param {object} ctx retained report context
 * @returns {Promise<object>} immutable revalidated receipt
 */
export async function validateRetainedSuite(receipt, binding, ctx) {
  validateBinding(binding)
  validateExpected(ctx?.expected)
  const immutableExpected = freezeExpected(ctx.expected)
  validateBindingAgainstExpected(binding, immutableExpected)
  if (!isRecord(receipt)) throw new Error('Retained suite receipt is required.')
  const attemptRoot = await requireDirectory(ctx.attemptDirectory, 'attempt directory')
  const reportPath = await requirePathInside(receipt.reportPath, attemptRoot, 'retained suite report')
  await requireRegularFile(reportPath, 'retained suite report')
  const report = await parseJsonFile(reportPath, 'retained suite report')
  const validation = validateTestSuiteReceipt(report, immutableExpected)
  const retainedIdentityFailures = []
  if (immutableExpected.runner === 'playwright' && validation.status === 'PASS') {
    if (!Array.isArray(receipt.captures) || receipt.captures.length !== validation.tests.length) throw new Error('Every browser test requires its retained rendered frame.')
    for (const [index, capture] of receipt.captures.entries()) {
      if (capture.name !== `browser-${String(index + 1).padStart(4, '0')}.png`
          || capture.testId !== validation.tests[index].id) throw new Error('Browser frame inventory differs from the exact runner tests.')
      const bytes = await readPng(path.join(attemptRoot, capture.name), attemptRoot)
      if (createHash('sha256').update(bytes).digest('hex') !== capture.sha256) throw new Error('Retained browser frame bytes differ.')
    }
  }
  if (receipt.runner !== undefined && receipt.runner !== immutableExpected.runner) retainedIdentityFailures.push('Retained runner differs from expected binding.')
  if (receipt.proofMode !== undefined && receipt.proofMode !== immutableExpected.proofMode) retainedIdentityFailures.push('Retained proof mode differs from expected binding.')
  if (receipt.sourceSha !== undefined && receipt.sourceSha !== immutableExpected.sourceSha) retainedIdentityFailures.push('Retained source SHA differs from expected binding.')
  if (receipt.exitCode !== undefined && receipt.exitCode !== 0) retainedIdentityFailures.push('Runner process did not exit successfully.')
  if (receipt.status !== undefined && receipt.status !== validation.status) retainedIdentityFailures.push('Retained status differs from recomputed report validation.')
  if (receipt.validation && typeof receipt.validation === 'object' && receipt.validation.status !== validation.status) retainedIdentityFailures.push('Retained validation status differs from recomputed report validation.')
  if (receipt.expected !== undefined && !sameExpected(receipt.expected, immutableExpected)) retainedIdentityFailures.push('Retained expected binding differs from the immutable expected plan.')
  const adjustedValidation = withAdditionalFailures(validation, retainedIdentityFailures)
  return Object.freeze({
    ...receipt,
    reportPath,
    expected: immutableExpected,
    validation: adjustedValidation,
    status: adjustedValidation.status,
    valid: adjustedValidation.valid,
    passed: adjustedValidation.passed,
    releaseEligible: false,
    runner: immutableExpected.runner,
    proofMode: immutableExpected.proofMode,
    sourceSha: immutableExpected.sourceSha,
    files: adjustedValidation.files,
    testIds: adjustedValidation.testIds,
    tests: adjustedValidation.tests,
    errors: adjustedValidation.errors,
    failureReasons: adjustedValidation.failureReasons,
  })
}

/** Validate the public binding shape before passing it to the catalog. */
function validateBinding(binding) {
  if (!isRecord(binding) || typeof binding.contractId !== 'string' || !/^C(?:0[0-9]|1[0-9]|2[0-9])$/u.test(binding.contractId)) {
    throw new Error('Suite binding must identify one reviewed contract.')
  }
  if (binding.proofMode !== 'source' && binding.proofMode !== 'browser') {
    throw new Error('Suite binding proof mode must be source or browser.')
  }
  if (!REVIEWED_VARIANTS.has(`${binding.contractId}:${binding.proofMode}`)) {
    throw new Error('Suite binding is not a reviewed source/browser variant.')
  }
}

/** Validate the immutable runner plan shape accepted by the receipt parser. */
function validateExpected(expected) {
  if (!isRecord(expected)
      || expected.runner !== (expected.proofMode === 'source' ? 'vitest' : expected.proofMode === 'browser' ? 'playwright' : null)
      || !SHA1.test(expected.sourceSha)
      || !Array.isArray(expected.files) || expected.files.length === 0
      || !Array.isArray(expected.testIds) || expected.testIds.length === 0
      || expected.files.some((file) => !isSafeRepositoryPath(file))
      || expected.testIds.some((testId) => !isSafeTestId(testId, expected.files))
      || new Set(expected.files).size !== expected.files.length
      || new Set(expected.testIds).size !== expected.testIds.length) {
    throw new Error('Suite expected binding is incomplete or unsafe.')
  }
  const expectedKeys = ['files', 'proofMode', 'runner', 'sourceSha', 'testIds']
  if (Object.keys(expected).sort().join('\0') !== expectedKeys.sort().join('\0')) throw new Error('Suite expected binding contains unsupported fields.')
}

/** Ensure the selected contract uses the expected reviewed runner. */
function validateBindingAgainstExpected(binding, expected) {
  const runner = binding.proofMode === 'source' ? 'vitest' : 'playwright'
  if (expected.proofMode !== binding.proofMode || expected.runner !== runner) throw new Error('Suite binding and expected runner disagree.')
}

/** Validate a controller-bound source identity. */
function validateSourceSha(sourceSha) {
  if (typeof sourceSha !== 'string' || !SHA1.test(sourceSha)) throw new Error('Suite source SHA must be a 40-character lowercase SHA-1.')
}

/** Discover the tracked repository files used by the fixed catalog. */
async function trackedRepositoryFiles(repositoryRoot) {
  const { stdout } = await execFile('git', ['ls-files', '-z', '--', 'tests'], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: MAX_BUFFER })
  return stdout.split('\0').filter(Boolean)
}

/** Run Vitest's JSON collector for the exact selected source files. */
async function discoverVitest(files, repositoryRoot) {
  const cli = path.join(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs')
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-vitest-config-'))
  const config = path.join(configDirectory, 'vitest.config.mjs')
  const configSource = [
    `import base from ${JSON.stringify(path.join(repositoryRoot, 'vitest.config.ts'))}`,
    `export default { ...base, root: ${JSON.stringify(repositoryRoot)}, test: { ...base.test, include: ${JSON.stringify(files)} } }`,
    '',
  ].join('\n')
  await writeFile(config, configSource, { encoding: 'utf8', flag: 'wx' })
  try {
    const { stdout } = await execFile(process.execPath, [cli, 'list', '--json', '--root', repositoryRoot, '--config', config, ...files], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: COMMAND_TIMEOUT,
    })
    const entries = parseJsonOutput(stdout, 'Vitest discovery')
    if (!Array.isArray(entries)) throw new Error('Vitest discovery did not return an array.')
    const discovered = entries.map((entry) => {
      if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.file !== 'string') throw new Error('Vitest discovery entry is incomplete.')
      const file = relativeRepositoryPath(repositoryRoot, entry.file)
      return { file, testId: `${file}::${entry.name}` }
    })
    return { files: discovered.map(({ file }) => file), testIds: discovered.map(({ testId }) => testId) }
  } finally {
    await rm(configDirectory, { recursive: true, force: true })
  }
}

/** Run Playwright's JSON list reporter without launching a browser. */
async function discoverPlaywright(files, repositoryRoot) {
  const cli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')
  const config = path.join(repositoryRoot, 'playwright.config.ts')
  const { stdout } = await execFile(process.execPath, [cli, 'test', '--list', '--project=chromium', '--reporter=json', '--config', config, ...files], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: COMMAND_TIMEOUT,
  })
  const report = parseJsonOutput(stdout, 'Playwright discovery')
  const discovered = []
  if (typeof report?.config?.rootDir !== 'string' || !path.isAbsolute(report.config.rootDir)) throw new Error('Playwright discovery root is missing.')
  walkPlaywrightSuites(report?.suites, [], repositoryRoot, discovered, report.config.rootDir)
  if (discovered.length === 0) throw new Error('Playwright discovery returned no tests.')
  return { files: discovered.map(({ file }) => file), testIds: discovered.map(({ testId }) => testId) }
}

/** Collect canonical Playwright test IDs from nested JSON suites. */
function walkPlaywrightSuites(suites, ancestors, repositoryRoot, discovered, testRoot) {
  if (!Array.isArray(suites)) return
  for (const suite of suites) {
    if (!isRecord(suite)) continue
    const title = typeof suite.title === 'string' ? suite.title : ''
    const nextAncestors = title.endsWith('.spec.ts') ? ancestors : [...ancestors, ...(title ? [title] : [])]
    const fileValue = typeof suite.file === 'string' ? suite.file : null
    const file = fileValue ? relativeRepositoryPath(repositoryRoot, path.resolve(testRoot, fileValue)) : null
    if (Array.isArray(suite.specs) && file) {
      for (const spec of suite.specs) {
        if (!isRecord(spec) || typeof spec.title !== 'string') continue
        const fullName = [...nextAncestors, spec.title].join(' > ')
        discovered.push({ file, testId: `${file}::${fullName}` })
      }
    }
    walkPlaywrightSuites(suite.suites, nextAncestors, repositoryRoot, discovered, testRoot)
  }
}

/** Construct the only supported direct Node runner command. */
function runnerCommand(expected, repositoryRoot, reportPath, workDirectory) {
  if (expected.runner === 'vitest') {
    return {
      file: process.execPath,
      args: [path.join(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism', '--reporter=json', '--retry=0', `--outputFile=${reportPath}`, '--root', repositoryRoot, '--config', path.join(repositoryRoot, 'vitest.config.ts'), ...expected.files],
    }
  }
  if (expected.runner === 'playwright') {
    return {
      file: process.execPath,
      args: [path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--project=chromium', '--reporter=json', '--retries=0', '--output', path.join(workDirectory, 'browser-output'), '--config', path.join(workDirectory, 'qualification.config.mjs'), ...expected.files],
    }
  }
  throw new Error('Unsupported suite runner.')
}

/** Retain available failed frames too; passing workflows require exactly one frame each. */
export async function retainBrowserCaptures(tests, workRoot, attemptRoot, requireAll = true) {
  const captures = []
  for (const [index, test] of tests.entries()) {
    const screenshots = test.attempts[0]?.attachments?.filter((attachment) => attachment.contentType === 'image/png') ?? []
    if (!requireAll && screenshots.length === 0) continue
    if (screenshots.length !== 1) throw new Error('Each browser workflow requires exactly one final rendered PNG.')
    const bytes = await readPng(screenshots[0].path, workRoot)
    const name = `browser-${String(index + 1).padStart(4, '0')}.png`
    const destination = path.join(attemptRoot, name)
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
    captures.push({ name, path: destination, kind: 'image', testId: test.id, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  return captures
}

/** Reject path escape, symlinks, oversized data and non-PNG browser attachments. */
async function readPng(filename, root) {
  const source = await requirePathInside(filename, root, 'browser screenshot')
  const metadata = await lstat(source)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 8 || metadata.size > 16 * 1024 * 1024) throw new Error('Browser screenshot has an unsafe file type or size.')
  const bytes = await readFile(source)
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Browser screenshot is not a PNG.')
  return bytes
}

/** Obtain the runner's report from its output file or JSON stdout. */
async function obtainReport({ runner, reportPath, stdout }) {
  try {
    return await parseJsonFile(reportPath, 'runner report')
  } catch (error) {
    if (runner === 'playwright' || error?.code === 'ENOENT') {
      try {
        return parseJsonOutput(stdout, 'runner JSON report', true)
      } catch {
        return {}
      }
    }
    return {}
  }
}

/** Recompute a strict receipt while retaining process failures as evidence failures. */
function resultFromValidation({ binding, expected, validation, reportPath, stdoutPath, stderrPath, workDirectory, exitCode, processError }) {
  const failures = []
  if (exitCode !== 0) failures.push(`Runner process exited with code ${exitCode ?? 'unknown'}.`)
  if (processError) failures.push(processError)
  const adjustedValidation = withAdditionalFailures(validation, failures)
  return Object.freeze({
    schema: 'sartracker-qualification-suite-receipt-v1',
    contractId: binding.contractId,
    runner: expected.runner,
    proofMode: expected.proofMode,
    sourceSha: expected.sourceSha,
    expected,
    reportPath,
    stdoutPath,
    stderrPath,
    workDirectory,
    exitCode,
    processError,
    validation: adjustedValidation,
    status: adjustedValidation.status,
    valid: adjustedValidation.valid,
    passed: adjustedValidation.passed,
    releaseEligible: false,
    files: adjustedValidation.files,
    testIds: adjustedValidation.testIds,
    tests: adjustedValidation.tests,
    errors: adjustedValidation.errors,
    failureReasons: adjustedValidation.failureReasons,
  })
}

/** Add adapter-level failures to a frozen parser result. */
function withAdditionalFailures(validation, additions) {
  const failureReasons = [...new Set([...validation.failureReasons, ...additions])]
  if (failureReasons.length === 0) return validation
  return Object.freeze({
    ...validation,
    status: 'INVALID_EVIDENCE',
    valid: false,
    passed: false,
    failureReasons: Object.freeze(failureReasons),
  })
}

/** Freeze the exact expected plan and its arrays. */
function freezeExpected(expected) {
  return Object.freeze({
    runner: expected.runner,
    files: Object.freeze([...expected.files]),
    testIds: Object.freeze([...expected.testIds]),
    sourceSha: expected.sourceSha,
    proofMode: expected.proofMode,
  })
}

/** Ensure discovery contains exactly the catalog's selected files. */
function assertExactSelection(expected, selectedFiles) {
  if (!sameArray(expected.files, [...selectedFiles].sort()) || expected.testIds.length === 0) throw new Error('Runner discovery differs from the reviewed suite selection.')
  if (new Set(expected.testIds).size !== expected.testIds.length) throw new Error('Runner discovery returned duplicate test identities.')
}

/** Create a directory and reject a symlink at its root. */
async function requireDirectory(directory, label) {
  if (typeof directory !== 'string' || path.resolve(directory) !== directory) throw new Error(`${label} must be an absolute path.`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const entry = await lstat(directory)
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`${label} must be a real directory.`)
  return await realpath(directory)
}

/** Ensure output files cannot overwrite retained evidence. */
async function assertNewOutput(paths) {
  for (const outputPath of paths) {
    try {
      await lstat(outputPath)
      throw new Error(`Suite output already exists: ${outputPath}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/** Write one JSON object without replacing an existing receipt. */
async function writeJsonExclusive(outputPath, value) {
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

/** Require a regular retained file inside the owned attempt directory. */
async function requirePathInside(candidate, root, label) {
  if (typeof candidate !== 'string' || path.resolve(candidate) !== candidate) throw new Error(`${label} path is invalid.`)
  const resolvedRoot = path.resolve(root)
  const candidateRealpath = await realpath(candidate).catch(() => candidate)
  if (candidateRealpath !== resolvedRoot && !candidateRealpath.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`${label} is outside the attempt directory.`)
  return candidate
}

/** Ensure a retained path is a non-symlink regular file. */
async function requireRegularFile(filePath, label) {
  const entry = await lstat(filePath)
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} must be a regular file.`)
}

/** Return whether a path exists without following an error into the caller. */
async function pathExists(filePath) {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** Parse a retained JSON file. */
async function parseJsonFile(filePath, label) {
  const content = await readFile(filePath, 'utf8')
  try {
    return JSON.parse(content)
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

/** Parse runner output that may contain only one JSON value. */
function parseJsonOutput(output, label, allowEmpty = false) {
  if (typeof output !== 'string' || output.trim().length === 0) {
    if (allowEmpty) return {}
    throw new Error(`${label} is empty.`)
  }
  try {
    return JSON.parse(output)
  } catch {
    const first = Math.min(...[output.indexOf('['), output.indexOf('{')].filter((index) => index >= 0))
    const last = Math.max(output.lastIndexOf(']'), output.lastIndexOf('}'))
    if (Number.isFinite(first) && last > first) {
      try {
        return JSON.parse(output.slice(first, last + 1))
      } catch {
        // Fall through to the actionable error below.
      }
    }
    throw new Error(`${label} is not valid JSON.`)
  }
}

/** Convert an absolute runner path to one safe repository-relative path. */
function relativeRepositoryPath(repositoryRoot, filePath) {
  const absolute = path.resolve(repositoryRoot, filePath)
  const relative = path.relative(repositoryRoot, absolute).split(path.sep).join('/')
  if (!isSafeRepositoryPath(relative)) throw new Error('Runner reported a file outside the repository.')
  return relative
}

/** Check a repository-relative path against the receipt parser's path rules. */
function isSafeRepositoryPath(value) {
  return typeof value === 'string' && SAFE_REPOSITORY_PATH.test(value) && path.posix.normalize(value) === value && !value.includes('../')
}

/** Check a canonical test ID references one expected file. */
function isSafeTestId(value, files) {
  if (typeof value !== 'string') return false
  const separator = value.indexOf('::')
  return separator > 0 && files.includes(value.slice(0, separator)) && value.slice(separator + 2).trim().length > 0
}

/** Return whether two sorted string arrays contain the same values. */
function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Compare the immutable runner plan without relying on object identity. */
function sameExpected(left, right) {
  return isRecord(left) && left.runner === right.runner && left.proofMode === right.proofMode
    && left.sourceSha === right.sourceSha && Array.isArray(left.files) && Array.isArray(left.testIds)
    && sameArray(left.files, right.files) && sameArray(left.testIds, right.testIds)
}

/** Return sorted unique strings without mutating runner output. */
function sortedUnique(values) {
  return [...new Set(values)].sort()
}

/** Return whether a value is a non-array object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
