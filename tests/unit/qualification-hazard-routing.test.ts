import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileCoverageRegistry } from '../../scripts/qualification/control-plane.mjs'

describe('qualification hazard routing', () => {
  it('routes every primary hazard to a contract actually required by the canonical QA map', () => {
    const registry = compileCoverageRegistry(JSON.parse(readFileSync('docs/assurance/qualification-contracts.json', 'utf8')))
    const plan = readFileSync('docs/assurance/post-pr6-model-judged-qa-plan.md', 'utf8')
    const required = new Map([...plan.matchAll(/^\| `([A-Z]+-\d{3})`[^|]*\| ([^|]+)\|/gmu)]
      .map(match => [match[1], [...match[2].matchAll(/C\d{2}/gu)].map(value => value[0])]))
    expect(required.size).toBe(registry.releaseCriticalHazards.length)
    for (const row of registry.coverage) expect(required.get(row.hazard), row.hazard).toContain(row.contractId)
  })
})
