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
): MissionReplayRuntimeState {
  return {
    mode: 'replay',
    selectedTime: REPLAY_TIME,
    loading: false,
    loadingMore: false,
    error: null,
    result: {
      missionId: 'mission-1',
      selectedTime: REPLAY_TIME,
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
      availableDeviceIds: [],
      availableOutingIds: [],
      deviceFilterIds: [],
      outingFilterIds: [],
      staticGpxEvidence: [],
      nextCursor: null,
      progress: 1,
      limitations,
    },
  }
}
