import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const renderer = readFileSync('tools/coverage-renderer-bench/renderer.js', 'utf8')
const worker = readFileSync('tools/coverage-renderer-bench/query-worker.mjs', 'utf8')
const preload = readFileSync('tools/coverage-renderer-bench/preload.cjs', 'utf8')
const main = readFileSync('tools/coverage-renderer-bench/main.cjs', 'utf8')

function functionSource(source: string, name: string, nextDoc: string): string {
  const start = source.indexOf(`async function ${name}`)
  const end = source.indexOf(nextDoc, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Candidate B renderer benchmark handoff [DON-273]', () => {
  it('loads a uniquely staged source before activating it and retiring its predecessor', () => {
    const replacement = functionSource(
      renderer,
      'replaceVectorPeriod',
      '/** Rejects initial loading',
    )

    const stage = replacement.indexOf('await ensureVectorPeriod(event)')
    const loaded = replacement.indexOf('map.isSourceLoaded(staged.sourceId)')
    const activate = replacement.indexOf('await window.coverageBench.activatePeriod({')
    const removeLayer = replacement.indexOf('map.removeLayer(layerId)')
    const removeSource = replacement.indexOf('map.removeSource(previous.sourceId)')

    expect(stage).toBeGreaterThan(-1)
    expect(loaded).toBeGreaterThan(stage)
    expect(activate).toBeGreaterThan(loaded)
    expect(removeLayer).toBeGreaterThan(activate)
    expect(removeSource).toBeGreaterThan(removeLayer)
  })

  it('retains revision generations until renderer activation crosses the IPC boundary', () => {
    expect(worker).toContain("message.type === 'activate-period'")
    expect(worker).toContain('periodIndexGenerations')
    expect(preload).toContain("ipcRenderer.invoke('coverage-bench:activate-period'")
    expect(main).toContain("ipcMain.handle('coverage-bench:activate-period'")
  })
})
