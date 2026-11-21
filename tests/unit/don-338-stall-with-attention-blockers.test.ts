// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CoverageStatusPanel } from '../../src/components/coverage-status-panel'
import type { CoverageController } from '../../src/features/tracking/coverage-controller'
import { COVERAGE_CATCH_UP_STALL_MS, summarizeCoverageStatus } from '../../src/features/tracking/coverage-progress'
import {
  activeCoverage,
  createCoverageFakeMapHarness,
  loadCoverage,
  type FakeMap,
} from '../support/coverage-fake-map-harness'

/**
 * DON-338 round 3: a blocker that needs attention (evidence or storage) must
 * never hide a stalled line. Every attention blocker is combined with every
 * waiting reason, driven through the real controller, its summary and the
 * panel the Tracking tab shows.
 */

type AttentionBlocker = {
  readonly blocker: string
  readonly testId: string
  readonly text: string
}

const ATTENTION_BLOCKERS: readonly AttentionBlocker[] = [
  {
    blocker: 'history_reconciliation_incomplete',
    testId: 'coverage-retrieval-warning',
    text: 'Saved history has not been reconciled through the mission window.',
  },
  {
    blocker: 'ingest_health_degraded',
    testId: 'coverage-degraded',
    text: 'Evidence health is degraded. History cannot be called complete until storage recovers.',
  },
  {
    blocker: 'renderer_evidence_degraded',
    testId: 'coverage-evidence-degraded',
    text: 'Anomaly evidence may not have been fully saved.',
  },
]

type WaitingReason = {
  readonly name: string
  readonly claimBlockers: readonly string[]
  /** Puts the line into this waiting state after it loaded. */
  readonly enter?: (controller: CoverageController, map: FakeMap) => Promise<void>
  readonly clause: string
}

const WAITING_REASONS: readonly WaitingReason[] = [
  { name: 'nothing else', claimBlockers: [], clause: '' },
  {
    name: 'a detached map',
    claimBlockers: [],
    clause: ' while reattaching to the map',
    enter: async (controller, map) => {
      map.working = false
      controller.notifyRendererDetached()
    },
  },
  {
    name: 'a filter the map has not applied',
    claimBlockers: [],
    clause: ' while applying the selected history filter',
    enter: async (controller, map) => {
      map.working = false
      map.omissions = { omittedDeviceIds: ['device-b'], omittedPeriodKeys: [] }
      await controller.updateContext({
        missionId: 'mission-1', rendererGeneration: 'r1', omittedDeviceIds: ['device-b'],
      })
    },
  },
  { name: 'outing reassignment', claimBlockers: ['pending_invalidation'], clause: ' while updating outing assignment' },
  { name: 'participant backfill', claimBlockers: ['backfill_incomplete'], clause: ' while adding participant history' },
  {
    name: 'anomaly evidence waiting to be saved',
    claimBlockers: ['renderer_evidence_pending'],
    clause: ' while waiting for anomaly evidence to be saved',
  },
  {
    name: 'new positions waiting to be saved',
    claimBlockers: ['ingest_outbox_pending'],
    clause: ' while waiting for new positions to be saved',
  },
]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

/** Renders the panel exactly as the Tracking tab does for the controller's current state. */
function renderPanel(controller: CoverageController, onRetry: () => void): void {
  act(() => root.render(React.createElement(CoverageStatusPanel, {
    state: controller.getState(),
    omittedDeviceCount: 0,
    omittedOutingCount: 0,
    unassignedOmitted: false,
    onRetry,
    onInspectExactFixes: () => undefined,
  })))
}

/** Returns the text of the element with `testId`, or null when it is not shown. */
function shown(testId: string): string | null {
  return host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null
}

describe('DON-338: an attention blocker never hides a stalled history line', () => {
  for (const attention of ATTENTION_BLOCKERS) {
    for (const waiting of WAITING_REASONS) {
      it(`${attention.blocker} with ${waiting.name}: stall text, Retry and the attention message`, async () => {
        const { controller, map } = createCoverageFakeMapHarness({
          claimBlockers: [attention.blocker, ...waiting.claimBlockers],
          // Saved history is newer than the drawn line, so the line is behind.
          claimContentRev: 2,
        })
        await loadCoverage(controller)
        await waiting.enter?.(controller, map)
        await vi.advanceTimersByTimeAsync(0)
        const onRetry = vi.fn()

        // Before the stall the attention message is already visible.
        renderPanel(controller, onRetry)
        expect(shown(attention.testId)).toContain(attention.text)
        expect(shown('coverage-stalled')).toBeNull()

        await vi.advanceTimersByTimeAsync(COVERAGE_CATCH_UP_STALL_MS)
        const stalledState = activeCoverage(controller.getState())
        expect(stalledState.stalled).toBe(true)
        expect(stalledState.blockers).toContain(attention.blocker)
        expect(summarizeCoverageStatus(stalledState)).toMatchObject({
          kind: 'behind', needsAttention: true, stalled: true,
        })

        renderPanel(controller, onRetry)
        expect(shown('coverage-stalled')).toContain(
          `History line stalled — it has not updated for over 2 minutes${waiting.clause}.`,
        )
        expect(shown('coverage-stalled')).toContain('Press Retry.')
        expect(shown(attention.testId)).toContain(attention.text)
        const retry = host.querySelector<HTMLButtonElement>('[data-testid="coverage-retry"]')
        expect(retry).not.toBeNull()
        act(() => retry?.click())
        expect(onRetry).toHaveBeenCalledOnce()
        controller.stop()
      })
    }
  }
})

describe('DON-338: a failure never hides an attention blocker', () => {
  const FAILURES = [
    { name: 'a generic worker failure', failure: undefined, outOfMemory: false },
    { name: 'the worker running out of memory', failure: { code: 'coverage-worker-out-of-memory' as const }, outOfMemory: true },
  ] as const

  for (const attention of ATTENTION_BLOCKERS) {
    for (const failure of FAILURES) {
      it(`${attention.blocker} with ${failure.name}: failure, Retry and the attention message`, async () => {
        const { controller } = createCoverageFakeMapHarness({ claimBlockers: [attention.blocker] })
        await loadCoverage(controller)
        controller.notifyRendererUnavailable('Coverage tile worker is unavailable.', failure.failure)

        const failed = activeCoverage(controller.getState())
        expect(failed.status).toBe('error')
        expect(failed.blockers).toContain(attention.blocker)
        expect(summarizeCoverageStatus(failed)).toMatchObject({ kind: 'failed', needsAttention: true })

        const onRetry = vi.fn()
        renderPanel(controller, onRetry)
        expect(shown('coverage-error')).toContain('History incomplete')
        expect(shown(attention.testId)).toContain(attention.text)
        expect(shown('coverage-out-of-memory') !== null).toBe(failure.outOfMemory)
        const retry = host.querySelector<HTMLButtonElement>('[data-testid="coverage-retry"]')
        act(() => retry?.click())
        expect(onRetry).toHaveBeenCalledOnce()
        controller.stop()
      })
    }
  }
})
