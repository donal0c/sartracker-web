/**
 * Diagnostics report checks for the team smoke [DON-321].
 *
 * A team diagnostics report from 13.5 covered only 30 minutes: unchanged
 * tracking_status_changed breadcrumbs filled the 500-event log and pushed out
 * the events that mattered. These helpers export the report the way the team
 * does (Diagnostics → Export Report), read the file the app wrote, and say what
 * is wrong with its breadcrumbs. A report that cannot be exported or read is
 * missing evidence (NotTested); a report that lost events is a product failure.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { delay } from './app.mjs'
import { closeWorkspace } from './operator.mjs'
import { NotTested } from './results.mjs'

/** The renderer keeps at most this many breadcrumbs. */
export const DIAGNOSTIC_LOG_CAPACITY = 500
/**
 * tracking_status_changed may be at most this share of the breadcrumbs once
 * the log is under pressure (13.5: 71% of a full log). Provisional: in a quiet
 * session ordinary status changes are naturally most of a short log (box run
 * 5c, 2 Oct 2026), so it applies only from SHARE_BOUND_FROM_EVENTS or once
 * routine events were dropped.
 */
export const MAX_STATUS_SHARE = 0.5
/** The share bound applies from this many breadcrumbs (half the log). */
export const SHARE_BOUND_FROM_EVENTS = 250
/** ...and at most this many in one session (13.5: about three per 15 s poll). */
export const MAX_STATUS_EVENTS = 40

const SECTION = '[diagnostic-breadcrumbs]'
const SECTION_HEADER = /^\[[a-z0-9-]+\]$/u

/**
 * Splits the [diagnostic-breadcrumbs] section of a diagnostics report.
 *
 * @param {string} text the exported report
 * @returns {{sectionFound: boolean, declaredCount: number | null, droppedRoutine: number | null,
 *   events: {ts: string, event: string, fields?: Record<string, unknown>}[], unparsedLines: number}}
 */
export function parseDiagnosticsReport(text) {
  const lines = text.split(/\r?\n/u)
  const start = lines.indexOf(SECTION)
  if (start === -1) {
    return { sectionFound: false, declaredCount: null, droppedRoutine: null, events: [], unparsedLines: 0 }
  }
  let declaredCount = null
  let droppedRoutine = null
  let unparsedLines = 0
  const events = []
  for (const line of lines.slice(start + 1)) {
    if (SECTION_HEADER.test(line.trim())) break
    const declared = /^event count: (\d+)$/u.exec(line)
    const dropped = /^routine tracking events dropped to keep older events: (\d+)$/u.exec(line)
    if (declared !== null) declaredCount = Number(declared[1])
    else if (dropped !== null) droppedRoutine = Number(dropped[1])
    else if (line.trim() === '' || line === 'no diagnostic breadcrumbs recorded') continue
    else {
      try {
        const event = JSON.parse(line)
        if (typeof event?.ts === 'string' && typeof event?.event === 'string') events.push(event)
        else unparsedLines += 1
      } catch {
        unparsedLines += 1
      }
    }
  }
  return { sectionFound: true, declaredCount, droppedRoutine, events, unparsedLines }
}

/**
 * Lists what is wrong with the breadcrumbs of a report exported at the end of
 * a long session. The session placed a marker before the mission started and
 * then polled steadily, so a working log still holds that marker, starts
 * before the mission, records suppressed repeats, and is not dominated by
 * tracking_status_changed.
 *
 * @param {ReturnType<typeof parseDiagnosticsReport>} parsed
 * @param {{sessionStartedAt: number, missionStartedAt: number}} times epoch ms
 * @returns {{problems: string[], summary: string}}
 */
export function assessDiagnosticsReport(parsed, { sessionStartedAt, missionStartedAt }) {
  if (!parsed.sectionFound) {
    return { problems: [`The diagnostics report has no ${SECTION} section.`], summary: 'no breadcrumb section' }
  }
  const problems = []
  const { events } = parsed
  if (parsed.declaredCount !== events.length) {
    problems.push(`The report declares ${parsed.declaredCount ?? 'no'} breadcrumbs but lists ${events.length}.`)
  }
  if (parsed.unparsedLines > 0) {
    problems.push(`${parsed.unparsedLines} breadcrumb line(s) could not be read as events.`)
  }
  const times = events.map((event) => Date.parse(event.ts)).filter(Number.isFinite)
  const earliest = times.length === 0 ? null : Math.min(...times)
  if (earliest === null || earliest >= missionStartedAt) {
    problems.push(`The earliest breadcrumb (${earliest === null ? 'none' : new Date(earliest).toISOString()}) is not from before `
      + `the mission started (${new Date(missionStartedAt).toISOString()}): older events were pushed out.`)
  }
  const earlyMarker = events.some((event) => event.event === 'marker_saved'
    && Date.parse(event.ts) >= sessionStartedAt && Date.parse(event.ts) < missionStartedAt)
  if (!earlyMarker) {
    problems.push('The marker saved before the mission started is missing from the breadcrumbs.')
  }
  const statusEvents = events.filter((event) => event.event === 'tracking_status_changed')
  const statusCount = statusEvents.length
  const share = events.length === 0 ? 0 : statusCount / events.length
  const underPressure = events.length >= SHARE_BOUND_FROM_EVENTS || parsed.droppedRoutine !== null
  if (statusCount > MAX_STATUS_EVENTS || (underPressure && share > MAX_STATUS_SHARE)) {
    problems.push(`tracking_status_changed is ${statusCount} of ${events.length} breadcrumbs (${Math.round(share * 100)}%); `
      + `the limit is ${MAX_STATUS_EVENTS}${underPressure ? ` and ${Math.round(MAX_STATUS_SHARE * 100)}%` : ''}.`)
  }
  // The app records a status breadcrumb only when what it logs changes, so two
  // in a row with the same logged fields are a repeat that escaped suppression,
  // at any log size (the 5c catch-up burst) [DON-321]. Once routine events
  // were evicted, rows that look adjacent may not have been, so no verdict.
  const repeats = parsed.droppedRoutine !== null ? [] : statusEvents.filter((event, index) => index > 0
    && sameLoggedFields(event.fields, statusEvents[index - 1].fields))
  if (repeats.length > 0) {
    problems.push(`${repeats.length} tracking_status_changed breadcrumb(s) repeat the previous one with identical logged fields `
      + `(first at ${repeats[0].ts}); repeats should be suppressed.`)
  }
  const suppressed = events.filter((event) => Number(event.fields?.repeatsSuppressed) > 0).length
  if (suppressed === 0) {
    problems.push('After a session of steady polling, no breadcrumb records suppressed repeats (repeatsSuppressed).')
  }
  // The log drops events only at the 501st, so a full log without the
  // dropped line is legitimate; eviction order is covered by the unit test
  // `diagnostic-event-log` [DON-321], not by this session.
  if (events.length > DIAGNOSTIC_LOG_CAPACITY) {
    problems.push(`The report lists ${events.length} breadcrumbs; the log holds at most ${DIAGNOSTIC_LOG_CAPACITY}.`)
  }
  const span = earliest === null ? 0 : Math.round((Math.max(...times) - earliest) / 60_000)
  return {
    problems,
    summary: `${events.length} breadcrumbs over ${span} min; tracking_status_changed ${statusCount} `
      + `(${Math.round(share * 100)}%); ${suppressed} record suppressed repeats`
      + `${parsed.droppedRoutine === null ? '' : `; ${parsed.droppedRoutine} routine dropped`}`,
  }
}

/**
 * Compares two status breadcrumbs' logged fields, ignoring the suppressed
 * repeat count (which says how many identical updates came before).
 *
 * @param {Record<string, unknown> | undefined} a
 * @param {Record<string, unknown> | undefined} b
 * @returns {boolean}
 */
function sameLoggedFields(a = {}, b = {}) {
  const logged = (fields) => JSON.stringify(Object.entries(fields)
    .filter(([key]) => key !== 'repeatsSuppressed')
    .sort(([left], [right]) => left.localeCompare(right)))
  return logged(a) === logged(b)
}

/**
 * Waits for the report the app writes under `<profile>/diagnostics-reports`
 * after an export started, and reads it.
 *
 * @param {string} profile the app's user-data folder
 * @param {number} startedAt epoch ms when the export was requested
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{name: string, text: string}>}
 * @throws {NotTested} when no new report appears or it cannot be read
 */
export async function readNewDiagnosticsReport(profile, startedAt, { timeoutMs = 15_000 } = {}) {
  const dir = path.join(profile, 'diagnostics-reports')
  const deadline = Date.now() + timeoutMs
  do {
    const names = await readdir(dir).catch(() => [])
    const fresh = []
    for (const name of names.filter((entry) => /^diagnostics-report-.*\.txt$/u.test(entry))) {
      const info = await stat(path.join(dir, name)).catch(() => null)
      if (info !== null && info.mtimeMs >= startedAt - 1000) fresh.push({ name, mtimeMs: info.mtimeMs })
    }
    if (fresh.length > 0) {
      const newest = fresh.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
      try {
        return { name: newest.name, text: await readFile(path.join(dir, newest.name), 'utf8') }
      } catch (error) {
        throw new NotTested(`The exported diagnostics report ${newest.name} could not be read: ${error.message}`)
      }
    }
    await delay(250)
  } while (Date.now() < deadline)
  throw new NotTested(`No diagnostics report appeared in ${dir} within ${timeoutMs / 1000} s of Export Report.`)
}

/**
 * Exports the diagnostics report through Diagnostics → Export Report, as the
 * team does, and returns the file the app wrote.
 *
 * @param {import('playwright').Page} page
 * @param {string} profile the app's user-data folder
 * @param {{timeoutMs?: number}} [options] how long to wait for the file
 * @returns {Promise<{name: string, text: string}>}
 * @throws {NotTested} when the workspace or export cannot be driven
 */
export async function exportDiagnosticsReport(page, profile, { timeoutMs = 15_000 } = {}) {
  const startedAt = Date.now()
  let outcome
  try {
    try {
      await page.getByTestId('open-diagnostics-workspace').click()
      const button = page.getByTestId('diagnostics-export-report')
      await button.waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => {
        const element = document.querySelector('[data-testid="diagnostics-export-report"]')
        return element instanceof HTMLButtonElement && !element.disabled
      }, undefined, { timeout: 15_000 })
      await button.click()
    } catch (error) {
      throw new NotTested(`Diagnostics → Export Report could not be pressed: ${error.message}`)
    }
    outcome = { report: await readNewDiagnosticsReport(profile, startedAt, { timeoutMs }) }
  } catch (error) {
    outcome = { error }
  }
  // Always leave Diagnostics, but never let a failed close replace the
  // classified result above.
  const closeError = await closeWorkspace(page).then(() => null, (error) => error)
  if (outcome.error !== undefined) throw outcome.error
  if (closeError !== null) {
    throw new NotTested(`Diagnostics could not be closed after Export Report: ${closeError.message}`)
  }
  return outcome.report
}
