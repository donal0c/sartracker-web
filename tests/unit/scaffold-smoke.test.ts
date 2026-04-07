import { getDependencySmoke } from '../../src/lib/dependency-smoke'

describe('scaffold dependency smoke', () => {
  it('resolves the locked core dependencies', () => {
    expect(getDependencySmoke()).toEqual({
      hasMapLibre: true,
      hasProj4: true,
      hasTurf: true,
      hasZustand: true,
      hasTerraDraw: true,
    })
  })
})
