import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const driverPath = 'scripts/coverage-production-qualification.cjs'

describe('production coverage qualification contract [DON-276]', () => {
  it('self-attests the checkout and crosses staged-read, activation, and active-read', () => {
    expect(existsSync(driverPath)).toBe(true)
    if (!existsSync(driverPath)) return
    const driver = readFileSync(driverPath, 'utf8')

    const resolveHead = driver.indexOf("git', ['rev-parse', 'HEAD']")
    const rejectMismatch = driver.indexOf('does not match the expected exact head')
    const stagedRead = driver.indexOf('await store.readCoverageTile({')
    const activate = driver.indexOf('await store.activateCoverageTileCatalog({')
    const activeRead = driver.indexOf('await store.readCoverageTile({', stagedRead + 1)

    expect(resolveHead).toBeGreaterThan(-1)
    expect(rejectMismatch).toBeGreaterThan(resolveHead)
    expect(stagedRead).toBeGreaterThan(rejectMismatch)
    expect(activate).toBeGreaterThan(stagedRead)
    expect(activeRead).toBeGreaterThan(activate)
  })
})
