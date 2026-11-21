// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CoverageStatusPanel } from '../../src/components/coverage-status-panel'
import type { CoverageState } from '../../src/features/tracking/coverage-controller'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('coverage status panel [DON-275]', () => {
  it('AUD-14 does not claim all history when retrieval has failed despite saved evidence being delivered', () => {
    act(() => root.render(React.createElement(CoverageStatusPanel, {
      state: state('complete', { blockers: ['history_reconciliation_incomplete'] }), omittedDeviceCount: 0, omittedOutingCount: 0, unassignedOmitted: false,
      onRetry: vi.fn(), onInspectExactFixes: vi.fn(),
    })))
    expect(host.textContent).not.toContain('All mission history shown')
    expect(host.textContent).toContain('Saved history has not been reconciled through the mission window')
  })
  it('shows database-backed loading progress and permits an honest decrease', () => {
    render(state('loading', { deliveredFixCount: 80, totalFixCount: 100 }))
    expect(host.textContent).toContain('80 of 100 fixes')
    expect(progress()).toMatchObject({ value: 80, max: 100 })

    render(state('loading', { deliveredFixCount: 80, totalFixCount: 120 }))
    expect(host.textContent).toContain('80 of 120 fixes')
    expect(progress()).toMatchObject({ value: 80, max: 120 })
  })

  it('never renders 100% before the final completeness claim succeeds', () => {
    render(state('loading', { deliveredFixCount: 7, totalFixCount: 7 }))
    expect(host.querySelector('[data-testid="coverage-progress"]')).toBeNull()
    expect(host.textContent).toContain('completeness is not yet verified')

    render(state('error', {
      deliveredFixCount: 7,
      totalFixCount: 7,
      lastErrorClass: 'timeout',
    }))
    expect(host.querySelector('[data-testid="coverage-progress"]')).toBeNull()
    expect(host.textContent).toContain('completeness is not yet verified')
    expect(host.textContent).toContain('Reason: loading took too long')
  })

  it('uses whole-mission wording only when no history is omitted', () => {
    render(state('complete'), { omittedDeviceCount: 0, omittedOutingCount: 0 })
    expect(host.textContent).toContain('All mission history shown')

    render(state('complete'), { omittedDeviceCount: 2, omittedOutingCount: 1 })
    expect(host.textContent).toContain('All selected history shown')
    expect(host.textContent).toContain('2 devices, 1 outing omitted')
    expect(host.textContent).not.toContain('All mission history shown')
  })

  it('never describes the Outside outings period as an outing', () => {
    render(state('complete'), { unassignedOmitted: true })

    expect(host.textContent).toContain('Outside outings omitted')
    expect(host.textContent).not.toContain('1 outing omitted')
  })

  it('distinguishes partial, degraded, backfill, and reorganizing states', () => {
    const onRetry = vi.fn()
    render(state('partial'), { onRetry })
    expect(host.textContent).toContain('History incomplete — showing loaded coverage')
    click('coverage-retry')
    expect(onRetry).toHaveBeenCalledOnce()

    render(state('partial', { blockers: ['ingest_health_degraded'] }))
    expect(host.textContent).toContain('Evidence health is degraded')

    render(state('partial', { blockers: ['backfill_incomplete'] }))
    expect(host.textContent).toContain('Participant history is still being added')
    expect(host.querySelector('[data-testid="coverage-progress"]')).toBeNull()

    render(state('loading', { pendingInvalidation: true }))
    expect(host.textContent).toContain('Updating outing assignment')
    expect(host.querySelector('[data-testid="coverage-progress"]')).toBeNull()
  })

  it('shows renderer-held evidence as an evidence wait without fake progress or retry', () => {
    const onRetry = vi.fn()
    render(state('partial', {
      blockers: ['renderer_evidence_pending'],
      deliveredFixCount: 10,
      totalFixCount: 10,
    }), { onRetry })

    expect(host.textContent).toContain('Anomaly evidence is waiting to be saved')
    expect(host.textContent).toContain('Current positions remain live')
    expect(host.querySelector('[data-testid="coverage-progress"]')).toBeNull()
    expect(host.querySelector('[data-testid="coverage-retry"]')).toBeNull()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('does not claim coverage is shown while the renderer style is detached', () => {
    render(state('partial', {
      blockers: ['renderer_detached'],
      deliveredFixCount: 10,
      totalFixCount: 10,
    }))

    expect(host.textContent).toContain('Coverage is being reattached to the map')
    expect(host.textContent).toContain('Current positions remain live')
    expect(host.textContent).not.toContain('showing loaded coverage')
    expect(host.querySelector('[data-testid="coverage-progress"]')).toBeNull()
    expect(host.querySelector('[data-testid="coverage-retry"]')).toBeNull()
  })

  it('withholds progress and retry until the map has applied the selected history filter', () => {
    render(state('partial', {
      blockers: ['renderer_filter_pending'],
      deliveredFixCount: 10,
      totalFixCount: 10,
    }))

    expect(host.textContent).toContain('Applying the selected history filter to the map')
    expect(host.textContent).toContain('Current positions remain live')
    expect(host.querySelector('[data-testid="coverage-progress"]')).toBeNull()
    expect(host.querySelector('[data-testid="coverage-retry"]')).toBeNull()
  })

  it('keeps failures explicit, ahead of backfill or reorganization context', () => {
    render(state('error', {
      blockers: ['backfill_incomplete'],
      lastErrorClass: 'timeout',
    }))

    expect(host.textContent).not.toContain('Participant history is still being added')
    expect(host.textContent).toContain('History incomplete — showing loaded coverage')
    expect(host.textContent).toContain('Reason: loading took too long')

    render(state('error', {
      pendingInvalidation: true,
      lastErrorClass: 'worker',
    }))

    expect(host.textContent).not.toContain('Updating outing assignment')
    expect(host.textContent).toContain('History incomplete — showing loaded coverage')
    expect(host.textContent).toContain('Reason: the history builder stopped')
  })

  it('DON-338 REN-2: a moving device reads as updating with the drawn count, not as incomplete', () => {
    const onRetry = vi.fn()
    render(state('partial', {
      deliveredFixCount: 0, drawnFixCount: 37_000, totalFixCount: 37_010, updating: true,
    }), { onRetry })

    expect(host.querySelector('[data-testid="coverage-updating"]')?.textContent)
      .toContain('Updating — the newest positions are being added to the history line')
    expect(host.textContent).not.toContain('History incomplete')
    expect(host.querySelector('[data-testid="coverage-progress-text"]')?.textContent)
      .toBe('37,000 of 37,010 fixes')
    expect(host.querySelector('[data-testid="coverage-retry"]')).toBeNull()
  })

  it('DON-338 REN-2: a line that stopped catching up says so plainly and offers Retry', () => {
    render(state('partial', {
      drawnFixCount: 900, totalFixCount: 1_000, updating: true, stalled: true,
    }))

    expect(host.querySelector('[data-testid="coverage-stalled"]')?.textContent).toBe(
      'History line stalled — it has not updated for over 2 minutes. ' +
      'The line may be missing recent positions or be out of date. Current positions remain live. Press Retry.',
    )
    expect(host.querySelector('[data-testid="coverage-retry"]')).not.toBeNull()
    expect(host.textContent).toContain('900 of 1,000 fixes')
  })

  it('DON-338 REN-2: a partial line that nothing is working on is incomplete, never "updating"', () => {
    render(state('partial', { drawnFixCount: 900, totalFixCount: 1_000, updating: false }))

    expect(host.querySelector('[data-testid="coverage-updating"]')).toBeNull()
    expect(host.textContent).toContain('History incomplete — showing loaded coverage. Press Retry to load the rest.')
    expect(host.querySelector('[data-testid="coverage-retry"]')).not.toBeNull()
  })

  it('DON-338 REN-4: a failure that retries itself says so', () => {
    render(state('error', { lastErrorClass: 'timeout', updating: true }))
    expect(host.textContent).toContain('Retrying automatically; press Retry to try now.')

    render(state('error', { lastErrorClass: 'timeout', updating: false }))
    expect(host.textContent).not.toContain('Retrying automatically')
    expect(host.textContent).toContain('Press Retry.')
  })

  it('never describes a plain coverage failure as still loading', () => {
    render(state('error', { lastErrorClass: 'timeout' }))

    expect(host.querySelector('[data-testid="coverage-loading"]')).toBeNull()
    expect(host.textContent).toContain('History incomplete — showing loaded coverage')
    expect(host.textContent).toContain('Reason: loading took too long')
  })
})

/** Every temporary waiting reason and the message it shows while it is still expected to clear. */
const WAITING_REASONS: readonly {
  readonly name: string
  readonly options: { readonly blockers?: readonly string[]; readonly pendingInvalidation?: boolean; readonly backfillIncomplete?: boolean }
  readonly waitingTestId: string
  readonly clause: string
  readonly retryCanHelp: boolean
}[] = [
  { name: 'renderer_detached', options: { blockers: ['renderer_detached'] }, waitingTestId: 'coverage-renderer-detached', clause: 'while reattaching to the map', retryCanHelp: false },
  { name: 'renderer_filter_pending', options: { blockers: ['renderer_filter_pending'] }, waitingTestId: 'coverage-filter-pending', clause: 'while applying the selected history filter', retryCanHelp: false },
  { name: 'pending_invalidation blocker', options: { blockers: ['pending_invalidation'] }, waitingTestId: 'coverage-reorganizing', clause: 'while updating outing assignment', retryCanHelp: true },
  { name: 'manifest pendingInvalidation', options: { pendingInvalidation: true }, waitingTestId: 'coverage-reorganizing', clause: 'while updating outing assignment', retryCanHelp: true },
  { name: 'backfill_incomplete blocker', options: { blockers: ['backfill_incomplete'] }, waitingTestId: 'coverage-backfill', clause: 'while adding participant history', retryCanHelp: true },
  { name: 'manifest backfillIncomplete', options: { backfillIncomplete: true }, waitingTestId: 'coverage-backfill', clause: 'while adding participant history', retryCanHelp: true },
  { name: 'renderer_evidence_pending', options: { blockers: ['renderer_evidence_pending'] }, waitingTestId: 'coverage-evidence-pending', clause: 'while waiting for anomaly evidence to be saved', retryCanHelp: true },
  { name: 'ingest_outbox_pending', options: { blockers: ['ingest_outbox_pending'] }, waitingTestId: 'coverage-degraded', clause: 'while waiting for new positions to be saved', retryCanHelp: true },
]

describe('DON-338 REN-3: a stall or failure outranks every temporary waiting message', () => {
  for (const reason of WAITING_REASONS) {
    it(`says a stalled line plainly while waiting on ${reason.name}`, () => {
      const onRetry = vi.fn()
      render(state('partial', { ...reason.options, updating: true, stalled: true }), { onRetry })

      expect(host.querySelector(`[data-testid="${reason.waitingTestId}"]`)).toBeNull()
      const stalled = host.querySelector('[data-testid="coverage-stalled"]')?.textContent ?? ''
      expect(stalled).toContain(`History line stalled — it has not updated for over 2 minutes ${reason.clause}.`)
      expect(stalled).toContain('The line may be missing recent positions or be out of date.')
      expect(stalled).toContain('Current positions remain live.')
      if (reason.retryCanHelp) {
        expect(stalled).toContain('Press Retry.')
        click('coverage-retry')
        expect(onRetry).toHaveBeenCalledOnce()
      } else {
        // Retry re-reads saved history but cannot make the map reattach or
        // apply the filter, so no dead button is offered.
        expect(stalled).toContain('Retry cannot fix this. Check saved positions with Inspect exact fixes.')
        expect(host.querySelector('[data-testid="coverage-retry"]')).toBeNull()
      }
    })

    it(`shows a failure, not the waiting message, while waiting on ${reason.name}`, () => {
      const onRetry = vi.fn()
      render(state('error', { ...reason.options, lastErrorClass: 'timeout', updating: false }), { onRetry })

      expect(host.querySelector(`[data-testid="${reason.waitingTestId}"]`)).toBeNull()
      expect(host.querySelector('[data-testid="coverage-error"]')?.textContent).toContain('Reason: loading took too long.')
      click('coverage-retry')
      expect(onRetry).toHaveBeenCalledOnce()
    })
  }

  it('keeps the plain waiting message while the line is not stalled', () => {
    render(state('partial', { blockers: ['renderer_detached'], updating: true }))
    expect(host.querySelector('[data-testid="coverage-renderer-detached"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="coverage-stalled"]')).toBeNull()
  })
})

function render(
  coverageState: CoverageState,
  props: {
    readonly omittedDeviceCount?: number
    readonly omittedOutingCount?: number
    readonly unassignedOmitted?: boolean
    readonly onRetry?: () => void
  } = {},
): void {
  act(() => {
    root.render(React.createElement(CoverageStatusPanel, {
      state: coverageState,
      omittedDeviceCount: props.omittedDeviceCount ?? 0,
      omittedOutingCount: props.omittedOutingCount ?? 0,
      unassignedOmitted: props.unassignedOmitted ?? false,
      onRetry: props.onRetry ?? (() => undefined),
      onInspectExactFixes: () => undefined,
    }))
  })
}

function state(
  status: 'loading' | 'partial' | 'complete' | 'error',
  options: {
    readonly deliveredFixCount?: number
    readonly totalFixCount?: number
    readonly blockers?: readonly string[]
    readonly pendingInvalidation?: boolean
    readonly backfillIncomplete?: boolean
    readonly lastErrorClass?: 'timeout' | 'worker'
    readonly drawnFixCount?: number
    readonly updating?: boolean
    readonly stalled?: boolean
  } = {},
): CoverageState {
  return {
    status,
    missionId: 'mission-1', rendererGeneration: 'r1',
    changeSeq: 1, latestObservedChangeSeq: 1,
    manifest: {
      changeSeq: 1, enumerated: true,
      pendingInvalidation: options.pendingInvalidation ?? false,
      backfillIncomplete: options.backfillIncomplete ?? false, outings: [], chunks: [],
    },
    tileCatalog: null, delivered: {},
    deliveredFixCount: options.deliveredFixCount ?? 10,
    totalFixCount: options.totalFixCount ?? 10,
    lastErrorClass: options.lastErrorClass,
    blockers: options.blockers ?? [],
    updatedAt: '2026-08-24T12:00:00.000Z',
    ...(options.drawnFixCount === undefined ? {} : { drawnFixCount: options.drawnFixCount }),
    ...(options.updating === undefined ? {} : { updating: options.updating }),
    ...(options.stalled === undefined ? {} : { stalled: options.stalled }),
  }
}

function progress(): HTMLProgressElement {
  return host.querySelector('[role="progressbar"]') as HTMLProgressElement
}

function click(testId: string): void {
  act(() => {
    ;(host.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click()
  })
}
