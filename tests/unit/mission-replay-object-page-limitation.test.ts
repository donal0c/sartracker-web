// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { MissionReplayTab } from '../../src/components/mission-evidence-replay-tabs'
import type { MissionReplayRuntimeState } from '../../src/features/mission-review/start-mission-review-runtime'
import type { MissionReplayReadResult } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('mission replay object-page limitation [DON-278]', () => {
  let host: HTMLDivElement | null = null

  afterEach(() => {
    host?.remove()
    host = null
  })

  it('removes the visible large-state warning when the displayed page is not summarized', async () => {
    host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => root.render(createElement(MissionReplayTab, {
      controller: null,
      missionEndTime: REPLAY_TIME,
      replay: replayState([LARGE_OBJECT_LIMITATION], '0'),
    })))
    expect(host.querySelector('[data-testid="mission-replay-limitation-large_object_details_summarized"]'))
      .not.toBeNull()

    await act(async () => root.render(createElement(MissionReplayTab, {
      controller: null,
      missionEndTime: REPLAY_TIME,
      replay: replayState([], '100'),
    })))
    expect(host.querySelector('[data-testid="mission-replay-limitation-large_object_details_summarized"]'))
      .toBeNull()
    await act(async () => root.unmount())
  })

  it('binds remounted controls to the accepted replay time and display filters [DON-278]', async () => {
    host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => root.render(createElement(MissionReplayTab, {
      controller: null,
      missionEndTime: '2026-08-27T12:00:00.000Z',
      replay: replayState([], '0', {
        selectedTime: REPLAY_TIME,
        availableDeviceIds: ['alpha', 'bravo'],
        deviceFilterIds: ['alpha'],
      }),
    })))

    expect((host.querySelector('[data-testid="mission-replay-time"]') as HTMLInputElement).value)
      .toBe('2026-08-27T10:00')
    expect((host.querySelector('[data-testid="mission-replay-device-filter-alpha"]') as HTMLInputElement).checked)
      .toBe(true)

    await act(async () => root.render(createElement(MissionReplayTab, {
      controller: null,
      missionEndTime: '2026-08-27T12:00:00.000Z',
      replay: replayState([], '0', {
        selectedTime: '2026-08-27T10:00:00.000Z',
        availableDeviceIds: ['alpha', 'bravo'],
        deviceFilterIds: ['bravo'],
      }),
    })))

    expect((host.querySelector('[data-testid="mission-replay-time"]') as HTMLInputElement).value)
      .toBe('2026-08-27T11:00')
    expect((host.querySelector('[data-testid="mission-replay-device-filter-alpha"]') as HTMLInputElement).checked)
      .toBe(false)
    expect((host.querySelector('[data-testid="mission-replay-device-filter-bravo"]') as HTMLInputElement).checked)
      .toBe(true)
    await act(async () => root.unmount())
  })

  it('keeps an unsent historical time draft through live-mission rerenders [DON-278]', async () => {
    host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const liveReplay: MissionReplayRuntimeState = {
      mode: 'live', selectedTime: null, result: null,
      loading: false, loadingMore: false, error: null,
      outingFilters: {
        search: '', pageNumber: 1, visibleCount: 0, totalCount: 0,
        hasMore: false, nextCursor: null, loading: false,
      },
    }

    await act(async () => root.render(createElement(MissionReplayTab, {
      controller: null,
      missionEndTime: '2026-08-29T07:30:00.000Z',
      replay: liveReplay,
    })))
    const timeInput = host.querySelector('[data-testid="mission-replay-time"]') as HTMLInputElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(timeInput, '2026-08-28T12:00')
      timeInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(timeInput.value).toBe('2026-08-28T12:00')

    await act(async () => root.render(createElement(MissionReplayTab, {
      controller: null,
      missionEndTime: '2026-08-29T07:30:01.000Z',
      replay: liveReplay,
    })))
    expect((host.querySelector('[data-testid="mission-replay-time"]') as HTMLInputElement).value)
      .toBe('2026-08-28T12:00')
    await act(async () => root.unmount())
  })
})

const REPLAY_TIME = '2026-08-27T09:00:00.000Z'
const LARGE_OBJECT_LIMITATION = {
  code: 'large_object_details_summarized',
  message: 'Large evidence states are represented by bounded summaries and retained-state hashes in this page.',
  count: 1,
}

function replayState(
  limitations: MissionReplayReadResult['limitations'],
  objectCursor: string,
  overrides: Partial<Pick<MissionReplayReadResult,
    'availableDeviceIds' | 'deviceFilterIds' | 'selectedTime'>> = {},
): MissionReplayRuntimeState {
  const selectedTime = overrides.selectedTime ?? REPLAY_TIME
  return {
    mode: 'replay',
    selectedTime,
    loading: false,
    loadingMore: false,
    error: null,
    outingFilters: {
      search: '', pageNumber: 1, visibleCount: 0, totalCount: 0,
      hasMore: false, nextCursor: null, loading: false,
    },
    result: {
      missionId: 'mission-1',
      selectedTime,
      timezone: 'Europe/Dublin',
      objects: [],
      totalObjectCount: 200,
      objectTypeCounts: {},
      objectCursor,
      nextObjectCursor: null,
      tracks: [],
      trackCursor: '0',
      previousCursor: null,
      totalTrackCount: 0,
      staticGpxPointCount: 0,
      availableDeviceIds: overrides.availableDeviceIds ?? [],
      availableOutingIds: [],
      deviceFilterIds: overrides.deviceFilterIds ?? [],
      outingFilterIds: [],
      staticGpxEvidence: [],
      nextCursor: null,
      progress: 1,
      limitations,
    },
  }
}
