import { describe, expect, it } from 'vitest'

import {
  selectCommandMastTrackingReadout,
  type CommandMastTrackingReadoutInput,
} from '../../src/features/tracking/command-mast-tracking-readout'

function input(overrides: Partial<CommandMastTrackingReadoutInput> = {}): CommandMastTrackingReadoutInput {
  return {
    mode: 'idle',
    fixCount: 0,
    staleCount: 0,
    ...overrides,
  }
}

describe('selectCommandMastTrackingReadout', () => {
  it('uppercases the tracking mode for the cell label', () => {
    expect(selectCommandMastTrackingReadout(input({ mode: 'online' })).label).toBe('ONLINE')
    expect(selectCommandMastTrackingReadout(input({ mode: 'offline' })).label).toBe('OFFLINE')
    expect(selectCommandMastTrackingReadout(input({ mode: 'idle' })).label).toBe('IDLE')
  })

  it('exposes fix and stale as separate values, never as a positions/stale ratio', () => {
    const result = selectCommandMastTrackingReadout(input({ fixCount: 14, staleCount: 13 }))

    expect(result.fix.value).toBe('14')
    expect(result.stale.value).toBe('13')
    // Defends against the original `${positions.length}/${staleCount}` regression
    // that produced the visually impossible "14/13" readout.
    expect(JSON.stringify(result)).not.toMatch(/14\/13/)
  })

  it('renders fix and stale counts as fixed-width strings', () => {
    expect(selectCommandMastTrackingReadout(input({ fixCount: 0 })).fix.value).toBe('0')
    expect(selectCommandMastTrackingReadout(input({ fixCount: 7 })).fix.value).toBe('7')
    expect(selectCommandMastTrackingReadout(input({ fixCount: 99 })).fix.value).toBe('99')
  })

  it('uses the success tone when tracking is online and there is no stale data', () => {
    const result = selectCommandMastTrackingReadout(
      input({ mode: 'online', fixCount: 14, staleCount: 0 }),
    )

    expect(result.tone).toBe('success')
    expect(result.stale.tone).toBe('muted')
  })

  it('uses the warning tone when stale positions exist regardless of mode', () => {
    expect(
      selectCommandMastTrackingReadout(input({ mode: 'online', fixCount: 14, staleCount: 13 })).tone,
    ).toBe('warning')
    expect(
      selectCommandMastTrackingReadout(input({ mode: 'offline', fixCount: 5, staleCount: 4 })).tone,
    ).toBe('warning')
  })

  it('flags the stale chip with warning tone whenever stale positions exist', () => {
    expect(
      selectCommandMastTrackingReadout(input({ staleCount: 1 })).stale.tone,
    ).toBe('warning')
    expect(
      selectCommandMastTrackingReadout(input({ staleCount: 0 })).stale.tone,
    ).toBe('muted')
  })

  it('uses the warning tone for the cell when offline even without stale positions', () => {
    expect(
      selectCommandMastTrackingReadout(input({ mode: 'offline', fixCount: 0, staleCount: 0 })).tone,
    ).toBe('warning')
  })

  it('uses the default tone when idle with no stale positions', () => {
    expect(
      selectCommandMastTrackingReadout(input({ mode: 'idle', fixCount: 0, staleCount: 0 })).tone,
    ).toBe('default')
  })
})
