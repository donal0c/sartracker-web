// @vitest-environment node
import { mkdtemp, rm, utimes, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assessDiagnosticsReport,
  exportDiagnosticsReport,
  parseDiagnosticsReport,
  readNewDiagnosticsReport,
} from '../../scripts/team-smoke/lib/diagnostics-report.mjs'
import { NotTested } from '../../scripts/team-smoke/lib/results.mjs'

/**
 * DON-321: a team diagnostics report covered only 30 minutes because routine
 * tracking_status_changed breadcrumbs filled the 500-event log. team-mission
 * now exports the report after its long first session and checks it.
 */

const SESSION = Date.parse('2026-10-02T09:00:00.000Z')
const START = SESSION + 5 * 60_000
const minutes = (count: number) => new Date(SESSION + count * 60_000).toISOString()

type Event = { ts: string, level: string, category: string, event: string, fields?: Record<string, unknown> }

function report(events: Event[], { dropped }: { dropped?: number } = {}) {
  return [
    '[tracking]',
    'devices in snapshot: 30',
    '[diagnostic-breadcrumbs]',
    `event count: ${events.length}`,
    ...(dropped === undefined ? [] : [`routine tracking events dropped to keep older events: ${dropped}`]),
    ...events.map((event) => JSON.stringify(event)),
    '[warnings]',
    'none',
  ].join('\n')
}

const status = (at: number, fields: Record<string, unknown> = {}): Event =>
  ({ ts: minutes(at), level: 'info', category: 'tracking', event: 'tracking_status_changed', fields: { mode: 'online', ...fields } })
const snapshot = (at: number, fields: Record<string, unknown> = {}): Event =>
  ({ ts: minutes(at), level: 'info', category: 'tracking', event: 'tracking_snapshot_applied', fields })
const marker = (at: number): Event =>
  ({ ts: minutes(at), level: 'info', category: 'marker', event: 'marker_saved', fields: { mode: 'create' } })

/** A healthy 20-minute session: early marker, outage, thinned routine events. */
function healthy(): Event[] {
  return [
    status(0.5),
    marker(2),
    snapshot(6),
    ...Array.from({ length: 8 }, (_, index) => snapshot(7 + index, { deviceCount: 30 + index })),
    status(12, { mode: 'offline', repeatsSuppressed: 40 }),
    status(13, { mode: 'online' }),
    snapshot(17, { repeatsSuppressed: 12 }),
  ]
}

describe('parseDiagnosticsReport [DON-321]', () => {
  it('reads the declared count, the dropped line and every breadcrumb', () => {
    const parsed = parseDiagnosticsReport(report(healthy(), { dropped: 7 }))
    expect(parsed).toMatchObject({ sectionFound: true, declaredCount: 14, droppedRoutine: 7, unparsedLines: 0 })
    expect(parsed.events).toHaveLength(14)
  })

  it('treats a missing section as not found, and an absent dropped line as null', () => {
    expect(parseDiagnosticsReport('[tracking]\nnothing\n').sectionFound).toBe(false)
    expect(parseDiagnosticsReport(report(healthy())).droppedRoutine).toBeNull()
  })
})

describe('assessDiagnosticsReport [DON-321]', () => {
  const options = { sessionStartedAt: SESSION, missionStartedAt: START }

  it('passes a report that kept the early events and thinned routine ones', () => {
    expect(assessDiagnosticsReport(parseDiagnosticsReport(report(healthy())), options)).toEqual({
      problems: [],
      summary: expect.stringContaining('14 breadcrumbs'),
    })
  })

  it('fails when the marker saved before Start was pushed out', () => {
    const events = healthy().filter((event) => event.event !== 'marker_saved')
    expect(assessDiagnosticsReport(parseDiagnosticsReport(report(events)), options).problems)
      .toContainEqual(expect.stringContaining('marker saved before the mission started'))
  })

  it('fails when the earliest breadcrumb is from after the mission started', () => {
    const events = healthy().filter((event) => Date.parse(event.ts) >= START)
    expect(assessDiagnosticsReport(parseDiagnosticsReport(report(events)), options).problems)
      .toContainEqual(expect.stringContaining('earliest breadcrumb'))
  })

  it('fails the 13.5 shape: status repeats flood the log and nothing is thinned', () => {
    const flood = [marker(2), ...Array.from({ length: 300 }, (_, index) => status(3 + index / 20))]
    const problems = assessDiagnosticsReport(parseDiagnosticsReport(report(flood)), options).problems
    expect(problems).toContainEqual(expect.stringContaining('tracking_status_changed'))
    expect(problems).toContainEqual(expect.stringContaining('no breadcrumb records suppressed repeats'))
  })

  it('accepts a full log without the dropped line: the log drops only at the 501st event', () => {
    const full = [...healthy(), ...Array.from({ length: 486 }, (_, index) => snapshot(18, { deviceCount: index }))]
    expect(full).toHaveLength(500)
    expect(assessDiagnosticsReport(parseDiagnosticsReport(report(full)), options).problems).toEqual([])
    expect(assessDiagnosticsReport(parseDiagnosticsReport(report(full, { dropped: 30 })), options).summary)
      .toContain('30 routine dropped')
  })

  it('fails a report listing more breadcrumbs than the log can hold', () => {
    const over = [...healthy(), ...Array.from({ length: 487 }, (_, index) => snapshot(18, { deviceCount: index }))]
    expect(assessDiagnosticsReport(parseDiagnosticsReport(report(over)), options).problems)
      .toContainEqual(expect.stringContaining('at most 500'))
  })

  it('fails when the declared count disagrees with the lines, or a line is not JSON', () => {
    const text = report(healthy()).replace('event count: 14', 'event count: 15').replace('[warnings]', 'not json\n[warnings]')
    const problems = assessDiagnosticsReport(parseDiagnosticsReport(text), options).problems
    expect(problems).toContainEqual(expect.stringContaining('declares 15'))
    expect(problems).toContainEqual(expect.stringContaining('could not be read'))
  })

  it('fails when the report has no breadcrumb section at all', () => {
    expect(assessDiagnosticsReport(parseDiagnosticsReport('[tracking]\n'), options).problems)
      .toEqual(['The diagnostics report has no [diagnostic-breadcrumbs] section.'])
  })
})

describe('readNewDiagnosticsReport [DON-321]', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  it('returns the newest report written since the export started', async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'don321-'))
    dirs.push(profile)
    const reports = path.join(profile, 'diagnostics-reports')
    await mkdir(reports)
    const old = path.join(reports, 'diagnostics-report-old.txt')
    const exportedAt = Date.now()
    await writeFile(old, 'old')
    await utimes(old, new Date(exportedAt - 60_000), new Date(exportedAt - 60_000))
    await writeFile(path.join(reports, 'diagnostics-report-new.txt'), 'new')
    const found = await readNewDiagnosticsReport(profile, exportedAt, { timeoutMs: 500 })
    expect(found).toMatchObject({ name: 'diagnostics-report-new.txt', text: 'new' })
  })

  it('is NotTested, not a product failure, when no report appears', async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'don321-'))
    dirs.push(profile)
    await expect(readNewDiagnosticsReport(profile, Date.now(), { timeoutMs: 200 })).rejects.toBeInstanceOf(NotTested)
  })
})

describe('exportDiagnosticsReport [DON-321]', () => {
  /** A Playwright-like page whose controls succeed or throw as told. */
  function fakePage({ pressFails = false, closeFails = false, onExport = async () => undefined }: {
    pressFails?: boolean, closeFails?: boolean, onExport?: () => Promise<void>
  }) {
    const clicked: string[] = []
    const control = (testId: string) => ({
      click: async () => {
        clicked.push(testId)
        if (pressFails && testId === 'open-diagnostics-workspace') throw new Error('no such button')
        if (closeFails && testId === 'workspace-close-btn') throw new Error('close detached')
        if (testId === 'diagnostics-export-report') await onExport()
      },
      waitFor: async () => undefined,
      isVisible: async () => true,
    })
    return { clicked, page: { getByTestId: control, waitForFunction: async () => undefined } }
  }

  it('is NotTested when Export Report cannot be pressed, and still closes Diagnostics', async () => {
    const { clicked, page } = fakePage({ pressFails: true })
    const error = await exportDiagnosticsReport(page, '/nonexistent').catch((caught) => caught)
    expect(error).toBeInstanceOf(NotTested)
    expect(error.message).toContain('could not be pressed')
    expect(clicked).toContain('workspace-close-btn')
  })

  it('keeps the NotTested read failure when closing Diagnostics also fails', async () => {
    const { page } = fakePage({ closeFails: true })
    const error = await exportDiagnosticsReport(page, path.join(os.tmpdir(), 'don321-missing'), { timeoutMs: 200 })
      .catch((caught) => caught)
    expect(error).toBeInstanceOf(NotTested)
    expect(error.message).toContain('No diagnostics report appeared')
  })

  it('returns the exported report and closes Diagnostics', async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'don321-'))
    const { clicked, page } = fakePage({
      onExport: async () => {
        await mkdir(path.join(profile, 'diagnostics-reports'))
        await writeFile(path.join(profile, 'diagnostics-reports', 'diagnostics-report-now.txt'), 'report')
      },
    })
    try {
      await expect(exportDiagnosticsReport(page, profile, { timeoutMs: 500 }))
        .resolves.toEqual({ name: 'diagnostics-report-now.txt', text: 'report' })
      expect(clicked.at(-1)).toBe('workspace-close-btn')
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  })

  it('is NotTested when the report was read but Diagnostics would not close', async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'don321-'))
    const { page } = fakePage({
      closeFails: true,
      onExport: async () => {
        await mkdir(path.join(profile, 'diagnostics-reports'))
        await writeFile(path.join(profile, 'diagnostics-reports', 'diagnostics-report-now.txt'), 'report')
      },
    })
    try {
      const error = await exportDiagnosticsReport(page, profile, { timeoutMs: 500 }).catch((caught) => caught)
      expect(error).toBeInstanceOf(NotTested)
      expect(error.message).toContain('could not be closed')
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  })
})
