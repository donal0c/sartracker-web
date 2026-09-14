import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Repair Train D packaged smoke script', () => {
  const source = readFileSync('scripts/electron-repair-train-d-smoke.mjs', 'utf8')

  it('accepts a paused recoverable mission before using the operator Resume control', () => {
    const ensureMissionActive = source.slice(
      source.indexOf('async function ensureMissionActive('),
      source.indexOf('/** Closes the packaged app', source.indexOf('async function ensureMissionActive(')),
    )

    expect(ensureMissionActive).toContain("value.recoverable.status === 'paused'")
    expect(ensureMissionActive).toContain("value.recoverable.status === 'active'")
    expect(ensureMissionActive).toContain("getByRole('button', { name: 'Resume', exact: true })")
  })
})
