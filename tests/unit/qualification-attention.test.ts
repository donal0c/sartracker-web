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
})
