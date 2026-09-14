import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ParticipantControlsSection } from '../../src/components/participant-controls-section'
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

function render(element: React.ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(element))
}
