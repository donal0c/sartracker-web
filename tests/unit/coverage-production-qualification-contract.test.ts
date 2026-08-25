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
    const stagedRead = driver.indexOf('const staged = await findGeometryTile(')
    const activate = driver.indexOf('await store.activateCoverageTileCatalog({')
    const activeRead = driver.indexOf(
      'await store.readCoverageTile({ ...staged.address })',
      activate,
    )

    expect(resolveHead).toBeGreaterThan(-1)
    expect(rejectMismatch).toBeGreaterThan(resolveHead)
    expect(stagedRead).toBeGreaterThan(rejectMismatch)
    expect(activate).toBeGreaterThan(stagedRead)
    expect(activeRead).toBeGreaterThan(activate)
  })

  it('probes every newly introduced period with non-empty decoded geometry and binds digests', () => {
    const driver = readFileSync(driverPath, 'utf8')

    expect(driver).toContain("period.periodKey === group.identity")
    expect(driver).toContain('await store.readCoverageChunk({')
    expect(driver).toContain('findGeometryTile(')
    expect(driver).toContain('tileAddressFromPosition(')
    expect(driver).toContain('tile.byteLength === 0')
    expect(driver).toContain('new VectorTile(new Pbf(tile))')
    expect(driver).toContain('geometryFeatureCount')
    expect(driver).toContain('geometrySha256')
    expect(driver).toContain('revisionSha256')
  })
})
