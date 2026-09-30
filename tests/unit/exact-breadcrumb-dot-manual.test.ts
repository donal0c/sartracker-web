import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('operator manual exact breadcrumb-dot contract [DON-260]', () => {
  it('separates exact paged dots from the simplified line', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')
    const start = manual.indexOf('<h3>Breadcrumbs: line or dots</h3>')
    const end = manual.indexOf('<h3 id="stationary">', start)
    const section = manual.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(section).toMatch(/Solid line[\s\S]*Trail display simplified/iu)
    expect(section).toMatch(/Breadcrumb dots[\s\S]*every real fix/iu)
    expect(section).toContain('10,000')
    expect(section).toMatch(/Earlier[\s\S]*Later/iu)
    expect(section).toMatch(/never uses samples in place of real fixes/iu)
    expect(section).toMatch(/saved history is not simplified/iu)
  })
})
