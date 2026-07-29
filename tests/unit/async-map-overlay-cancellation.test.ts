import type maplibregl from 'maplibre-gl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { syncHelicopterOverlay } from '../../src/features/helicopters/sync-helicopter-overlay'
import { syncMarkerOverlay } from '../../src/features/markers/sync-marker-overlay'
import { loadSvgIcon } from '../../src/features/map/map-overlay-primitives'

vi.mock('../../src/features/map/map-overlay-primitives', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/features/map/map-overlay-primitives')
  >()
  return {
    ...actual,
    loadSvgIcon: vi.fn(),
  }
})

describe('asynchronous map overlay cancellation', () => {
  beforeEach(() => {
    vi.mocked(loadSvgIcon).mockReset()
  })

  it.each([
    {
      name: 'marker',
      synchronize: (map: maplibregl.Map, signal: AbortSignal) =>
        syncMarkerOverlay(
          map,
          [],
          { ipp_lkp: true, clue: true, hazard: true, casualty: true },
          [],
          signal,
        ),
    },
    {
      name: 'helicopter',
      synchronize: (map: maplibregl.Map, signal: AbortSignal) =>
        syncHelicopterOverlay(
          map,
          [],
          { slot_1: true, slot_2: true, slot_3: true, slot_4: true },
          [],
          signal,
        ),
    },
  ])('does not mutate the map after a disposed $name icon load completes', async ({ synchronize }) => {
    let resolveIcon: (image: ImageData) => void = vi.fn()
    vi.mocked(loadSvgIcon).mockImplementationOnce(
      () =>
        new Promise<ImageData>((resolve) => {
          resolveIcon = resolve
        }),
    )
    const map = {
      addImage: vi.fn(),
      hasImage: vi.fn(() => false),
    } as unknown as maplibregl.Map
    const controller = new AbortController()

    const synchronization = synchronize(map, controller.signal)
    controller.abort()
    resolveIcon({} as ImageData)

    await expect(synchronization).rejects.toMatchObject({ name: 'AbortError' })
    expect(map.addImage).not.toHaveBeenCalled()
  })
})
