import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { afterEach, describe, expect, it } from 'vitest'

import { SearchOperationsTab } from '../../src/components/mission-evidence-replay-tabs'

describe('search operations finalized-mission containment [DON-279]', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('keeps retained operations visible without exposing write affordances', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(React.createElement(SearchOperationsTab, {
      controller: null,
      readOnly: true,
      reviewBusy: false,
      operations: {
        areas: [{
          id: 'area-1', mission_id: 'mission-1', name: 'Area Alpha', status: 'active',
          geometry_json: '{"type":"Polygon","coordinates":[]}', legacy_drawing_id: null,
          version_sequence: 1, updated_by: 'Coordinator', created_at: '2026-08-27T08:00:00.000Z',
          updated_at: '2026-08-27T08:00:00.000Z', retired_at: null,
        }],
        assignments: [],
        passes: [],
        outings: [{
          id: 'outing-1', mission_id: 'mission-1', label: 'Operational period 1',
          started_at: '2026-08-27T08:00:00.000Z', ended_at: '2026-08-27T10:00:00.000Z',
          created_at: '2026-08-27T08:00:00.000Z', updated_at: '2026-08-27T10:00:00.000Z',
        }],
        pages: {
          areas: pageState(1), assignments: pageState(0),
          outings: pageState(1), passes: pageState(0),
        },
      },
    })))

    expect(host.querySelector('[data-testid="search-operations-read-only"]')?.textContent)
      .toMatch(/finished or finalized.*permanently read-only.*retained.*visible/i)
    expect((host.querySelector('[data-testid="search-operation-entry"] fieldset') as HTMLFieldSetElement).disabled)
      .toBe(true)
    expect((host.querySelector('[data-testid="search-assignment-record"]') as HTMLButtonElement).disabled)
      .toBe(true)
    expect(host.textContent).toContain('Area Alpha')
  })

  it('disables page controls while retained evidence is loading or refreshing [DON-279]', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(React.createElement(SearchOperationsTab, {
      controller: null,
      readOnly: false,
      reviewBusy: true,
      operations: {
        areas: [], assignments: [], passes: [], outings: [],
        pages: {
          areas: pageState(0), assignments: pageState(0),
          outings: pageState(0), passes: pageState(0),
        },
      },
    })))

    expect(host.querySelector('[data-testid="search-operations-refreshing"]')?.textContent)
      .toMatch(/updating retained Search Operations evidence/i)
    expect((host.querySelector('[data-testid="search-operation-passes-search"]') as HTMLInputElement).disabled)
      .toBe(true)
    expect((host.querySelector('[data-testid="search-operation-passes-search-apply"]') as HTMLButtonElement).disabled)
      .toBe(true)
  })
})

function pageState(visibleCount: number) {
  return {
    search: '', pageNumber: 1, visibleCount, totalCount: visibleCount,
    hasMore: false, nextCursor: null, loading: false,
  }
}
