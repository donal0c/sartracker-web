import { describe, expect, it } from 'vitest'
import { FaultPlan } from './fault-plan'

describe('WAR-02A explicit fault boundaries', () => {
  for (const code of ['EIO', 'ENOSPC', 'INTERRUPTED'] as const) {
    for (const boundary of ['before', 'after'] as const) {
      it(`${code} at ${boundary} the selected occurrence`, async () => {
        const plan = new FaultPlan({ operation: 'file.sync', boundary, occurrence: 2, code })
        let effects = 0
        await plan.run('file.sync', async () => { effects++ })
        await expect(plan.run('file.sync', async () => { effects++ })).rejects.toMatchObject({ code })
        expect(effects).toBe(boundary === 'before' ? 1 : 2)
        plan.assertTriggered()
        expect(plan.trace.filter((entry) => entry.phase === 'fault')).toHaveLength(1)
      })
    }
  }

  it('fails unused faults and preserves underlying error identity', async () => {
    const plan = new FaultPlan({ operation: 'rename', boundary: 'before', occurrence: 1, code: 'EIO' })
    const failure = new Error('native failure')
    await expect(plan.run('write', async () => { throw failure })).rejects.toBe(failure)
    expect(() => plan.assertTriggered()).toThrow(/not triggered/)
  })
})
