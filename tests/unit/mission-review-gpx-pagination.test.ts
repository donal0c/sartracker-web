// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MissionReviewWorkspace } from '../../src/components/mission-review-workspace'
import { buildMissionReviewSnapshot } from '../../src/features/mission-review/mission-review-model'
import { useMissionReviewStore } from '../../src/features/mission-review/mission-review-store'
import type { MissionReviewController } from '../../src/features/mission-review/start-mission-review-runtime'
import { createMissionReviewRuntimeState } from '../../src/features/mission-review/start-mission-review-runtime'
import { useMissionReviewWorkspaceStore } from '../../src/features/mission-review/mission-review-workspace-store'

describe('Mission Review GPX pagination', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    useMissionReviewWorkspaceStore.setState({ open: false })
    host.remove()
  })

  it('discloses the bounded review page and offers the next GPX page [DON-274]', () => {
    const loadNextGpxImports = vi.fn().mockResolvedValue(undefined)
    const mission = {
      id: 'mission-1', name: 'Mission', status: 'finished' as const,
      start_time: '2026-08-28T08:00:00.000Z', finish_time: '2026-08-28T09:00:00.000Z',
      pause_time: null, paused_seconds: 0, notes: null, schema_version: 12,
    }
    const snapshot = buildMissionReviewSnapshot({
      mission,
      info: { schema_version: 12, database_path: '/db', backup_path: '/backup' },
      events: [], markers: [], devices: [], breadcrumbCount: 0, drawings: [], helicopters: [],
      gpxImports: [], layerMetadata: [],
    })
    useMissionReviewStore.setState({
      ...createMissionReviewRuntimeState({
        missions: [mission], selectedMissionId: mission.id, snapshot,
        gpxImports: {
          pageNumber: 1, visibleCount: 25, hasMore: true, loading: false,
          nextCursor: 'next-page',
        },
      }),
      controller: {
        load: vi.fn().mockResolvedValue(undefined),
        loadNextGpxImports,
      } as unknown as MissionReviewController,
    })
    useMissionReviewWorkspaceStore.setState({ open: true })

    act(() => root.render(createElement(MissionReviewWorkspace)))

    expect(host.querySelector('[data-testid="mission-review-gpx-pagination"]')?.textContent)
      .toContain('More imported evidence is available')
    act(() => {
      ;(host.querySelector('[data-testid="mission-review-gpx-next-page"]') as HTMLButtonElement).click()
    })
    expect(loadNextGpxImports).toHaveBeenCalledOnce()
  })

  it('keeps retained Search pages usable but evidence entry blocked after Review failure [DON-279]', async () => {
    const mission = {
      id: 'mission-1', name: 'Mission', status: 'active' as const,
      start_time: '2026-08-28T08:00:00.000Z', finish_time: null,
      pause_time: null, paused_seconds: 0, notes: null, schema_version: 12,
    }
    const snapshot = buildMissionReviewSnapshot({
      mission,
      info: { schema_version: 12, database_path: '/db', backup_path: '/backup' },
      events: [], markers: [], devices: [], breadcrumbCount: 0, drawings: [], helicopters: [],
      gpxImports: [], layerMetadata: [],
    })
    useMissionReviewStore.setState({
      ...createMissionReviewRuntimeState({
        missions: [mission], selectedMissionId: mission.id, snapshot,
        error: 'Review reload failed',
        searchOperations: {
          areas: [{
            id: 'area-1', mission_id: mission.id, name: 'Area Alpha', status: 'active',
            geometry_json: '{"type":"Polygon","coordinates":[]}', legacy_drawing_id: null,
            version_sequence: 1, updated_by: 'Coordinator',
            created_at: mission.start_time, updated_at: mission.start_time, retired_at: null,
          }],
          assignments: [], passes: [],
          outings: [{
            id: 'outing-1', mission_id: mission.id, label: 'Operational period 1',
            started_at: mission.start_time, ended_at: null,
            created_at: mission.start_time, updated_at: mission.start_time,
          }],
          pages: {
            areas: pageState(1), assignments: pageState(0), outings: pageState(1),
            passes: {
              ...pageState(25), pageNumber: 2, hasMore: true,
              nextCursor: 'opaque-next', loading: false,
            },
          },
        },
      }),
      controller: {
        load: vi.fn().mockResolvedValue(undefined),
        refreshSelectedMission: vi.fn().mockResolvedValue(undefined),
      } as unknown as MissionReviewController,
    })
    useMissionReviewWorkspaceStore.setState({ open: true })

    act(() => root.render(createElement(MissionReviewWorkspace)))

    const searchPassesTab = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'Search Passes')
    expect(searchPassesTab).toBeDefined()
    act(() => {
      searchPassesTab?.click()
    })
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="search-operations-workspace"]')).not.toBeNull()
    })

    expect(host.querySelector('[data-testid="mission-review-stale-warning"]')?.textContent)
      .toMatch(/update failed.*showing retained evidence.*entry is disabled/i)
    expect((host.querySelector('[data-testid="search-operation-passes-search-apply"]') as HTMLButtonElement).disabled)
      .toBe(false)
    expect((host.querySelector('[data-testid="search-operation-passes-first"]') as HTMLButtonElement).disabled)
      .toBe(false)
    expect((host.querySelector('[data-testid="search-operation-passes-next"]') as HTMLButtonElement).disabled)
      .toBe(false)
    expect((host.querySelector('[data-testid="search-operation-entry"] fieldset') as HTMLFieldSetElement).disabled)
      .toBe(true)
  })
})

function pageState(visibleCount: number) {
  return {
    search: '', pageNumber: 1, visibleCount, totalCount: visibleCount,
    hasMore: false, nextCursor: null, loading: false,
  }
}
