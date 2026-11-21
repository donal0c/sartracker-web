import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('operator manual exact breadcrumb-dot contract [DON-260] [DON-338]', () => {
  it('says the line keeps the whole trail and the exact dots are paged on top of it', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')
    const start = manual.indexOf('<h3>Breadcrumbs: line or dots</h3>')
    const end = manual.indexOf('<h3 id="stationary">', start)
    const section = manual.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(section).toMatch(/Solid line[\s\S]*Trail display simplified/iu)
    expect(section).toMatch(/Breadcrumb dots[\s\S]*keeps the line, so the whole trail is always on the map/iu)
    expect(section).toMatch(/marks real recorded fixes as dots on top of it/iu)
    expect(section).not.toMatch(/shows every real fix as a dot/iu)
    expect(section).toMatch(/line still shows the whole trail/iu)
    expect(section).toContain('10,000')
    expect(section).toMatch(/Earlier[\s\S]*Later/iu)
    expect(section).toMatch(/never use samples in place of real fixes/iu)
    expect(section).toMatch(/saved history is not simplified/iu)
  })
})
