// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MissionReplayTab } from '../../src/components/mission-evidence-replay-tabs'
import type {
  MissionReplayRuntimeState,
  MissionReviewController,
} from '../../src/features/mission-review/start-mission-review-runtime'

describe('mission replay Dublin overlap selection [DON-278]', () => {
  let host: HTMLDivElement | null = null

  afterEach(() => {
    host?.remove()
    host = null
  })

  for (const scenario of [
    { instant: '2026-10-25T00:30:00.000Z', offset: '60' },
    { instant: '2026-10-25T01:30:00.000Z', offset: '0' },
  ]) {
    it(`keeps ${scenario.instant} seekable with its exact repeated-time occurrence`, async () => {
      host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      const seekReplay = vi.fn().mockResolvedValue(undefined)
      const controller = { seekReplay } as unknown as MissionReviewController
      const replay: MissionReplayRuntimeState = {
        mode: 'live', selectedTime: null, result: null,
        loading: false, loadingMore: false, error: null,
      }

      await act(async () => {
        root.render(createElement(MissionReplayTab, {
          controller,
          missionEndTime: scenario.instant,
          replay,
        }))
      })

      const offset = host?.querySelector<HTMLSelectElement>('[data-testid="mission-replay-time-offset"]')
      const seek = host?.querySelector<HTMLButtonElement>('[data-testid="mission-replay-seek"]')
      expect(offset?.value).toBe(scenario.offset)
      expect(seek?.disabled).toBe(false)
      await act(async () => seek?.click())
      expect(seekReplay).toHaveBeenCalledWith(scenario.instant, {})
      await act(async () => root.unmount())
    })
  }
})
