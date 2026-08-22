import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('operator manual exact breadcrumb-dot contract [DON-260]', () => {
  it('separates exact paged dots from the bounded line simplification contract', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')
    const start = manual.indexOf('<strong>Breadcrumb Display</strong>')
    const end = manual.indexOf('<strong>Breadcrumb Size</strong>', start)
    const section = manual.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(section).toMatch(/Solid line[\s\S]*Trail display simplified/iu)
    expect(section).toMatch(/Breadcrumb dots[\s\S]*exact fixes/iu)
    expect(section).toContain('10,000')
    expect(section).toMatch(/Earlier[\s\S]*Later/iu)
    expect(section).toMatch(/dots[\s\S]*never[\s\S]*(?:representative|sample)/iu)
    expect(section).toMatch(/source-exact inspection contract/iu)
    expect(section).toMatch(/same fix identities, timestamps, and coordinates/iu)
    expect(section).toMatch(/does not add a separate breadcrumb-export button/iu)
    expect(section).not.toContain('dots</strong> to show one dot for every tracking fix\n            retained in the live display window')
  })
})
