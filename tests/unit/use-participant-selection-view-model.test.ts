import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useParticipantStore } from '../../src/features/participants/participant-store'
import { createParticipantSelectionViewModel } from '../../src/features/participants/use-participant-selection-view-model'

describe('participant selection view model [DON-271]', () => {
  beforeEach(() => useParticipantStore.setState(useParticipantStore.getInitialState()))

  it('starts with nothing preselected and counts the union of devices and group members', () => {
    const controller = {
      toggleDraftDevice: vi.fn(),
      toggleDraftGroup: vi.fn(),
    }
    const state = {
      ...useParticipantStore.getState(),
      controller: controller as never,
      availableGroups: [{ group_id: '101', name: 'Hill Team', parent_group_id: null }],
      availableDevices: [
        device('1', '101', 'alpha'),
        device('2', null, 'bravo'),
      ],
      draftGroupIds: ['101'],
      draftDeviceIds: ['1', '2'],
    }

    const model = createParticipantSelectionViewModel(state)

    expect(model.selectedDeviceCount).toBe(2)
    expect(model.availableGroups[0]?.selected).toBe(true)
    expect(model.availableDevices.find((entry) => entry.deviceId === '1')).toMatchObject({
      selected: true,
      coveredBySelectedGroup: true,
    })
    expect(model.availableDevices.find((entry) => entry.deviceId === '2')).toMatchObject({
      selected: true,
      coveredBySelectedGroup: false,
    })
  })

  it('surfaces duplicate unique ids without merging canonical numeric device identities', () => {
    const model = createParticipantSelectionViewModel({
      ...useParticipantStore.getState(),
      availableDevices: [
        device('1', null, 'duplicate'),
        device('2', null, 'duplicate'),
      ],
    })

    expect(model.identityWarning).toContain('duplicate')
    expect(model.identityWarning).toContain('1, 2')
  })

  it('keeps group failure explicit while leaving device-level selection available', () => {
    const model = createParticipantSelectionViewModel({
      ...useParticipantStore.getState(),
      rosterError: 'Groups unavailable; device-level fallback remains available.',
      availableDevices: [device('1', null, 'alpha')],
    })

    expect(model.rosterError).toContain('device-level fallback')
    expect(model.availableDevices).toHaveLength(1)
  })
})

function device(deviceId: string, groupId: string | null, uniqueId: string) {
  return {
    device_id: deviceId,
    name: `Device ${deviceId}`,
    status: 'online' as const,
    last_seen: '2026-08-23T12:00:00.000Z',
    unique_id: uniqueId,
    category: null,
    group_id: groupId,
  }
}
