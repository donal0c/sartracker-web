import { _electron as electron, expect, test } from '@playwright/test'
import { startResponsivenessAttribution, collectAttributionEvidence } from '../../../build/responsiveness-attribution-node.js'
import { clickActionablePointerTarget } from '../../../build/electron-tracking-soak-lib.js'

test('separates injected main, renderer and controller delays in Electron [DON-254]', async () => {
  const app = await electron.launch({ args: ['tests/fixtures/responsiveness-controls.cjs'] })
  try {
    const page = await app.firstWindow()
    const inspector = { evaluate: async (expression: string) => ({ result: { value: await app.evaluate(expression) } }) }
    const targets = ['main', 'renderer', 'controller']
    // Windows has no SIGSTOP/SIGCONT; the POSIX control is mandatory in Linux CI.
    if (process.platform !== 'win32') targets.push('main-descheduled')
    for (const target of targets) {
      const probe = await startResponsivenessAttribution({ mainInspector: inspector, page, mainPid: app.process().pid })
      await page.waitForTimeout(100)
      if (target === 'main') await app.evaluate(() => { const end = performance.now() + 350; while (performance.now() < end) { /* injected main stall */ } })
      if (target === 'renderer') await page.evaluate(() => { const end = performance.now() + 350; while (performance.now() < end) { /* injected renderer stall */ } })
      if (target === 'controller') {
        const end = performance.now() + 350
        while (performance.now() < end) { /* injected external controller stall */ }
      }
      if (target === 'main-descheduled') {
        const pid = app.process().pid!
        process.kill(pid, 'SIGSTOP')
        try { await new Promise(resolve => setTimeout(resolve, 350)) }
        finally { process.kill(pid, 'SIGCONT') }
      }
      await page.waitForTimeout(100)
      const evidence = await probe.stop()
      expect(evidence.collected).toBe(true)
      const mainExpected = target === 'main' || target === 'main-descheduled'
      expect(evidence.main.over200Count > 0).toBe(mainExpected)
      expect(evidence.renderer.timer.over200Count > 0).toBe(target === 'renderer')
      expect(evidence.controller.over200Count > 0).toBe(target === 'controller')
      if (mainExpected) {
        const gap = evidence.main.events.find((entry: { gapMs: number }) => entry.gapMs >= 200)
        expect(gap.processCpuMs > 200).toBe(target === 'main')
      }
      await test.info().attach(`realm-control-${target}`, { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
    }
  } finally { await app.close() }
})

test('records target movement after stable preflight at trusted pointer dispatch [DON-254]', async () => {
  const app = await electron.launch({ args: ['tests/fixtures/responsiveness-controls.cjs'] })
  try {
    const page = await app.firstWindow()
    await page.bringToFront()
    const inspector = { evaluate: async (expression: string) => ({ result: { value: await app.evaluate(expression) } }) }
    const probe = await startResponsivenessAttribution({ mainInspector: inspector, page, mainPid: app.process().pid })
    const movedPage = {
      evaluate: page.evaluate.bind(page),
      mouse: { click: async (x: number, y: number) => {
        await page.getByTestId('open-devices-workspace').evaluate(element => { element.style.top = '220px' })
        await page.mouse.click(x, y)
      } },
    }
    await clickActionablePointerTarget({ page: movedPage, testId: 'open-devices-workspace',
      preflight: { documentFocused: true, targetReceivesPointer: true }, stableDurationMs: 50, timeoutMs: 2000 })
    const evidence = await probe.stop()
    expect(evidence.collected).toBe(true)
    const events = evidence.renderer.pointer.events
    expect(events.map((entry: { type: string }) => entry.type)).toEqual(['pointerdown', 'pointerup', 'click'])
    for (const event of events) {
      expect(event.trusted).toBe(true)
      expect(event.preflight.rect.top).toBe(20)
      expect(event.controls[0].rect.y).toBe(220)
      expect(event.controls[0].inEventPath).toBe(false)
      expect(event.controls[0].receivesPoint).toBe(false)
    }
    await test.info().attach('dispatch-movement-control', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
  } finally { await app.close() }
})

test('publishes an explicit failed collection after Electron transport disappears [DON-254]', async () => {
  const app = await electron.launch({ args: ['tests/fixtures/responsiveness-controls.cjs'] })
  let closed = false
  try {
    const page = await app.firstWindow()
    const inspector = { evaluate: async (expression: string) => ({ result: { value: await app.evaluate(expression) } }) }
    const probe = await startResponsivenessAttribution({ mainInspector: inspector, page, mainPid: app.process().pid })
    await app.close()
    closed = true
    const evidence = await collectAttributionEvidence(probe)
    expect(evidence).toMatchObject({ collected: false, reason: 'collection-failed' })
    expect(evidence.completeness.mandatoryChannelsComplete).toBe(false)
    expect(JSON.parse(JSON.stringify(evidence)).collected).toBe(false)
    await test.info().attach('disconnected-collection', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
  } finally { if (!closed) await app.close() }
})
