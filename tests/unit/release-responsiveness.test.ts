import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, inject, it, vi } from 'vitest'

import {
  assertResponsivenessForMode,
  assertReleaseResponsiveness,
  isReleaseResponsivenessQualification,
} from '../support/release-responsiveness'

describe('release responsiveness assertion routing', () => {
  it('preserves strict failure at the exact 200 ms boundary', () => {
    expect(() => assertResponsivenessForMode('release-qualification', () => expect(200).toBeLessThan(200)))
      .toThrow()
    expect(() => assertResponsivenessForMode('release-qualification', () => expect(199).toBeLessThan(200)))
      .not.toThrow()
  })

  it('leaves only timing unqualified while workload and correctness still execute', () => {
    const workload = vi.fn(() => ({ rows: 50_000, durationMs: 250 }))
    const timing = vi.fn(() => expect(250).toBeLessThan(200))
    const result = workload()
    assertResponsivenessForMode('correctness', timing)
    expect(result.rows).toBe(50_000)
    expect(workload).toHaveBeenCalledOnce()
    expect(timing).not.toHaveBeenCalled()
    expect(() => {
      assertResponsivenessForMode('correctness', timing)
      expect(result.rows).toBe(49_999)
    }).toThrow()
  })

  it.each([undefined, null, '', 'release', false])('rejects missing or unknown policy: %s', (mode) => {
    expect(() => assertResponsivenessForMode(mode, () => undefined)).toThrow(/mode/u)
  })

  it('receives an explicit policy from both normal and qualification configurations', () => {
    const strict = inject('releaseResponsivenessMode') === 'release-qualification'
    expect(isReleaseResponsivenessQualification()).toBe(strict)
    const assertion = vi.fn(() => expect(200).toBeLessThan(200))
    if (strict) expect(() => assertReleaseResponsiveness(assertion)).toThrow()
    else expect(() => assertReleaseResponsiveness(assertion)).not.toThrow()
    expect(assertion).toHaveBeenCalledTimes(strict ? 1 : 0)
  })

  it('keeps default and mandatory scripts strict and includes every routed assertion file', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(packageJson.scripts.test).toBe('vitest run')
    expect(packageJson.scripts['test:correctness']).toBe('vitest run --config vitest.correctness.config.ts')
    expect(packageJson.scripts['test:responsiveness']).toBe('vitest run --config vitest.responsiveness.config.ts')
    const normal = readFileSync('vitest.config.ts', 'utf8')
    const correctness = readFileSync('vitest.correctness.config.ts', 'utf8')
    const qualification = readFileSync('vitest.responsiveness.config.ts', 'utf8')
    expect(normal).toContain("releaseResponsivenessMode: 'release-qualification'")
    expect(correctness).toContain("releaseResponsivenessMode: 'correctness'")
    expect(correctness).toContain('NOT RUN')
    expect(qualification).toContain("releaseResponsivenessMode: 'release-qualification'")
    expect(qualification).toContain('fileParallelism: false')
    expect(qualification).toContain('passWithNoTests: false')
    const routedFiles = readdirSync('tests/unit').filter((name) => name.endsWith('.test.ts')
      && readFileSync(`tests/unit/${name}`, 'utf8').includes("from '../support/release-responsiveness'"))
    expect(routedFiles.length).toBeGreaterThan(10)
    for (const name of routedFiles) expect(qualification).toContain(`tests/unit/${name}`)
  })

  it('limits whole-case separation to the six internally timed positive probe controls', () => {
    const script = readFileSync('tests/unit/breadcrumb-pr6-qualification-script.test.ts', 'utf8')
    const names = [
      'keeps current publication moving while durable persistence is pending',
      'separates the 50 ms heartbeat from a normal-cadence current publication window',
      'caches probe teardown so every worker is stopped and joined exactly once',
      'drains durable ingest through the qualification worker without blocking publication',
      'measures durable worker queue time from publication through acknowledgement',
      'retries durable ingest while a concurrent cleanup transaction sustains SQLite contention',
    ]
    expect(script.match(/it\.skipIf\(!isReleaseResponsivenessQualification\(\)\)/gu)).toHaveLength(names.length)
    for (const name of names) expect(script).toContain(`it.skipIf(!isReleaseResponsivenessQualification())('${name}'`)
    expect(script).toContain("it('fails closed when the measured main event loop stalls despite off-thread durable ingest'")
    expect(script).toContain("it('fails closed when the durable worker exits before shutdown begins'")
  })
})
