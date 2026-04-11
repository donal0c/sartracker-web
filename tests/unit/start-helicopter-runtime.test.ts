import { describe, expect, it, vi } from 'vitest'

import { startHelicopterRuntime } from '../../src/features/helicopters/start-helicopter-runtime'

describe('startHelicopterRuntime', () => {
  it('loads persisted helicopter slots for the selected mission', async () => {
    const applyRuntime = vi.fn()
    const controller = await startHelicopterRuntime({
      helicopterStore: {
        listHelicopters: vi.fn().mockResolvedValue([
          createHelicopter('heli-1', 'slot_1', 'Rescue 118'),
        ]),
        upsertHelicopter: vi.fn(),
        deleteHelicopter: vi.fn(),
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeMissionId: 'mission-1',
        helicopters: [expect.objectContaining({ call_sign: 'Rescue 118' })],
      }),
    )
  })

  it('upserts a helicopter slot and replaces an existing slot record', async () => {
    const applyRuntime = vi.fn()
    const upsertHelicopter = vi
      .fn()
      .mockResolvedValueOnce(createHelicopter('heli-1', 'slot_1', 'Rescue 118'))
      .mockResolvedValueOnce(createHelicopter('heli-2', 'slot_1', 'Rescue 118B'))

    const controller = await startHelicopterRuntime({
      helicopterStore: {
        listHelicopters: vi.fn().mockResolvedValue([]),
        upsertHelicopter,
        deleteHelicopter: vi.fn(),
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')
    await controller.upsertSlot({
      slot_key: 'slot_1',
      call_sign: 'Rescue 118',
      lat: 52.01,
      lon: -9.7,
    })
    await controller.upsertSlot({
      slot_key: 'slot_1',
      call_sign: 'Rescue 118B',
      lat: 52.02,
      lon: -9.71,
    })

    expect(upsertHelicopter).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mission_id: 'mission-1',
        slot_key: 'slot_1',
        call_sign: 'Rescue 118B',
      }),
    )
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        helicopters: [expect.objectContaining({ id: 'heli-2', call_sign: 'Rescue 118B' })],
      }),
    )
  })
})

function createHelicopter(id: string, slotKey: 'slot_1' | 'slot_2' | 'slot_3' | 'slot_4', callSign: string) {
  return {
    id,
    mission_id: 'mission-1',
    slot_key: slotKey,
    call_sign: callSign,
    hex_id: null,
    lat: 52.05,
    lon: -9.51,
    altitude: 1200,
    speed: 95,
    heading: 180,
    last_update: '2026-04-11T10:05:00.000Z',
    created_at: '2026-04-11T10:00:00.000Z',
    updated_at: '2026-04-11T10:05:00.000Z',
  }
}
