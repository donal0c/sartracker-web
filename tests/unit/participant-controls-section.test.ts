import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ParticipantControlsSection } from '../../src/components/participant-controls-section'
import { useMissionStore } from '../../src/features/mission/mission-store'
import type { ParticipantRuntimeController } from '../../src/features/participants/start-participant-runtime'
import { useParticipantStore } from '../../src/features/participants/participant-store'

let root: Root | null = null
let host: HTMLDivElement | null = null

describe('ParticipantControlsSection [DON-271]', () => {
  it('offers explicit recovery for removed unknown legacy groups', () => {
    useParticipantStore.setState({ participants: [{
      id: 'legacy', mission_id: 'mission', kind: 'group', traccar_device_id: null,
      mission_team_id: 'team', provenance: 'explicit', effective_from: '2026-08-20T08:00:00Z',
      added_at: '2026-08-20T09:00:00Z', added_by: 'A', removed_at: '2026-08-20T10:00:00Z', removed_by: 'A',
      starting_member_device_ids_json: null, backfill_scope_unknown: true,
    }] })
    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
    expect(document.querySelector('[data-testid="legacy-roster-recovery"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[data-testid="legacy-roster-confirm"]')?.disabled).toBe(true)
  })

  it('keeps corruption errors visible for removed groups without offering attestation', () => {
    useParticipantStore.setState({ participants: [{ id: 'broken', mission_id: 'mission', kind: 'group',
      traccar_device_id: null, mission_team_id: 'team', provenance: 'explicit',
      effective_from: '2026-08-20T08:00:00Z', added_at: '2026-08-20T09:00:00Z', added_by: 'A',
      removed_at: '2026-08-20T10:00:00Z', removed_by: 'A', backfill_scope_unknown: true,
      backfill_scope_error: 'Stored roster attestation is invalid. Retain this mission for repair.' }] })
    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
    expect(document.querySelector('[data-testid="participant-management"]')?.textContent).toContain('Stored roster attestation is invalid')
    expect(document.querySelector('[data-testid="legacy-roster-recovery"]')).toBeNull()
  })
  it('shows explicit zero-member backfill status', () => {
    useParticipantStore.setState({ participants: [{
      id: 'empty-group', mission_id: 'mission', kind: 'group',
      traccar_device_id: null, mission_team_id: 'team', traccar_group_id: '1', team_name: 'Empty team',
      provenance: 'explicit', effective_from: '2026-09-13T08:00:00Z', added_at: '2026-09-13T09:00:00Z',
      added_by: 'Coordinator', removed_at: null, removed_by: null,
      backfill_member_count: 0, backfill_completed_count: 0, backfill_scope_unknown: false,
    }] })
    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
    expect(document.querySelector('[data-testid="participant-backfill-status"]')?.textContent)
      .toContain('complete for 0/0 required group members')
  })

  afterEach(() => {
    if (root !== null) act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    useParticipantStore.setState(useParticipantStore.getInitialState())
    useMissionStore.setState(useMissionStore.getInitialState())
  })

  describe('history start for participants added after Start [DON-291]', () => {
    const missionStart = '2026-09-27T06:10:39.479Z'

    function renderActiveMission(addParticipant: ParticipantRuntimeController['addParticipant']): void {
      useMissionStore.setState({
        phase: 'active',
        currentMission: { id: 'mission-1', name: 'Lookback', start_time: missionStart } as never,
      })
      useParticipantStore.setState({
        controller: { addParticipant } as unknown as ParticipantRuntimeController,
        availableDevices: [{
          device_id: '11', name: 'History Hotel', status: 'offline', last_seen: null,
          unique_id: 'hist-11', category: null, group_id: null,
        } as never],
      })
      render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
      changeSelect('[data-testid="participant-add-ref"]', '11')
    }

    it('keeps Add disabled until the coordinator chooses where history starts', () => {
      renderActiveMission(async () => null)
      expect(addButton().disabled).toBe(true)
      expect(document.querySelector('[data-testid="participant-history-start-mission"]')?.closest('label')?.textContent)
        .toContain(new Date(missionStart).toLocaleString())
      click('[data-testid="participant-history-start-now"]')
      expect(addButton().disabled).toBe(false)
    })

    it('adds a late participant from the exact mission start when chosen', async () => {
      const calls: unknown[] = []
      renderActiveMission(async (input) => {
        calls.push(input)
        return null
      })
      click('[data-testid="participant-history-start-mission"]')
      await act(async () => addButton().click())
      expect(calls).toEqual([expect.objectContaining({ kind: 'device', ref: '11', effective_from: missionStart })])
    })

    it('adds From now without an effective time so the store stamps the add time', async () => {
      const calls: Array<Record<string, unknown>> = []
      renderActiveMission(async (input) => {
        calls.push(input as Record<string, unknown>)
        return null
      })
      click('[data-testid="participant-history-start-now"]')
      await act(async () => addButton().click())
      expect(calls).toHaveLength(1)
      expect(calls[0]).not.toHaveProperty('effective_from')
    })

    it('says no earlier history was requested instead of claiming backfill complete', () => {
      useParticipantStore.setState({ participants: [{
        id: 'late', mission_id: 'mission-1', kind: 'device', traccar_device_id: '11', mission_team_id: null,
        provenance: 'explicit', effective_from: '2026-09-29T06:13:04.050Z', added_at: '2026-09-29T06:13:04.050Z',
        added_by: 'Mission coordinator', removed_at: null, removed_by: null, backfill_completed: 1,
      }] })
      render(React.createElement(ParticipantControlsSection, { phase: 'active' }))
      const status = document.querySelector('[data-testid="participant-backfill-status"]')?.textContent ?? ''
      expect(status).toContain('no earlier history requested')
      expect(status).not.toContain('complete')
    })

    it('warns on the start step that a lookback only applies to selected participants', () => {
      render(React.createElement(ParticipantControlsSection, { phase: 'idle', lookbackRequested: true }))
      expect(document.querySelector('[data-testid="participant-lookback-notice"]')?.textContent)
        .toContain('Earlier history is only fetched for participants selected here')
    })

    it('shows no lookback notice when the mission starts now', () => {
      render(React.createElement(ParticipantControlsSection, { phase: 'idle', lookbackRequested: false }))
      expect(document.querySelector('[data-testid="participant-lookback-notice"]')).toBeNull()
    })
  })

  it('surfaces active-mission membership bookkeeping failures', () => {
    useParticipantStore.setState({
      rosterError: 'Group membership could not be recorded: disk busy',
    })

    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))

    expect(document.querySelector('[data-testid="participant-roster-error"]')?.textContent)
      .toContain('disk busy')
  })

  it('exposes bounded participant identity for packaged readiness checks', () => {
    useParticipantStore.setState({
      participants: [{
        id: 'participant-device-991',
        mission_id: 'mission-1',
        kind: 'device',
        traccar_device_id: '991',
        mission_team_id: null,
        traccar_group_id: null,
        team_name: null,
        provenance: 'explicit',
        effective_from: '2026-09-05T08:00:00.000Z',
        added_at: '2026-09-05T08:00:00.000Z',
        added_by: 'Mission coordinator',
        removed_at: null,
        removed_by: null,
      }],
    })

    render(React.createElement(ParticipantControlsSection, { phase: 'active' }))

    const row = document.querySelector('[data-testid="participant-active-list"] > .sar-readout')
    expect(row?.getAttribute('data-participant-kind')).toBe('device')
    expect(row?.getAttribute('data-traccar-device-id')).toBe('991')
  })
})

function addButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="participant-add-btn"]')
  if (button === null) throw new Error('Add participant button is missing.')
  return button
}

function click(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`${selector} is missing.`)
  act(() => element.click())
}

function changeSelect(selector: string, value: string): void {
  const select = document.querySelector<HTMLSelectElement>(selector)
  if (select === null) throw new Error(`${selector} is missing.`)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function render(element: React.ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(element))
}
