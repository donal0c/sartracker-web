#!/usr/bin/env node
/**
 * Visual review automation.
 *
 * Reads every `.entry.json` written by the visual Playwright project
 * (`tests/e2e/visual/**`) under `test-results/visual-verification/`, sends
 * each screenshot + verificationPrompt to a Claude subprocess for an
 * independent visual review, then aggregates the verdicts into a printable
 * summary plus a JSON report under `test-results/visual-verification/reports/`.
 *
 * The runner replaces the manual "spawn Opus subagents" workflow that
 * CLAUDE.md previously instructed humans to run. Pure shaping/parsing logic
 * lives in `build/visual-review-lib.js` so the safety-critical pieces
 * (severity gating, JSON extraction, cache keys) stay deterministic and
 * unit-testable.
 *
 * Usage:
 *   node scripts/visual-review.mjs                    # full review of every entry
 *   node scripts/visual-review.mjs --only <testId>    # single entry, useful when iterating on a spec
 *   node scripts/visual-review.mjs --no-cache         # bypass the per-entry cache
 *   node scripts/visual-review.mjs --dry-run          # never spawn claude; emit a stubbed reply
 *   node scripts/visual-review.mjs --fail-on critical # only fail on critical entries
 *   node scripts/visual-review.mjs --concurrency 1    # run reviewers serially
 *   node scripts/visual-review.mjs --model sonnet     # override the reviewer model alias
 *
 * Exit codes match `summarizeReviewResults` in `build/visual-review-lib.js`:
 *   0 — every entry passed gating
 *   1 — at least one entry failed at or above --fail-on severity
 *   2 — reviewer errored on at least one entry (always blocks)
 *   3 — manifest had zero entries (visual project did not run)
 *
 * The script never modifies the manifest itself; it only writes per-entry
 * `*.review.json` results, an aggregate `visual-review-<timestamp>.json`,
 * and the cache directory.
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

import {
  buildReviewReportFilename,
  computeCacheKey,
  loadManifestEntries,
  parseModelReply,
  parseReviewArgs,
  summarizeReviewResults,
} from '../build/visual-review-lib.js'

const SCRIPT_FILE = fileURLToPath(import.meta.url)
const PROJECT_ROOT = resolve(dirname(SCRIPT_FILE), '..')

const DEFAULT_MANIFEST_DIR = join(
  PROJECT_ROOT,
  'test-results',
  'visual-verification',
)

const REVIEWER_TIMEOUT_MS = 5 * 60 * 1000

main().catch((error) => {
  console.error(`visual-review: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})

async function main() {
  let args
  try {
    args = parseReviewArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`visual-review: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
    return
  }

  const manifestDir = args.manifestDir
    ? resolve(PROJECT_ROOT, args.manifestDir)
    : DEFAULT_MANIFEST_DIR
  const reportDir = args.reportDir
    ? resolve(PROJECT_ROOT, args.reportDir)
    : join(manifestDir, 'reports')
  const cacheDir = join(manifestDir, '.cache')
  const resultsDir = join(manifestDir, 'results')

  const allEntries = loadManifestEntries(manifestDir)
  const entries =
    args.filterTestId === null
      ? allEntries
      : allEntries.filter((entry) => entry.testId === args.filterTestId)

  if (args.filterTestId !== null && entries.length === 0) {
    console.error(
      `visual-review: --only ${args.filterTestId} matched no manifest entries in ${manifestDir}.`,
    )
    process.exit(2)
    return
  }

  console.log('visual-review: starting')
  console.log(`  manifest dir: ${manifestDir}`)
  console.log(`  report dir:   ${reportDir}`)
  console.log(`  entries:      ${entries.length}${entries.length !== allEntries.length ? ` (filtered from ${allEntries.length})` : ''}`)
  console.log(`  model:        ${args.model}`)
  console.log(`  failOn:       ${args.failOn}`)
  console.log(`  cache:        ${args.cache ? 'on' : 'off'}`)
  console.log(`  concurrency:  ${args.concurrency}`)
  console.log(`  dryRun:       ${args.dryRun}`)
  console.log('')

  if (entries.length === 0) {
    const summary = summarizeReviewResults([], { failOn: args.failOn })
    for (const line of summary.lines) {
      console.log(line)
    }
    process.exit(summary.exitCode)
    return
  }

  await mkdir(reportDir, { recursive: true })
  await mkdir(resultsDir, { recursive: true })
  if (args.cache) {
    await mkdir(cacheDir, { recursive: true })
  }

  const startedAt = new Date()
  const results = await runWithConcurrency(entries, args.concurrency, (entry) =>
    reviewEntry({ entry, args, cacheDir, resultsDir }),
  )

  const summary = summarizeReviewResults(results, { failOn: args.failOn })
  for (const line of summary.lines) {
    console.log(line)
  }

  const finishedAt = new Date()
  const reportFilename = buildReviewReportFilename(finishedAt)
  const reportPath = join(reportDir, reportFilename)
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        version: 1,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        manifestDir,
        model: args.model,
        failOn: args.failOn,
        cache: args.cache,
        dryRun: args.dryRun,
        results,
        summary: { ok: summary.ok, exitCode: summary.exitCode, counts: summary.counts },
      },
      null,
      2,
    ),
    'utf-8',
  )
  console.log('')
  console.log(`report written: ${reportPath}`)

  process.exit(summary.exitCode)
}

/**
 * Review a single manifest entry. Reads the screenshot bytes, consults the
 * cache, and either spawns a reviewer or returns the cached verdict. The
 * per-entry result file (`<testId>.review.json`) is always written so the
 * caller can inspect the most recent verdict without re-running.
 */
async function reviewEntry({ entry, args, cacheDir, resultsDir }) {
  const start = performance.now()
  let screenshotBytes
  try {
    screenshotBytes = await readFile(entry.screenshotPath)
  } catch (error) {
    return finishReview({
      entry,
      verdict: 'error',
      failedItems: [],
      rawReply: '',
      durationMs: performance.now() - start,
      cacheHit: false,
      errorMessage: `screenshot not readable: ${describeError(error)}`,
      resultsDir,
    })
  }

  const cacheKey = computeCacheKey(entry, screenshotBytes, args.model)
  const cachePath = args.cache ? join(cacheDir, `${cacheKey}.json`) : null
  if (cachePath !== null && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf-8'))
      return finishReview({
        entry,
        verdict: cached.verdict,
        failedItems: cached.failedItems ?? [],
        rawReply: cached.rawReply ?? '',
        durationMs: performance.now() - start,
        cacheHit: true,
        resultsDir,
      })
    } catch (error) {
      console.warn(
        `visual-review: ignoring corrupt cache for ${entry.testId} (${describeError(error)})`,
      )
    }
  }

  const reviewerPrompt = buildReviewerPrompt(entry)
  let rawReply
  try {
    rawReply = args.dryRun
      ? buildDryRunReply(entry)
      : await spawnReviewer({
          prompt: reviewerPrompt,
          model: args.model,
          allowedDir: dirname(entry.screenshotPath),
        })
  } catch (error) {
    return finishReview({
      entry,
      verdict: 'error',
      failedItems: [],
      rawReply: '',
      durationMs: performance.now() - start,
      cacheHit: false,
      errorMessage: `reviewer process failed: ${describeError(error)}`,
      resultsDir,
    })
  }

  let parsed
  try {
    parsed = parseModelReply(rawReply)
  } catch (error) {
    return finishReview({
      entry,
      verdict: 'error',
      failedItems: [],
      rawReply,
      durationMs: performance.now() - start,
      cacheHit: false,
      errorMessage: `unparseable reviewer reply: ${describeError(error)}`,
      resultsDir,
    })
  }

  if (cachePath !== null) {
    await writeFile(
      cachePath,
      JSON.stringify(
        {
          verdict: parsed.verdict,
          failedItems: parsed.failedItems,
          notes: parsed.notes,
          rawReply,
          model: args.model,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    )
  }

  return finishReview({
    entry,
    verdict: parsed.verdict,
    failedItems: parsed.failedItems,
    rawReply,
    durationMs: performance.now() - start,
    cacheHit: false,
    resultsDir,
  })
}

async function finishReview({
  entry,
  verdict,
  failedItems,
  rawReply,
  durationMs,
  cacheHit,
  resultsDir,
  errorMessage,
}) {
  const result = {
    testId: entry.testId,
    testName: entry.testName,
    severity: entry.severity,
    verdict,
    failedItems,
    rawReply,
    durationMs,
    cacheHit,
    ...(errorMessage ? { errorMessage } : {}),
  }
  await writeFile(
    join(resultsDir, `${entry.testId}.review.json`),
    JSON.stringify(result, null, 2),
    'utf-8',
  )
  return result
}

/**
 * Build the prompt sent to the reviewer subprocess.
 *
 * The prompt is intentionally strict: the reviewer must read the screenshot
 * via the Read tool and respond with a single JSON object as the entire
 * reply. Free-form prose is tolerated by `parseModelReply` (fenced or
 * embedded JSON is recovered) but a verdict-less reply will be classed as a
 * reviewer error rather than a pass.
 */
function buildReviewerPrompt(entry) {
  return [
    `You are an independent visual reviewer for a life-safety SAR Tracker application.`,
    `Step 1: Read the screenshot at the absolute path below using the Read tool.`,
    `Step 2: Compare what the screenshot shows against every numbered item in the verification checklist.`,
    `Step 3: Return EXACTLY ONE JSON object and nothing else. No prose, no markdown, no leading or trailing text. The first character of your reply MUST be "{" and the last must be "}".`,
    `If you cannot read the screenshot for any reason, return verdict "fail" and put the exact error in failedItems[0].`,
    ``,
    `screenshot path: ${entry.screenshotPath}`,
    `test id:         ${entry.testId}`,
    `test name:       ${entry.testName}`,
    `area:            ${entry.area}`,
    `severity:        ${entry.severity}`,
    ``,
    `Verification checklist (do not paraphrase; check each numbered item directly):`,
    entry.verificationPrompt,
    ``,
    `Reply schema:`,
    `{`,
    `  "verdict": "pass" | "fail",`,
    `  "failedItems": ["short description of each failed checklist item"],`,
    `  "notes": "optional one-line summary, <= 200 chars"`,
    `}`,
    `Use "fail" if ANY numbered item is not satisfied. Use "pass" only when every numbered item is satisfied.`,
    `Output the JSON object now, with no other characters.`,
  ].join('\n')
}

/** Stub reply used by --dry-run so the runner can be exercised end-to-end without burning a model call. */
function buildDryRunReply(entry) {
  return JSON.stringify({
    verdict: 'pass',
    failedItems: [],
    notes: `dry-run stub for ${entry.testId}`,
  })
}

function spawnReviewer({ prompt, model, allowedDir }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'claude',
      [
        '--print',
        '--model',
        model,
        '--output-format',
        'json',
        '--add-dir',
        allowedDir,
        '--allowedTools',
        'Read',
        '--no-session-persistence',
        '--permission-mode',
        'bypassPermissions',
        prompt,
      ],
      {
        cwd: PROJECT_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, REVIEWER_TIMEOUT_MS)

    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        rejectPromise(new Error(`reviewer subprocess timed out after ${REVIEWER_TIMEOUT_MS}ms`))
        return
      }
      if (code !== 0) {
        rejectPromise(
          new Error(
            `reviewer subprocess exited with code ${code}; stderr: ${truncate(stderr, 400)}`,
          ),
        )
        return
      }
      try {
        resolvePromise(unwrapClaudeJsonEnvelope(stdout))
      } catch (error) {
        rejectPromise(error)
      }
    })
  })
}

/**
 * Unwrap the JSON envelope produced by `claude --print --output-format json`.
 *
 * The envelope is `{ "type": "result", "result": "<assistant text>", ... }`,
 * with `is_error: true` when the CLI itself failed (model overload,
 * permission denial, etc). The assistant text is the actual reply we feed
 * into `parseModelReply`.
 */
function unwrapClaudeJsonEnvelope(stdout) {
  const trimmed = stdout.trim()
  if (trimmed === '') {
    throw new Error('reviewer subprocess produced no output.')
  }
  let envelope
  try {
    envelope = JSON.parse(trimmed)
  } catch (error) {
    throw new Error(
      `reviewer envelope is not valid JSON: ${describeError(error)}; first 400 chars: ${truncate(trimmed, 400)}`,
    )
  }
  if (envelope.is_error === true) {
    const subtype = typeof envelope.subtype === 'string' ? envelope.subtype : 'error'
    const result = typeof envelope.result === 'string' ? envelope.result : ''
    throw new Error(`reviewer subprocess reported is_error=true (${subtype}): ${truncate(result, 400)}`)
  }
  if (typeof envelope.result !== 'string') {
    throw new Error('reviewer envelope is missing string field "result".')
  }
  return envelope.result
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  let next = 0
  const workers = []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  for (let w = 0; w < limit; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          const index = next++
          if (index >= items.length) {
            return
          }
          results[index] = await worker(items[index])
        }
      })(),
    )
  }
  await Promise.all(workers)
  return results
}

function describeError(error) {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function truncate(text, max) {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max - 3)}...`
}
