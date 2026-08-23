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
})

function render(element: React.ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(element))
}
