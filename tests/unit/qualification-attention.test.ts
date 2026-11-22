// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createAttentionScenario, startAttentionServer } from '../../scripts/qualification/attention-server.mjs'
import { validateAttentionSurface } from '../../scripts/qualification/attention-receipts.mjs'

describe('packaged attention independent source and UI oracle', () => {
  it('serves fixed source fixes, explicit outages and recovery on loopback only', async () => {
    const source = createAttentionScenario(1800000000000)
    expect(Date.parse(source.stationary[1].fixTime) - Date.parse(source.stationary[0].fixTime)).toBe(1200000)
    const server = await startAttentionServer(source)
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/)
      expect((await (await fetch(server.url + '/api/positions?deviceId=1')).json()).length).toBe(2)
      server.setStage('disconnected')
      expect((await fetch(server.url + '/api/devices')).status).toBe(503)
      server.setStage('moving')
      expect((await (await fetch(server.url + '/api/positions?deviceId=1')).json()).length).toBe(4)
      expect(() => server.setStage('unknown')).toThrow()
    } finally { await server.close() }
  })

  it('rejects missing UI transitions, altered evidence and source movement mutants', () => {
    const facts = { source: createAttentionScenario(1800000000000), attention: 'Stationary Attention',
      acknowledged: 'Attention Acknowledged', stale: 'offline', disconnected: 'offline', recovered: 'online',
      cleared: true, currentVisible: true, renderedCurrent: { coordinates: [-9.7, 52.00101], attention: false },
      evidenceBeforeAck: 'a'.repeat(64), evidenceAfterAck: 'a'.repeat(64) }
    expect(validateAttentionSurface(facts).passed).toBe(true)
    for (const key of ['attention', 'acknowledged', 'stale', 'disconnected', 'recovered']) {
      expect(() => validateAttentionSurface({ ...facts, [key]: '' })).toThrow()
    }
    expect(() => validateAttentionSurface({ ...facts, evidenceAfterAck: 'b'.repeat(64) })).toThrow()
    expect(() => validateAttentionSurface({ ...facts, cleared: false })).toThrow()
    const changed = structuredClone(facts)
    changed.source.stationary[1].latitude = 53
    expect(() => validateAttentionSurface(changed)).toThrow()
  })

  it('accepts the new top bar only when its condition, label and visible words agree [DON-353]', () => {
    // The new layout (DON-341) has no mode chip: the top bar shows short problem
    // words ("TRACKING LOST", "Tracking OK") and carries the condition the advice
    // is chosen by. The label is the full sentence for screen readers.
    const facts = { source: createAttentionScenario(1800000000000), attention: 'Stationary Attention',
      acknowledged: 'Attention Acknowledged', stale: 'offline',
      disconnected: 'TRACKING LOST. Open tracking details', disconnectedCondition: 'lost', disconnectedWords: 'TRACKING LOST',
      recovered: 'Tracking OK. Open tracking details', recoveredCondition: 'ok', recoveredWords: 'Tracking OK',
      cleared: true, currentVisible: true, renderedCurrent: { coordinates: [-9.7, 52.00101], attention: false },
      evidenceBeforeAck: 'a'.repeat(64), evidenceAfterAck: 'a'.repeat(64) }
    expect(validateAttentionSurface(facts).passed).toBe(true)
    expect(validateAttentionSurface({ ...facts, disconnectedCondition: 'disconnected',
      disconnected: 'Tracking not connected. Open tracking details', disconnectedWords: 'Tracking not connected' }).passed).toBe(true)
    expect(validateAttentionSurface({ ...facts, recoveredCondition: 'attention',
      recovered: '1 position out of date. Open tracking details', recoveredWords: '1 stale' }).passed).toBe(true)

    const lossFails = (change: Record<string, unknown>) =>
      expect(() => validateAttentionSurface({ ...facts, ...change })).toThrow(/tracking-loss transition failed/)
    lossFails({ disconnectedCondition: 'ok' })
    lossFails({ disconnectedCondition: 'paused' })
    lossFails({ disconnected: 'Tracking OK. Open tracking details' })
    lossFails({ disconnectedWords: '' })
    lossFails({ disconnectedWords: undefined })
    lossFails({ disconnectedWords: 'Tracking OK' })
    lossFails({ disconnectedCondition: 'disconnected', disconnectedWords: 'Tracking OK' })

    const recoveryFails = (change: Record<string, unknown>) =>
      expect(() => validateAttentionSurface({ ...facts, ...change })).toThrow(/tracking-recovery transition failed/)
    recoveryFails({ recoveredCondition: 'lost' })
    recoveryFails({ recoveredCondition: 'paused' })
    recoveryFails({ recovered: '' })
    recoveryFails({ recoveredWords: '' })
    recoveryFails({ recoveredWords: undefined })
    recoveryFails({ recovered: 'MISSION PAUSED. Open tracking details' })
    recoveryFails({ recoveredWords: 'MISSION PAUSED' })
    recoveryFails({ recoveredWords: 'TRACKING LOST' })
    recoveryFails({ recovered: 'Tracking not connected. Open tracking details' })
    // An attention headline with the label and words otherwise matching, so only
    // the guard under test can catch each one.
    const attention = { recoveredCondition: 'attention', recovered: '1 position out of date. Open tracking details', recoveredWords: '1 stale' }
    recoveryFails({ ...attention, recoveredWords: 'Tracking not connected' })
    recoveryFails({ ...attention, recoveredWords: 'Offline' })
    recoveryFails({ ...attention, recoveredWords: 'MISSION PAUSED' })
    recoveryFails({ ...attention, recovered: 'Tracking not connected. Open tracking details' })
    recoveryFails({ ...attention, recoveredWords: '' })
    recoveryFails({ ...attention, recoveredWords: '   ' })
    recoveryFails({ ...attention, recovered: '' })
    recoveryFails({ recoveredCondition: 'attention', recovered: 'Tracking OK. Open tracking details' })
    recoveryFails({ recoveredWords: '1 stale' })

    // A failure names the transition and quotes what was seen.
    expect(() => validateAttentionSurface({ ...facts, recoveredWords: 'MISSION PAUSED' })).toThrow(/"MISSION PAUSED"/)
  })
})
