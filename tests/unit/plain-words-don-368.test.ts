import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * Rule 14 of the team's simplification brief: plain words on screen, no
 * Telemetry, Cache, Fixes or "Workspace" (DON-368). These are the words the
 * browser audit of master found on operator screens. Diagnostics and export
 * file content are not screen words and are not checked here.
 */
const SCREEN_WORDS: readonly { readonly file: string; readonly jargon: readonly RegExp[] }[] = [
  { file: 'src/features/mission/mission-section-summary.ts', jargon: [/fixes Unassigned/] },
  { file: 'src/components/mission-control-panel.tsx', jargon: [/return to IDLE/] },
  { file: 'src/components/settings/tracking-sources-section.tsx', jargon: [/Secrets stay out of mission SQLite/] },
  { file: 'src/components/settings/advanced-section.tsx', jargon: [/title="Tracking cache/, /label="Tracking cache/] },
  { file: 'src/components/mission-review-workspace.tsx', jargon: [/Show tracking telemetry/, /title="Audit Workspace"/, /telemetry are hidden/, /position telemetry\./] },
  { file: 'src/components/devices-workspace.tsx', jargon: [/subtitle="Devices Workspace"/, /'NoFix'/, /label="Fix Time"/] },
  { file: 'src/components/settings-workspace.tsx', jargon: [/subtitle="Settings Workspace"/] },
  { file: 'src/components/diagnostics-workspace.tsx', jargon: [/subtitle="Diagnostics Workspace"/] },
  { file: 'src/features/tracking/device-workspace-model.ts', jargon: [/'Fix time/, /'No fix'/, /'Cache'/] },
]

describe('plain words on operator screens [DON-368]', () => {
  for (const { file, jargon } of SCREEN_WORDS) {
    it(`${file} shows no audited jargon`, () => {
      const source = readFileSync(file, 'utf8')
      for (const pattern of jargon) expect(source, `${file} still says ${pattern}`).not.toMatch(pattern)
    })
  }
})
