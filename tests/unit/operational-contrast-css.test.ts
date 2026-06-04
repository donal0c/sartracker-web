import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = readFileSync('src/index.css', 'utf8')

describe('operational contrast chrome', () => {
  it('uses strong non-colour cues for selected tabs, tree rows, and selected rows', () => {
    expect(css).toContain('inset 4px 0 var(--sar-selection-edge)')
    expect(css).toContain('outline: 1px solid rgba(250, 250, 249, 0.14)')
    expect(css).toContain('--sar-selection-fill: rgba(250, 204, 21, 0.28)')
    expect(css).toContain('.sar-segment-option-active')
  })

  it('keeps primary panels visibly separated from the shell background', () => {
    expect(css).toContain('--sar-line: rgba(232, 222, 207, 0.34)')
    expect(css).toContain('--sar-panel-raised: #242018')
  })
})
