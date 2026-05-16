import { describe, expect, it } from 'vitest'

import {
  createMapPanClickGuard,
  isPointInsideMapContainer,
  shouldIgnoreMapInteraction,
} from '../../src/features/map/map-interaction-guards'

describe('map interaction guards', () => {
  it('ignores clicks when there is no active mission', () => {
    expect(
      shouldIgnoreMapInteraction({
        currentMissionId: null,
        missionPhase: 'idle',
        target: null,
        interactiveSelector: 'button, input, select, label, a',
      }),
    ).toBe(true)
  })

  it('ignores clicks during recovery mode', () => {
    expect(
      shouldIgnoreMapInteraction({
        currentMissionId: 'mission-1',
        missionPhase: 'recovery',
        target: null,
        interactiveSelector: 'button, input, select, label, a',
      }),
    ).toBe(true)
  })

  it('ignores clicks from interactive controls matching the provided selector', () => {
    const textArea = document.createElement('textarea')
    expect(
      shouldIgnoreMapInteraction({
        currentMissionId: 'mission-1',
        missionPhase: 'active',
        target: textArea,
        interactiveSelector: 'button, input, select, label, textarea, a',
      }),
    ).toBe(true)
  })

  it('allows clicks on the map surface during an active mission', () => {
    const surface = document.createElement('div')
    expect(
      shouldIgnoreMapInteraction({
        currentMissionId: 'mission-1',
        missionPhase: 'active',
        target: surface,
        interactiveSelector: 'button, input, select, label, a',
      }),
    ).toBe(false)
  })

  it('allows clicks with null target during an active mission', () => {
    expect(
      shouldIgnoreMapInteraction({
        currentMissionId: 'mission-1',
        missionPhase: 'active',
        target: null,
        interactiveSelector: 'button, input, select, label, a',
      }),
    ).toBe(false)
  })

  it('allows clicks during a paused mission', () => {
    const surface = document.createElement('div')
    expect(
      shouldIgnoreMapInteraction({
        currentMissionId: 'mission-1',
        missionPhase: 'paused',
        target: surface,
        interactiveSelector: 'button, input, select, label, a',
      }),
    ).toBe(false)
  })

  it('detects points inside the map container bounds', () => {
    expect(
      isPointInsideMapContainer(
        { x: 120, y: 80 },
        { left: 100, right: 300, top: 50, bottom: 250 },
      ),
    ).toBe(true)
  })

  it('detects points outside the map container bounds', () => {
    expect(
      isPointInsideMapContainer(
        { x: 301, y: 80 },
        { left: 100, right: 300, top: 50, bottom: 250 },
      ),
    ).toBe(false)
  })

  it('does not suppress a deliberate click with small pointer jitter', () => {
    const guard = createMapPanClickGuard()

    guard.recordPointerDown({ x: 200, y: 120 })
    guard.recordPointerMove({ x: 202, y: 123 })
    guard.recordPointerUp()

    expect(guard.consumeClickSuppression()).toBe(false)
  })

  it('suppresses exactly one click after pointer movement crosses the pan threshold', () => {
    const guard = createMapPanClickGuard()

    guard.recordPointerDown({ x: 200, y: 120 })
    guard.recordPointerMove({ x: 212, y: 128 })
    guard.recordPointerUp()

    expect(guard.consumeClickSuppression()).toBe(true)
    expect(guard.consumeClickSuppression()).toBe(false)
  })
})
