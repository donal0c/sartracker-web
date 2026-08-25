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
  it('shows database-backed loading progress and permits an honest decrease', () => {
    render(state('loading', { deliveredFixCount: 80, totalFixCount: 100 }))
    expect(host.textContent).toContain('80 of 100 fixes')
    expect(progress()).toMatchObject({ value: 80, max: 100 })

    render(state('loading', { deliveredFixCount: 80, totalFixCount: 120 }))
    expect(host.textContent).toContain('80 of 120 fixes')
    expect(progress()).toMatchObject({ value: 80, max: 120 })
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

  it('keeps failures explicit while backfill or reorganization context also applies', () => {
    render(state('error', {
      blockers: ['backfill_incomplete'],
      lastErrorClass: 'timeout',
    }))

    expect(host.textContent).toContain('Participant history is still being added')
    expect(host.textContent).toContain('History incomplete — showing loaded coverage')
    expect(host.textContent).toContain('Reason: timeout')

    render(state('error', {
      pendingInvalidation: true,
      lastErrorClass: 'worker',
    }))

    expect(host.textContent).toContain('Updating outing assignment')
    expect(host.textContent).toContain('History incomplete — showing loaded coverage')
    expect(host.textContent).toContain('Reason: worker')
  })

  it('never describes a plain coverage failure as still loading', () => {
    render(state('error', { lastErrorClass: 'timeout' }))

    expect(host.querySelector('[data-testid="coverage-loading"]')).toBeNull()
    expect(host.textContent).toContain('History incomplete — showing loaded coverage')
    expect(host.textContent).toContain('Reason: timeout')
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
    readonly lastErrorClass?: 'timeout' | 'worker'
  } = {},
): CoverageState {
  return {
    status,
    missionId: 'mission-1', rendererGeneration: 'r1',
    changeSeq: 1, latestObservedChangeSeq: 1,
    manifest: {
      changeSeq: 1, enumerated: true,
      pendingInvalidation: options.pendingInvalidation ?? false,
      backfillIncomplete: false, outings: [], chunks: [],
    },
    tileCatalog: null, delivered: {},
    deliveredFixCount: options.deliveredFixCount ?? 10,
    totalFixCount: options.totalFixCount ?? 10,
    lastErrorClass: options.lastErrorClass,
    blockers: options.blockers ?? [],
    updatedAt: '2026-08-24T12:00:00.000Z',
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
