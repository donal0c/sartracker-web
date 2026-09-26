import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'

type ProbeWindow = typeof globalThis & { gc(): void; __ran?: number }

test('awaited page evaluations survive collection after their body completes', async ({ page, browser }, info) => {
  const require = createRequire(import.meta.url)
  const coreRoot = dirname(require.resolve('playwright-core/package.json'))
  const installed = require('playwright-core/package.json') as { version: string }
  const declared = require('../../package.json') as { devDependencies: { '@playwright/test': string } }
  const manifest = JSON.parse(readFileSync(join(coreRoot, 'browsers.json'), 'utf8')) as {
    browsers: { name: string; browserVersion: string }[]
  }
  expect(installed.version).toBe(declared.devDependencies['@playwright/test'].replace(/^[~^]/, ''))
  expect(browser.version()).toBe(manifest.browsers.find(entry => entry.name === 'chromium')?.browserVersion)
  await page.setContent('<p>Application-free browser driver contract</p>')
  const lifecycle: string[] = []
  page.on('framenavigated', () => lifecycle.push('navigation'))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Runtime.enable')
  cdp.on('Runtime.executionContextsCleared', () => lifecycle.push('contexts-cleared'))
  cdp.on('Runtime.executionContextDestroyed', () => lifecycle.push('context-destroyed'))
  const cases: { hops: number; error: string | null; ran: number | undefined; url: string }[] = []
  try {
    for (const hops of [1, 2, 3, 4, 5, 6]) {
      let error: string | null = null
      try {
        await page.evaluate(async count => {
          // Settle in a later task, after the inspector attaches its promise handler.
          await new Promise<void>(resolve => setTimeout(resolve, 0))
          const probe = globalThis as ProbeWindow
          /** Queue a finite chain around the inspector's promise settlement. */
          const hop = (remaining: number): void => {
            if (remaining) queueMicrotask(() => hop(remaining - 1))
            else probe.gc()
          }
          hop(count)
          probe.__ran = (probe.__ran ?? 0) + 1
        }, hops)
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught)
      }
      const state = await page.evaluate(() => ({ ran: (globalThis as ProbeWindow).__ran, url: location.href }))
      cases.push({ hops, error, ...state })
      // Soft assertions retain all six observations, but every rejection fails the gate.
      expect.soft(error, `evaluation with ${hops} microtask hops must resolve`).toBeNull()
      expect.soft(state.ran).toBe(hops)
      expect.soft(state.url).toBe('about:blank')
      expect.soft(lifecycle).toEqual([])
    }
  } finally {
    await info.attach('driver-contract', {
      body: JSON.stringify({ playwright: installed.version, chromium: browser.version(), cases, lifecycle }, null, 2),
      contentType: 'application/json',
    })
    await cdp.detach()
  }
})
