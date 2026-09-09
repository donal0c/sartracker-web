import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ParticipantControlsSection } from '../../src/components/participant-controls-section'
import { useParticipantStore } from '../../src/features/participants/participant-store'

let root: Root | null = null
let host: HTMLDivElement | null = null

describe('ParticipantControlsSection [DON-271]', () => {
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
