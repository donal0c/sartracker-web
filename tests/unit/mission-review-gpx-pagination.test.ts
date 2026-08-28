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
})
