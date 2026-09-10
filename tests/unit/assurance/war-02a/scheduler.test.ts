import { describe, expect, it } from 'vitest'
import { VirtualScheduler, createGate } from './virtual-scheduler'

describe('WAR-02A virtual scheduler contract', () => {
  it('replays all lifecycle event kinds in a selected equal-deadline order', () => {
    const replay = () => {
      const clock = new VirtualScheduler()
      const seen: string[] = []
      for (const label of ['poll', 'mission-switch', 'teardown', 'worker-completion', 'restart']) {
        clock.schedule(label, 10, () => { seen.push(label) })
      }
      clock.advanceTo(9)
      expect(seen).toEqual([])
      clock.advanceTo(10)
      clock.assertIdle()
      return { seen, trace: clock.trace }
    }
    expect(replay()).toEqual(replay())
    expect(replay().seen).toEqual(['poll', 'mission-switch', 'teardown', 'worker-completion', 'restart'])
  })

  it('cancels timers and executes nested same-time work after existing work', () => {
    const clock = new VirtualScheduler()
    const seen: string[] = []
    const cancelled = clock.setTimeout(() => { seen.push('cancelled') }, 5)
    clock.clearTimeout(cancelled)
    clock.schedule('outer', 5, () => {
      seen.push('outer')
      clock.schedule('inner', 0, () => { seen.push('inner') })
    })
    clock.schedule('peer', 5, () => { seen.push('peer') })
    clock.advanceTo(5)
    expect(seen).toEqual(['outer', 'peer', 'inner'])
    clock.assertIdle()
  })

  it('rejects invalid/backwards time, leftover tasks and runaway queues', () => {
    const clock = new VirtualScheduler(4)
    for (const delay of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => clock.schedule('invalid', delay, () => {})).toThrow()
    }
    clock.advanceTo(2)
    expect(() => clock.advanceTo(1)).toThrow(/backward/)
    const loop = () => { clock.schedule('loop', 0, loop) }
    loop()
    expect(() => clock.assertIdle()).toThrow(/pending/)
    expect(() => clock.advanceTo(2)).toThrow(/budget/)
  })

  it('gates asynchronous completion on an explicit release and rejects reuse', async () => {
    const gate = createGate<number>('sqlite completion')
    const completion = gate.wait()
    await gate.entered
    expect(gate.state()).toBe('waiting')
    gate.release(42)
    await expect(completion).resolves.toBe(42)
    expect(() => gate.release(43)).toThrow(/already/)
    expect(() => gate.wait()).toThrow(/already/)
  })

  it('rejects reentrant advancement without moving the outer clock backward', () => {
    const clock = new VirtualScheduler()
    clock.schedule('nested advance', 1, () => { clock.advanceTo(10) })
    expect(() => clock.advanceTo(2)).toThrow(/reentrant/)
    expect(clock.now()).toBe(1)
  })

  it('reports an unreleased gate and supports controlled asynchronous rejection', async () => {
    const gate = createGate<void>('failed completion')
    const completion = gate.wait()
    const assertion = expect(completion).rejects.toThrow('worker failed')
    await gate.entered
    expect(() => gate.assertSettled()).toThrow(/not settled/)
    gate.reject(new Error('worker failed'))
    await assertion
    gate.assertSettled()
  })
})
