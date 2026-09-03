import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('generated app version provenance', () => {
  it('embeds the complete source head so packaged proof can bind the visible build to one exact commit', () => {
    const script = readFileSync(
      path.resolve(process.cwd(), 'scripts/generate-app-version.mjs'),
      'utf8',
    )

    expect(script).toContain("git rev-parse HEAD")
    expect(script).not.toContain("git rev-parse --short=12 HEAD")
  })
})
