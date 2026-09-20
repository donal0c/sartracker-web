import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { C02_LIFECYCLE_VARIANTS } from '../../scripts/qualification/c02-lifecycle-receipts.mjs'
import { BACKUP_FAULT_VARIANTS } from '../../build/electron-storage-diagnostics-kill-probe-lib.js'

describe('mandatory packaged campaign coverage', () => {
  it('requires each packaged scenario on both delivery forms, including lifecycle and storage faults', async () => {
    const plan = JSON.parse(await readFile('docs/assurance/qualification-campaign-plan.json', 'utf8')) as {
      bindings: Array<{ contractId: string; variantId: string; adapterId: string; proofMode: string; mandatory: boolean }>
    }
    const rows = plan.bindings.filter((row) => row.adapterId === 'package.reviewed')
    for (const row of rows) {
      const scenario = row.variantId.replace(/-(?:appimage|installed)$/u, '')
      const siblings = rows.filter((candidate) => candidate.contractId === row.contractId
        && candidate.variantId.replace(/-(?:appimage|installed)$/u, '') === scenario)
      expect(siblings.map((item) => item.proofMode).sort(), `${row.contractId}:${scenario}`).toEqual(['ci-appimage', 'installed-deb'])
      expect(siblings.every((item) => item.mandatory)).toBe(true)
    }
    for (const [contractId, variants] of [['C02', C02_LIFECYCLE_VARIANTS], ['C18', BACKUP_FAULT_VARIANTS]] as const) {
      for (const variant of variants) expect(rows.some((row) => row.contractId === contractId
        && row.variantId.replace(/-(?:appimage|installed)$/u, '') === variant), `${contractId}:${variant}`).toBe(true)
    }
    for (const contractId of ['C03', 'C11', 'C13', 'C14', 'C17']) {
      expect(rows.filter((row) => row.contractId === contractId)).toHaveLength(2)
    }
  })
})
