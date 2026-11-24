import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SMOKE_DIR = path.resolve(__dirname, '../../scripts/team-smoke')

/** Every team-smoke script, so a new check is guarded too. */
function smokeScripts(): readonly { readonly file: string; readonly source: string }[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.mjs')) files.push(full)
    }
  }
  walk(SMOKE_DIR)
  return files.map((file) => ({ file: path.relative(SMOKE_DIR, file), source: readFileSync(file, 'utf8') }))
}

describe('team smoke reaches the controls the simplified workspace shows [DON-368]', () => {
  it('opens People before clicking All devices, which only exists there', () => {
    const unreachable: string[] = []
    for (const { file, source } of smokeScripts()) {
      const lines = source.split('\n')
      lines.forEach((line, index) => {
        if (!line.includes("'open-devices-workspace'")) return
        const before = lines.slice(Math.max(0, index - 3), index).join('\n')
        if (!/openWorkspacePanel\([^)]*'people'\)/u.test(before)) unreachable.push(`${file}:${index + 1}`)
      })
    }
    expect(unreachable).toEqual([])
  })

  it('clears membership notices with Got it by its test id and reports a failure instead of swallowing it', () => {
    const workflow = readFileSync(path.join(SMOKE_DIR, 'checks/team-workflow.mjs'), 'utf8')
    expect(workflow).not.toContain('Acknowledge membership notices')
    expect(workflow).toContain("'participant-membership-notices-ack'")
    expect(workflow).not.toMatch(/participant-membership-notices-ack'\)\.click\(\)\.catch\(\(\) => \{\}\)/u)
    const component = readFileSync(path.resolve(__dirname, '../../src/components/participant-controls-section.tsx'), 'utf8')
    expect(component).toContain('data-testid="participant-membership-notices-ack"')
  })
})
