import { describe, expect, it } from 'vitest'

import { createCoverageCatalogActivation } from '../../src/features/tracking/coverage-catalog-activation'
import type { CoverageTileCatalog } from '../../src/infrastructure/mission-store/tauri-mission-store'

function catalog(activationId: string): CoverageTileCatalog {
  return {
    activationId,
    periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'revision-1' }],
    delivered: [],
  }
}

describe('coverage catalog activation [DON-276]', () => {
  it('does not let an obsolete stage acknowledge a newer identical catalog', async () => {
    const activation = createCoverageCatalogActivation()
    const oldCatalog = catalog('coverage-stage-1')
    const newCatalog = catalog('coverage-stage-2')
    const signal = new AbortController().signal
    const oldWait = activation.wait(oldCatalog, signal)

    const newWait = activation.wait(newCatalog, signal)

    await expect(oldWait).rejects.toThrow('superseded')
    expect(activation.isPending(oldCatalog)).toBe(false)
    expect(activation.notifyApplied(oldCatalog)).toBe(false)
    expect(activation.notifyApplied(newCatalog)).toBe(true)
    await expect(newWait).resolves.toBeUndefined()
  })

  it('does not let an obsolete stage reject a newer identical catalog', async () => {
    const activation = createCoverageCatalogActivation()
    const oldCatalog = catalog('coverage-stage-1')
    const newCatalog = catalog('coverage-stage-2')
    const signal = new AbortController().signal
    const oldWait = activation.wait(oldCatalog, signal)
    const newWait = activation.wait(newCatalog, signal)

    await expect(oldWait).rejects.toThrow('superseded')
    expect(activation.reject(oldCatalog, new Error('obsolete'))).toBe(false)
    expect(activation.isPending(newCatalog)).toBe(true)
    expect(activation.notifyApplied(newCatalog)).toBe(true)
    await expect(newWait).resolves.toBeUndefined()
  })
})
