import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { selectContractSuite, contractSuiteVariants } from '../../scripts/qualification/contract-suite-catalog.mjs'

describe('reviewed lower-tier contract test selection', () => {
  it('retains the complete strict responsiveness file inventory', () => {
    const files = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' }).trim().split('\n')
    const configured = [...readFileSync('vitest.responsiveness.config.ts', 'utf8').matchAll(/'(tests\/unit\/[^']+)'/gu)].map((match) => match[1]).sort()
    expect(selectContractSuite('C24', 'source', files).files).toEqual(configured)
  })
  it('resolves every advertised variant against actual tracked tests, with no stale paths', () => {
    const files = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' }).trim().split('\n')
    for (const variant of contractSuiteVariants()) {
      expect(selectContractSuite(variant.contractId, variant.proofMode, files).files.length, `${variant.contractId}:${variant.proofMode}`).toBeGreaterThan(0)
    }
  })
  it('selects actual coordinate source regressions without claiming package proof', () => {
    expect(selectContractSuite('C13', 'source', ['tests/unit/coordinates.test.ts', 'tests/unit/other.test.ts']).files).toEqual(['tests/unit/coordinates.test.ts'])
    expect(() => selectContractSuite('C13', 'installed-deb', ['tests/unit/coordinates.test.ts'])).toThrow()
  })
  it('includes the repaired drawing-math boundary and provider ingest parser in their family inventories', () => {
    const files = ['tests/unit/drawing-math.test.ts', 'tests/unit/traccar-client.test.ts']
    expect(selectContractSuite('C13', 'source', files).files).toEqual([files[0]])
    expect(selectContractSuite('C05', 'source', files).files).toEqual([files[1]])
  })
  it('rejects a missing or duplicate reviewed file instead of accepting an empty successful process', () => {
    expect(() => selectContractSuite('C13', 'source', [])).toThrow()
    expect(() => selectContractSuite('C13', 'source', ['tests/unit/coordinates.test.ts', 'tests/unit/coordinates.test.ts'])).toThrow()
    expect(() => selectContractSuite('C13', 'browser', ['tests/e2e/drawings.spec.ts'])).toThrow()
  })
})
