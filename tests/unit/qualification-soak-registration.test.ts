import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { getCandidateAdapterInventory } from '../../scripts/qualification/candidate-control-plane.mjs'
import { SOAK_ADAPTER_CONTRACTS } from '../../scripts/qualification/soak-adapter.mjs'

describe('qualification packaged soak registration', () => {
  it('registers the executable soak adapter and retained receipt validator', () => {
    const inventory = getCandidateAdapterInventory()
    expect(inventory.adapters).toContain('soak.reviewed')
    expect(inventory.receiptValidators).toContain('soak.receipt')
    expect(SOAK_ADAPTER_CONTRACTS).toEqual(['C04', 'C24', 'C25'])
  })

  it('binds the candidate plan to fixed adapter variants without field-scale substitution', async () => {
    const plan = JSON.parse(await readFile('docs/assurance/qualification-campaign-plan.json', 'utf8')) as {
      bindings: Array<Record<string, unknown>>
    }
    const soakBindings = plan.bindings.filter((binding) => binding.adapterId === 'soak.reviewed')
    expect(soakBindings.map((binding) => `${binding.contractId}:${binding.variantId}`)).toEqual([
      'C04:ci', 'C04:priority-100', 'C24:ci',
      'C04:ci-installed', 'C04:priority-100-installed', 'C24:ci-installed',
      'C24:field-960k', 'C24:field-960k-installed', 'C24:field-2m', 'C24:field-2m-installed',
      'C24:field-local-1gib', 'C24:field-local-1gib-installed',
      'C25:normal', 'C25:extended', 'C25:field-960k', 'C25:field-2m', 'C25:field-local-1gib', 'C25:field-device-modes',
      'C25:normal-installed', 'C25:extended-installed', 'C25:field-960k-installed', 'C25:field-2m-installed', 'C25:field-local-1gib-installed', 'C25:field-device-modes-installed',
    ])
    for (const binding of soakBindings) {
      expect(binding.receiptValidatorId).toBe('soak.receipt')
      expect(binding.proofMode).toBe(binding.variantId.endsWith('-installed') ? 'installed-deb' : 'ci-appimage')
      expect(binding.missionModel).toEqual(binding.variantId.startsWith('priority-100') || binding.variantId.startsWith('field-')
        ? { enabled: true, expectedParticipantRows: 100, expectedParticipantAddedEvents: 0 }
        : { enabled: true, expectedParticipantRows: 32, expectedParticipantAddedEvents: 0 })
      expect(String(binding.oracle)).toMatch(/field-scale|separately bound|priority lane/iu)
    }
  })
})
